import mongoose from 'mongoose';
import AssetFolder from '../models/AssetFolder.js';
import Asset from '../models/Asset.js';
import { AppError } from '../utils/AppError.js';

const CATEGORIES = new Set(['documents', 'marketing_assets']);

function formatFolder(doc) {
  const d = doc && typeof doc.toObject === 'function' ? doc.toObject() : doc;
  return {
    id: String(d._id),
    name: d.name,
    parentId: d.parentId ? String(d.parentId) : null,
    category: d.category,
    createdBy: d.createdBy ? String(d.createdBy) : null,
    createdAt: d.createdAt,
    updatedAt: d.updatedAt,
  };
}

function assertCategory(category) {
  if (!CATEGORIES.has(category)) {
    throw new AppError('category must be documents or marketing_assets', 400);
  }
}

function toObjectId(id, label = 'id') {
  if (id == null || id === '' || id === 'root') return null;
  if (!mongoose.Types.ObjectId.isValid(id)) {
    throw new AppError(`Invalid ${label}`, 400);
  }
  return new mongoose.Types.ObjectId(id);
}

async function loadFolder(id, category) {
  const doc = await AssetFolder.findOne({
    _id: id,
    category,
    isDeleted: { $ne: true },
  });
  if (!doc) throw new AppError('Folder not found', 404);
  return doc;
}

async function assertUniqueName({ category, parentId, name, excludeId = null }) {
  const filter = {
    category,
    parentId: parentId || null,
    name: new RegExp(`^${String(name).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i'),
    isDeleted: { $ne: true },
  };
  if (excludeId) filter._id = { $ne: excludeId };
  const existing = await AssetFolder.findOne(filter).lean();
  if (existing) {
    throw new AppError('A folder with this name already exists here', 409);
  }
}

/** Collect descendant folder ids (breadth-first). */
async function collectDescendantIds(rootId, category) {
  const ids = [];
  let frontier = [rootId];
  while (frontier.length) {
    const children = await AssetFolder.find({
      category,
      parentId: { $in: frontier },
      isDeleted: { $ne: true },
    })
      .select('_id')
      .lean();
    frontier = children.map((c) => c._id);
    ids.push(...frontier);
  }
  return ids;
}

export async function createFolder(actor, { name, parentId = null, category }) {
  if (actor?.role !== 'admin') throw new AppError('Only admin can manage folders', 403);
  assertCategory(category);
  const trimmed = String(name || '').trim();
  if (!trimmed) throw new AppError('Folder name is required', 400);
  if (trimmed.length > 120) throw new AppError('Folder name is too long', 400);

  let parentOid = null;
  if (parentId) {
    parentOid = toObjectId(parentId, 'parentId');
    await loadFolder(parentOid, category);
  }

  await assertUniqueName({ category, parentId: parentOid, name: trimmed });

  const doc = await AssetFolder.create({
    name: trimmed,
    parentId: parentOid,
    category,
    createdBy: actor.id,
  });
  return { folder: formatFolder(doc) };
}

export async function listFolders(actor, { category, parentId = null, allFolders = false }) {
  assertCategory(category);
  // Partners may browse folder structure; file visibility still gated on assets.
  if (!['admin', 'partner'].includes(actor?.role)) {
    throw new AppError('Access denied', 403);
  }

  const filter = {
    category,
    isDeleted: { $ne: true },
  };

  if (!allFolders) {
    const parentOid = parentId ? toObjectId(parentId, 'parentId') : null;
    if (parentOid) await loadFolder(parentOid, category);
    filter.parentId = parentOid;
  }

  const rows = await AssetFolder.find(filter).sort({ name: 1 }).lean();
  return { folders: rows.map(formatFolder) };
}

export async function getFolder(actor, id, category) {
  assertCategory(category);
  if (!['admin', 'partner'].includes(actor?.role)) {
    throw new AppError('Access denied', 403);
  }
  const doc = await loadFolder(toObjectId(id, 'folderId'), category);
  return { folder: formatFolder(doc) };
}

/** Breadcrumb from root → current folder. */
export async function getFolderPath(actor, id, category) {
  assertCategory(category);
  if (!['admin', 'partner'].includes(actor?.role)) {
    throw new AppError('Access denied', 403);
  }
  const path = [];
  let current = await loadFolder(toObjectId(id, 'folderId'), category);
  while (current) {
    path.unshift(formatFolder(current));
    if (!current.parentId) break;
    current = await AssetFolder.findOne({
      _id: current.parentId,
      category,
      isDeleted: { $ne: true },
    });
  }
  return { path };
}

export async function renameFolder(actor, id, { name, category }) {
  if (actor?.role !== 'admin') throw new AppError('Only admin can manage folders', 403);
  assertCategory(category);
  const trimmed = String(name || '').trim();
  if (!trimmed) throw new AppError('Folder name is required', 400);

  const doc = await loadFolder(toObjectId(id, 'folderId'), category);
  await assertUniqueName({
    category,
    parentId: doc.parentId,
    name: trimmed,
    excludeId: doc._id,
  });
  doc.name = trimmed;
  await doc.save();
  return { folder: formatFolder(doc) };
}

/**
 * Move a folder under a new parent (or root).
 * Prevents cycles (cannot move into self/descendant).
 */
export async function moveFolder(actor, id, { parentId = null, category }) {
  if (actor?.role !== 'admin') throw new AppError('Only admin can manage folders', 403);
  assertCategory(category);

  const doc = await loadFolder(toObjectId(id, 'folderId'), category);
  const newParentOid = parentId ? toObjectId(parentId, 'parentId') : null;

  if (newParentOid) {
    if (String(newParentOid) === String(doc._id)) {
      throw new AppError('A folder cannot be moved into itself', 400);
    }
    await loadFolder(newParentOid, category);
    const descendants = await collectDescendantIds(doc._id, category);
    if (descendants.some((d) => String(d) === String(newParentOid))) {
      throw new AppError('A folder cannot be moved into one of its subfolders', 400);
    }
  }

  await assertUniqueName({
    category,
    parentId: newParentOid,
    name: doc.name,
    excludeId: doc._id,
  });

  doc.parentId = newParentOid;
  await doc.save();
  return { folder: formatFolder(doc) };
}

/**
 * Soft-delete a folder.
 * - force=false: reject if it has subfolders or assets
 * - force=true: soft-delete the folder tree AND all files inside it
 */
export async function deleteFolder(actor, id, { category, force = false }) {
  if (actor?.role !== 'admin') throw new AppError('Only admin can manage folders', 403);
  assertCategory(category);

  const doc = await loadFolder(toObjectId(id, 'folderId'), category);
  const descendantIds = await collectDescendantIds(doc._id, category);
  const folderIds = [doc._id, ...descendantIds];

  const [subfolderCount, assetCount] = await Promise.all([
    AssetFolder.countDocuments({
      category,
      parentId: doc._id,
      isDeleted: { $ne: true },
    }),
    Asset.countDocuments({
      category,
      folderId: { $in: folderIds },
      isDeleted: { $ne: true },
    }),
  ]);

  if (!force && (subfolderCount > 0 || assetCount > 0)) {
    const err = new AppError(
      `This folder contains ${assetCount} file(s) and ${subfolderCount} subfolder(s). Confirm to delete the folder and all files inside it.`,
      409,
    );
    err.code = 'FOLDER_NOT_EMPTY';
    err.assetCount = assetCount;
    err.subfolderCount = subfolderCount;
    throw err;
  }

  let deletedAssets = 0;
  if (assetCount > 0) {
    const result = await Asset.updateMany(
      { category, folderId: { $in: folderIds }, isDeleted: { $ne: true } },
      { $set: { isDeleted: true } },
    );
    deletedAssets = result.modifiedCount;
  }

  await AssetFolder.updateMany(
    { _id: { $in: folderIds } },
    { $set: { isDeleted: true } },
  );

  return {
    ok: true,
    deletedAssets,
    deletedFolders: folderIds.length,
  };
}

/**
 * Ensure a nested path of folders exists under `parentId` (for folder upload).
 * pathParts: ['Fall Drinks', 'Photos']
 */
export async function ensureFolderPath(actor, { category, parentId = null, pathParts = [] }) {
  if (actor?.role !== 'admin') throw new AppError('Only admin can manage folders', 403);
  assertCategory(category);

  let currentParent = parentId ? toObjectId(parentId, 'parentId') : null;
  if (currentParent) await loadFolder(currentParent, category);

  const created = [];
  for (const raw of pathParts) {
    const name = String(raw || '').trim();
    if (!name) continue;

    let folder = await AssetFolder.findOne({
      category,
      parentId: currentParent,
      name: new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i'),
      isDeleted: { $ne: true },
    });

    if (!folder) {
      folder = await AssetFolder.create({
        name,
        parentId: currentParent,
        category,
        createdBy: actor.id,
      });
      created.push(formatFolder(folder));
    }

    currentParent = folder._id;
  }

  return {
    folderId: currentParent ? String(currentParent) : null,
    created,
  };
}

export { formatFolder, toObjectId, collectDescendantIds };
