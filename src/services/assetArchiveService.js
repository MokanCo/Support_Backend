import path from 'path';
import archiverModule from 'archiver';
import Asset from '../models/Asset.js';
import AssetFolder from '../models/AssetFolder.js';
import { AppError } from '../utils/AppError.js';
import { collectDescendantIds, toObjectId } from './assetFolderService.js';
import { readAssetBytes } from './assetService.js';

const archiver =
  typeof archiverModule === 'function'
    ? archiverModule
    : archiverModule?.default;

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

export async function streamArchive(res, { zipName, entries }) {
  if (!archiver) {
    throw new AppError('Zip library is not available on the server', 500);
  }
  if (!entries.length) {
    throw new AppError('This folder has no files to download', 404);
  }

  const files = [];
  for (const entry of entries) {
    try {
      const bytes = await readAssetBytes(entry.doc);
      if (bytes?.buffer?.length) {
        files.push({ name: entry.zipPath, buffer: bytes.buffer });
      }
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn('[zip] skip file', entry.zipPath, err?.message || err);
    }
  }

  if (!files.length) {
    throw new AppError(
      'Could not read the files in this folder. They may not be stored in Cloudflare R2 yet.',
      404,
    );
  }

  const safeName = String(zipName || 'folder.zip').replace(/["\r\n]/g, '');
  const encoded = encodeURIComponent(safeName);
  res.setHeader('Content-Type', 'application/zip');
  res.setHeader(
    'Content-Disposition',
    `attachment; filename="${safeName}"; filename*=UTF-8''${encoded}`,
  );
  res.setHeader('Cache-Control', 'private, no-store');

  const archive = archiver('zip', { zlib: { level: 5 } });
  const done = new Promise((resolve, reject) => {
    archive.on('error', reject);
    archive.on('end', resolve);
    res.on('error', reject);
  });
  archive.pipe(res);

  for (const file of files) {
    archive.append(file.buffer, { name: file.name });
  }

  await archive.finalize();
  await done;
}
