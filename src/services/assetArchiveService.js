import path from 'path';
import Asset from '../models/Asset.js';
import AssetFolder from '../models/AssetFolder.js';
import { AppError } from '../utils/AppError.js';
import { collectDescendantIds, toObjectId } from './assetFolderService.js';

function sanitizeZipName(name) {
  const cleaned = String(name || 'file')
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, '_')
    .replace(/\s+/g, ' ')
    .trim();
  return cleaned || 'file';
}

function uniqueZipPath(used, dir, filename) {
  const safeName = sanitizeZipName(filename);
  const ext = path.extname(safeName);
  const base = path.basename(safeName, ext);
  let full = dir ? `${dir}/${safeName}` : safeName;
  let i = 1;
  while (used.has(full.toLowerCase())) {
    const next = `${base} (${i})${ext}`;
    full = dir ? `${dir}/${next}` : next;
    i += 1;
  }
  used.add(full.toLowerCase());
  return full;
}

function accessFilter({ role, locationId }) {
  if (role === 'admin') return {};
  const orClauses = [{ visibility: 'global' }];
  if (locationId) {
    orClauses.push({ visibility: 'location', locationIds: locationId });
  }
  return { $or: orClauses };
}

function canDownloadAsset(actor, doc) {
  const isVideo = String(doc.mimeType || '').startsWith('video/');
  if (isVideo && actor?.role !== 'admin') return false;
  return true;
}

function actorFilter(actor) {
  return accessFilter({
    role: actor.role,
    locationId: actor.locationId ? String(actor.locationId) : null,
  });
}

async function folderRelativePaths(rootFolder, descendantIds) {
  const allIds = [rootFolder._id, ...descendantIds];
  const rows = await AssetFolder.find({ _id: { $in: allIds } }).lean();
  const byId = new Map(rows.map((f) => [String(f._id), f]));
  const rootId = String(rootFolder._id);
  const map = new Map();

  function pathFor(id) {
    const parts = [];
    let current = byId.get(String(id));
    const seen = new Set();
    while (current && !seen.has(String(current._id))) {
      seen.add(String(current._id));
      parts.unshift(sanitizeZipName(current.name));
      if (String(current._id) === rootId) break;
      current = current.parentId ? byId.get(String(current.parentId)) : null;
    }
    return parts.join('/');
  }

  for (const id of allIds) {
    map.set(String(id), pathFor(id));
  }
  return map;
}

/**
 * List files in a folder tree with zip paths like "Folder/Sub/file.pdf".
 */
export async function listFolderArchiveEntries(actor, folderId, category) {
  const oid = toObjectId(folderId, 'folderId');
  const folder = await AssetFolder.findOne({
    _id: oid,
    category,
    isDeleted: { $ne: true },
  });
  if (!folder) throw new AppError('Folder not found', 404);

  const descendantIds = await collectDescendantIds(folder._id, category);
  const folderIds = [folder._id, ...descendantIds];
  const pathByFolder = await folderRelativePaths(folder, descendantIds);
  const idValues = [...folderIds, ...folderIds.map((id) => String(id))];

  const docs = await Asset.find({
    category,
    folderId: { $in: idValues },
    isDeleted: { $ne: true },
    ...actorFilter(actor),
  }).lean();

  if (actor?.role !== 'admin') {
    const hasVideo = await Asset.exists({
      category,
      folderId: { $in: idValues },
      isDeleted: { $ne: true },
      mimeType: { $regex: /^video\//i },
    });
    if (hasVideo) {
      throw new AppError(
        'This folder contains video files. Partners can download individual non-video files, but cannot download the whole folder.',
        403,
      );
    }
  }

  const used = new Set();
  const entries = [];
  for (const doc of docs) {
    if (!canDownloadAsset(actor, doc)) continue;
    const dir = pathByFolder.get(String(doc.folderId)) || sanitizeZipName(folder.name);
    const filename = doc.originalName || doc.name || 'file';
    entries.push({ zipPath: uniqueZipPath(used, dir, filename), doc });
  }

  return {
    zipName: `${sanitizeZipName(folder.name)}.zip`,
    entries,
  };
}

export async function listAssetArchiveEntries(actor, { category, assetIds }) {
  const ids = (assetIds || []).map((id) => {
    if (!id) throw new AppError('Invalid asset id', 400);
    return toObjectId(id, 'assetId');
  });
  if (!ids.length) throw new AppError('No assets selected', 400);

  const docs = await Asset.find({
    _id: { $in: ids },
    category,
    isDeleted: { $ne: true },
    ...actorFilter(actor),
  }).lean();

  const used = new Set();
  const entries = [];
  for (const doc of docs) {
    if (!canDownloadAsset(actor, doc)) continue;
    const filename = doc.originalName || doc.name || 'file';
    entries.push({ zipPath: uniqueZipPath(used, '', filename), doc });
  }

  return {
    zipName: entries.length === 1 ? `${sanitizeZipName(entries[0].zipPath)}.zip` : 'assets.zip',
    entries,
  };
}

export function formatArchiveManifest({ zipName, entries }) {
  return {
    zipName,
    files: entries.map((entry) => ({
      id: String(entry.doc._id),
      name: entry.doc.originalName || entry.doc.name || 'file',
      zipPath: entry.zipPath,
    })),
  };
}
