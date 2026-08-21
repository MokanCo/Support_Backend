import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import mongoose from 'mongoose';
import Asset from '../models/Asset.js';
import AssetFolder from '../models/AssetFolder.js';
import { AppError } from '../utils/AppError.js';
import {
  isR2Configured,
  uploadFile as uploadToR2,
  getObjectBuffer as getR2ObjectBuffer,
  publicUrlForKey,
} from './cloudflareR2StorageService.js';
import { maybeConvertImageToWebp, toWebpThumbnail } from './imageOptimizeService.js';
import {
  maybeConvertVideoToWebm,
  extractThumbnailFromVideoBuffer,
} from './videoOptimizeService.js';
import { toObjectId as folderToObjectId } from './assetFolderService.js';

export const ASSET_UPLOAD_ROOT = path.join(process.cwd(), 'uploads', 'assets');

/** 100 MB — videos need headroom before WebM conversion. */
export const MAX_ASSET_FILE_SIZE = 100 * 1024 * 1024;

export const ALLOWED_ASSET_EXTENSIONS = new Set([
  '.pdf',
  '.doc',
  '.docx',
  '.xls',
  '.xlsx',
  '.ppt',
  '.pptx',
  '.txt',
  '.csv',
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.webp',
  '.svg',
  '.zip',
  '.mp4',
  '.mov',
  '.avi',
  '.mkv',
  '.m4v',
  '.webm',
  '.mpeg',
  '.mpg',
  '.wmv',
  '.3gp',
]);

export function validateAssetFile(file) {
  if (!file) throw new AppError('File is required', 400);
  const size = file.size ?? file.buffer?.length ?? 0;
  if (!size) throw new AppError('File is empty', 400);
  if (size > MAX_ASSET_FILE_SIZE) {
    throw new AppError('File exceeds maximum size of 100 MB', 400);
  }
  const ext = path.extname(file.originalname || '').toLowerCase();
  if (!ALLOWED_ASSET_EXTENSIONS.has(ext)) {
    throw new AppError(
      `File type "${ext || 'unknown'}" is not allowed. Allowed: ${[...ALLOWED_ASSET_EXTENSIONS].join(', ')}`,
      400,
    );
  }
}

function isVideoMime(mimeType) {
  return String(mimeType || '').startsWith('video/');
}

/**
 * Public API shape. Video file URLs are never exposed — clients must stream
 * via the authenticated /file endpoint so CDN links cannot be copied from
 * list/get responses.
 */
function formatAsset(doc) {
  const d = doc && typeof doc.toObject === 'function' ? doc.toObject() : doc;
  const originalFileName = d.originalName;
  const name = (d.name && String(d.name).trim()) || originalFileName;
  const mimeType = d.mimeType;
  return {
    id: String(d._id),
    name,
    originalFileName,
    originalName: originalFileName,
    // Hide direct storage URLs for videos (inspect / Network JSON).
    fileUrl: isVideoMime(mimeType) ? '' : d.fileUrl || '',
    // WebP card thumbs are public CDN URLs (same buckets as files) — safe to expose.
    hasThumbnail: Boolean(d.thumbnailUrl || d.thumbnailStorageKey) || isVideoMime(mimeType),
    thumbnailUrl: d.thumbnailUrl || '',
    contentType: mimeType,
    mimeType,
    fileSize: d.size,
    size: d.size,
    category: d.category,
    visibility: d.visibility,
    locationIds: (d.locationIds || []).map(String),
    type: d.type,
    folderId: d.folderId ? String(d.folderId) : null,
    uploadedBy: String(d.uploadedBy),
    expiresAt: d.expiresAt,
    createdAt: d.createdAt,
    updatedAt: d.updatedAt,
    isDeleted: Boolean(d.isDeleted),
  };
}

async function storeFileLocally(file) {
  await fs.promises.mkdir(ASSET_UPLOAD_ROOT, { recursive: true });
  const ext = path.extname(file.originalname || '').slice(0, 16);
  const storedName = `${Date.now()}-${crypto.randomBytes(5).toString('hex')}${ext}`;
  const dest = path.join(ASSET_UPLOAD_ROOT, storedName);
  if (file.buffer) {
    await fs.promises.writeFile(dest, file.buffer);
  } else if (file.path) {
    await fs.promises.copyFile(file.path, dest);
  } else {
    throw new AppError('Invalid uploaded file', 400);
  }
  return {
    key: storedName,
    fileUrl: '',
    originalName: file.originalname,
    contentType: file.mimetype || 'application/octet-stream',
    fileSize: file.size,
    storedName,
  };
}

/**
 * Convert images → WebP (+ card thumbnail) and videos → WebM (+ WebP thumbnail),
 * then upload to R2 or local disk.
 */
async function persistUpload(file, category) {
  validateAssetFile(file);
  let optimized = await maybeConvertImageToWebp(file);
  if (!optimized.converted) {
    optimized = await maybeConvertVideoToWebm(optimized);
  }

  // Image assets get a small WebP card thumb so lists never download full files.
  let cardThumb = optimized.thumbnail || null;
  if (!cardThumb?.buffer?.length && String(optimized.mimetype || '').startsWith('image/')) {
    cardThumb = await toWebpThumbnail(optimized.buffer, {
      originalname: optimized.originalname,
    });
  }

  let thumbnailUrl = '';
  let thumbnailStorageKey = '';

  async function persistThumbnail(thumb) {
    if (!thumb?.buffer?.length) return;
    if (isR2Configured(category)) {
      const uploaded = await uploadToR2(
        {
          buffer: thumb.buffer,
          originalname: thumb.originalname,
          mimetype: thumb.mimetype || 'image/webp',
          size: thumb.size,
        },
        { category, folder: `${category === 'marketing_assets' ? 'marketing-assets' : 'documents'}/thumbnails` },
      );
      thumbnailUrl = uploaded.fileUrl;
      thumbnailStorageKey = uploaded.key;
      return;
    }
    const local = await storeFileLocally({
      buffer: thumb.buffer,
      originalname: thumb.originalname,
      mimetype: thumb.mimetype || 'image/webp',
      size: thumb.size,
    });
    thumbnailStorageKey = local.storedName;
    // Local disk has no public CDN URL; cards fall back to /:id/thumbnail or fileUrl.
    thumbnailUrl = '';
  }

  if (isR2Configured(category)) {
    const uploaded = await uploadToR2(
      {
        buffer: optimized.buffer,
        originalname: optimized.originalname,
        mimetype: optimized.mimetype,
        size: optimized.size,
      },
      { category },
    );
    await persistThumbnail(cardThumb);
    return {
      storageKey: uploaded.key,
      fileUrl: uploaded.fileUrl,
      storedName: path.basename(uploaded.key),
      mimeType: uploaded.contentType,
      size: uploaded.fileSize,
      storedOriginalName: optimized.originalname,
      converted: Boolean(optimized.converted),
      thumbnailUrl,
      thumbnailStorageKey,
    };
  }
  const local = await storeFileLocally({
    buffer: optimized.buffer,
    originalname: optimized.originalname,
    mimetype: optimized.mimetype,
    size: optimized.size,
  });
  await persistThumbnail(cardThumb);
  return {
    storageKey: '',
    fileUrl: '',
    storedName: local.storedName,
    mimeType: local.contentType,
    size: local.fileSize,
    storedOriginalName: optimized.originalname,
    converted: Boolean(optimized.converted),
    thumbnailUrl,
    thumbnailStorageKey,
  };
}

export async function createAsset({
  file,
  category,
  visibility = 'global',
  locationIds,
  type,
  name,
  userId,
  folderId = null,
}) {
  if (!['documents', 'marketing_assets'].includes(category)) {
    throw new AppError('category must be documents or marketing_assets', 400);
  }
  if (!['global', 'location'].includes(visibility)) {
    throw new AppError('visibility must be global or location', 400);
  }
  if (visibility === 'location' && !(locationIds || []).length) {
    throw new AppError('At least one location is required for location visibility', 400);
  }

  let folderOid = null;
  if (folderId) {
    folderOid = folderToObjectId(folderId, 'folderId');
    const folder = await AssetFolder.findOne({
      _id: folderOid,
      category,
      isDeleted: { $ne: true },
    });
    if (!folder) throw new AppError('Folder not found', 404);
  }

  const stored = await persistUpload(file, category);

  const displayName =
    (typeof name === 'string' && name.trim()) || file.originalname;

  const doc = await Asset.create({
    name: displayName,
    originalName: file.originalname,
    storedName: stored.storedName,
    storageKey: stored.storageKey,
    fileUrl: stored.fileUrl,
    thumbnailUrl: stored.thumbnailUrl || '',
    thumbnailStorageKey: stored.thumbnailStorageKey || '',
    mimeType: stored.mimeType,
    size: stored.size,
    category,
    visibility,
    locationIds: visibility === 'location' ? locationIds || [] : [],
    type: category === 'marketing_assets' ? type : undefined,
    folderId: folderOid,
    uploadedBy: userId,
    isDeleted: false,
  });

  return { asset: formatAsset(doc) };
}

function accessFilter({ role, locationId }) {
  if (role === 'admin') return {};
  const orClauses = [{ visibility: 'global' }];
  if (locationId) {
    orClauses.push({ visibility: 'location', locationIds: locationId });
  }
  return { $or: orClauses };
}

export async function listAssets({ role, locationId, category, folderId, allFolders = false }) {
  if (!['documents', 'marketing_assets'].includes(category)) {
    throw new AppError('category must be documents or marketing_assets', 400);
  }
  const filter = {
    category,
    isDeleted: { $ne: true },
    ...accessFilter({ role, locationId }),
  };

  // Default: only assets in the requested folder (null = root).
  // allFolders=true keeps legacy "flat list of everything" for search.
  if (!allFolders) {
    if (folderId) {
      const oid = folderToObjectId(folderId, 'folderId');
      const folder = await AssetFolder.findOne({
        _id: oid,
        category,
        isDeleted: { $ne: true },
      });
      if (!folder) throw new AppError('Folder not found', 404);
      filter.folderId = oid;
    } else {
      filter.$and = [...(filter.$and || []), { $or: [{ folderId: null }, { folderId: { $exists: false } }] }];
    }
  }

  const docs = await Asset.find(filter).sort({ createdAt: -1 }).lean();
  return { assets: docs.map(formatAsset) };
}

/**
 * Move one or more assets into a folder (or root). Does not touch R2 keys.
 */
export async function moveAssets(actor, { category, assetIds, folderId = null }) {
  if (actor?.role !== 'admin') throw new AppError('Only admin can move assets', 403);
  if (!['documents', 'marketing_assets'].includes(category)) {
    throw new AppError('category must be documents or marketing_assets', 400);
  }
  const ids = (assetIds || []).map((id) => {
    if (!mongoose.Types.ObjectId.isValid(id)) throw new AppError('Invalid asset id', 400);
    return id;
  });
  if (!ids.length) throw new AppError('No assets selected', 400);

  let folderOid = null;
  if (folderId) {
    folderOid = folderToObjectId(folderId, 'folderId');
    const folder = await AssetFolder.findOne({
      _id: folderOid,
      category,
      isDeleted: { $ne: true },
    });
    if (!folder) throw new AppError('Folder not found', 404);
  }

  const result = await Asset.updateMany(
    { _id: { $in: ids }, category, isDeleted: { $ne: true } },
    { $set: { folderId: folderOid } },
  );

  const docs = await Asset.find({ _id: { $in: ids }, category, isDeleted: { $ne: true } }).lean();
  return {
    moved: result.modifiedCount,
    assets: docs.map(formatAsset),
  };
}

async function loadAccessibleAssetDoc(id, { role, locationId }) {
  const doc = await Asset.findOne({ _id: id, isDeleted: { $ne: true } });
  if (!doc) throw new AppError('Asset not found', 404);

  if (role !== 'admin') {
    const isGlobal = doc.visibility === 'global';
    const isForLocation =
      doc.visibility === 'location' &&
      locationId &&
      doc.locationIds.some((lid) => String(lid) === String(locationId));
    if (!isGlobal && !isForLocation) {
      throw new AppError('Access denied', 403);
    }
  }

  return doc;
}

export async function getAssetById(id, { role, locationId }) {
  const doc = await loadAccessibleAssetDoc(id, { role, locationId });
  return { asset: formatAsset(doc) };
}

/** Best-effort R2 object key from a DB asset row. */
function resolveR2Key(doc) {
  if (doc.storageKey) return String(doc.storageKey).replace(/^\/+/, '');
  if (doc.fileUrl) {
    try {
      const { pathname } = new URL(doc.fileUrl);
      const key = pathname.replace(/^\/+/, '');
      if (key) return key;
    } catch {
      /* ignore invalid URL */
    }
  }
  return '';
}

/** Internal file info for streaming — uses DB URLs, not the redacted API shape. */
export async function getAssetFilePath(id, { role, locationId }) {
  const doc = await loadAccessibleAssetDoc(id, { role, locationId });
  const originalName = doc.originalName;
  const mimeType = doc.mimeType;
  const r2Key = resolveR2Key(doc);
  const fileUrl = doc.fileUrl || (r2Key ? publicUrlForKey(doc.category, r2Key) : '');
  const localPath = path.join(ASSET_UPLOAD_ROOT, doc.storedName || '');
  const hasLocal = Boolean(doc.storedName && fs.existsSync(localPath));

  if (fileUrl || r2Key || hasLocal) {
    return {
      fileUrl,
      storageKey: r2Key,
      category: doc.category,
      originalName,
      mimeType,
      redirect: Boolean(fileUrl),
      storedName: doc.storedName || '',
      filePath: hasLocal ? localPath : undefined,
    };
  }

  throw new AppError(
    'File not found on server. This file was saved on local disk and is not in Cloudflare R2. Re-upload it, or run npm run migrate:assets-to-r2 on the machine that has the file.',
    404,
  );
}

/** Load file bytes for zip/download. Returns null if the file cannot be read. */
export async function readAssetBytes(doc) {
  const r2Key = resolveR2Key(doc);
  if (r2Key) {
    const fromR2 = await getR2ObjectBuffer(doc.category, r2Key);
    if (fromR2?.buffer?.length) {
      return {
        buffer: fromR2.buffer,
        mimeType: fromR2.contentType || doc.mimeType,
        originalName: doc.originalName,
      };
    }
  }
  const fileUrl = doc.fileUrl || (r2Key ? publicUrlForKey(doc.category, r2Key) : '');
  if (fileUrl) {
    try {
      const upstream = await fetch(fileUrl);
      if (upstream.ok) {
        const buffer = Buffer.from(await upstream.arrayBuffer());
        if (buffer.length) {
          return {
            buffer,
            mimeType: upstream.headers.get('content-type') || doc.mimeType,
            originalName: doc.originalName,
          };
        }
      }
    } catch {
      /* try local */
    }
  }
  if (doc.storedName) {
    const filePath = path.join(ASSET_UPLOAD_ROOT, doc.storedName);
    if (fs.existsSync(filePath)) {
      const buffer = await fs.promises.readFile(filePath);
      if (buffer.length) {
        return { buffer, mimeType: doc.mimeType, originalName: doc.originalName };
      }
    }
  }
  return null;
}

export async function bulkDeleteAssets(actor, { category, assetIds }) {
  if (actor?.role !== 'admin') throw new AppError('Only admin can delete assets', 403);
  if (!['documents', 'marketing_assets'].includes(category)) {
    throw new AppError('category must be documents or marketing_assets', 400);
  }
  const ids = (assetIds || []).map((id) => {
    if (!mongoose.Types.ObjectId.isValid(id)) throw new AppError('Invalid asset id', 400);
    return id;
  });
  if (!ids.length) throw new AppError('No assets selected', 400);

  const result = await Asset.updateMany(
    { _id: { $in: ids }, category, isDeleted: { $ne: true } },
    { $set: { isDeleted: true } },
  );
  return { deleted: result.modifiedCount };
}

/**
 * Resolve card thumbnail bytes (WebP preferred).
 * Proxies R2 when no public CDN URL is available, and generates+persists a
 * WebP thumbnail for older production videos missing one.
 */
export async function getAssetThumbnailBuffer(id, { role, locationId }) {
  const doc = await loadAccessibleAssetDoc(id, { role, locationId });
  const mime = String(doc.mimeType || '');
  const isVideo = mime.startsWith('video/');
  const isImage = mime.startsWith('image/');
  if (!isVideo && !isImage && !(doc.thumbnailUrl || doc.thumbnailStorageKey)) {
    throw new AppError('Thumbnails are only available for images and videos', 400);
  }

  async function loadFromUrl(url) {
    const upstream = await fetch(url);
    if (!upstream.ok) return null;
    const buffer = Buffer.from(await upstream.arrayBuffer());
    return buffer.length ? buffer : null;
  }

  async function persistWebpThumb(thumb) {
    if (!thumb?.buffer?.length) return;
    if (isR2Configured(doc.category)) {
      const uploaded = await uploadToR2(
        {
          buffer: thumb.buffer,
          originalname: thumb.originalname,
          mimetype: 'image/webp',
          size: thumb.size,
        },
        {
          category: doc.category,
          folder: `${doc.category === 'marketing_assets' ? 'marketing-assets' : 'documents'}/thumbnails`,
        },
      );
      doc.thumbnailUrl = uploaded.fileUrl;
      doc.thumbnailStorageKey = uploaded.key;
      await doc.save();
      return;
    }
    const local = await storeFileLocally({
      buffer: thumb.buffer,
      originalname: thumb.originalname,
      mimetype: 'image/webp',
      size: thumb.size,
    });
    doc.thumbnailStorageKey = local.storedName;
    doc.thumbnailUrl = '';
    await doc.save();
  }

  /** Ensure legacy JPEG thumbs are upgraded to WebP in R2 when served. */
  async function ensureWebp(buffer, contentType) {
    const ct = String(contentType || '').toLowerCase();
    if (ct.includes('webp') || (buffer[0] === 0x52 && buffer[1] === 0x49 && buffer[8] === 0x57)) {
      return { buffer, mimeType: 'image/webp' };
    }
    const webp = await toWebpThumbnail(buffer, {
      originalname: doc.originalName || 'thumb',
    });
    if (!webp?.buffer?.length) {
      return { buffer, mimeType: ct || 'image/jpeg' };
    }
    try {
      await persistWebpThumb(webp);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn('[assets] could not persist WebP thumbnail upgrade', err?.message || err);
    }
    return { buffer: webp.buffer, mimeType: 'image/webp' };
  }

  if (doc.thumbnailUrl) {
    const existing = await loadFromUrl(doc.thumbnailUrl);
    if (existing) {
      const looksWebp = /\.webp(\?|$)/i.test(doc.thumbnailUrl);
      return ensureWebp(existing, looksWebp ? 'image/webp' : 'image/jpeg');
    }
  }

  if (doc.thumbnailStorageKey) {
    const fromR2 = await getR2ObjectBuffer(doc.category, doc.thumbnailStorageKey);
    if (fromR2?.buffer?.length) {
      return ensureWebp(fromR2.buffer, fromR2.contentType || 'image/jpeg');
    }
    const localPath = path.join(ASSET_UPLOAD_ROOT, doc.thumbnailStorageKey);
    if (fs.existsSync(localPath)) {
      const buffer = await fs.promises.readFile(localPath);
      if (buffer.length) {
        return ensureWebp(buffer, 'image/jpeg');
      }
    }
  }

  // Image without a dedicated thumb: build one from the main WebP/file.
  if (isImage) {
    let imageBuffer = null;
    const imageKey = resolveR2Key(doc);
    if (imageKey) {
      const fromR2 = await getR2ObjectBuffer(doc.category, imageKey);
      if (fromR2?.buffer?.length) imageBuffer = fromR2.buffer;
    }
    if (!imageBuffer?.length && doc.fileUrl) {
      imageBuffer = await loadFromUrl(doc.fileUrl);
    }
    if (!imageBuffer?.length && doc.storedName) {
      const filePath = path.join(ASSET_UPLOAD_ROOT, doc.storedName);
      if (fs.existsSync(filePath)) {
        imageBuffer = await fs.promises.readFile(filePath);
      }
    }
    if (imageBuffer?.length) {
      const thumb = await toWebpThumbnail(imageBuffer, {
        originalname: doc.originalName || 'image',
      });
      if (thumb?.buffer?.length) {
        try {
          await persistWebpThumb(thumb);
        } catch (err) {
          // eslint-disable-next-line no-console
          console.warn('[assets] could not persist image thumbnail', err?.message || err);
        }
        return { buffer: thumb.buffer, mimeType: 'image/webp' };
      }
    }
  }

  if (!isVideo) {
    throw new AppError('Thumbnail not found', 404);
  }

  // On-demand generate from the video (fixes older uploads / failed ffmpeg on deploy).
  let videoBuffer = null;
  const videoKey = resolveR2Key(doc);
  if (videoKey) {
    const fromR2 = await getR2ObjectBuffer(doc.category, videoKey);
    if (fromR2?.buffer?.length) videoBuffer = fromR2.buffer;
  }
  if (!videoBuffer?.length && doc.fileUrl) {
    videoBuffer = await loadFromUrl(doc.fileUrl);
  }
  if (!videoBuffer?.length && doc.storedName) {
    const filePath = path.join(ASSET_UPLOAD_ROOT, doc.storedName);
    if (fs.existsSync(filePath)) {
      videoBuffer = await fs.promises.readFile(filePath);
    }
  }
  if (!videoBuffer?.length) {
    throw new AppError('Video file not found for thumbnail', 404);
  }

  const thumb = await extractThumbnailFromVideoBuffer(
    videoBuffer,
    doc.originalName || 'video.mp4',
  );
  if (!thumb?.buffer?.length) {
    throw new AppError('Could not generate video thumbnail', 404);
  }

  try {
    await persistWebpThumb(thumb);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('[assets] could not persist generated thumbnail', err?.message || err);
  }

  return { buffer: thumb.buffer, mimeType: 'image/webp' };
}

/** Soft-delete. Does not remove the object from R2. */
export async function removeAsset(id) {
  const doc = await Asset.findOne({ _id: id, isDeleted: { $ne: true } });
  if (!doc) throw new AppError('Asset not found', 404);

  doc.isDeleted = true;
  await doc.save();

  return { ok: true };
}

export async function removeAssetLocation(id, locationId) {
  const doc = await Asset.findOne({ _id: id, isDeleted: { $ne: true } });
  if (!doc) throw new AppError('Asset not found', 404);
  if (doc.visibility !== 'location') {
    throw new AppError('This asset is not location-specific', 400);
  }

  doc.locationIds = doc.locationIds.filter((lid) => String(lid) !== String(locationId));

  if (doc.locationIds.length === 0) {
    doc.isDeleted = true;
    await doc.save();
    return { deleted: true, asset: null };
  }

  await doc.save();
  return { deleted: false, asset: formatAsset(doc) };
}

export { formatAsset };
