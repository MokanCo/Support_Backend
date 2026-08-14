import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import Asset from '../models/Asset.js';
import { AppError } from '../utils/AppError.js';
import {
  isR2Configured,
  uploadFile as uploadToR2,
} from './cloudflareR2StorageService.js';
import { maybeConvertImageToWebp } from './imageOptimizeService.js';
import { maybeConvertVideoToWebm } from './videoOptimizeService.js';

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

function formatAsset(doc) {
  const d = doc && typeof doc.toObject === 'function' ? doc.toObject() : doc;
  const originalFileName = d.originalName;
  const name = (d.name && String(d.name).trim()) || originalFileName;
  return {
    id: String(d._id),
    name,
    originalFileName,
    originalName: originalFileName,
    fileUrl: d.fileUrl || '',
    thumbnailUrl: d.thumbnailUrl || '',
    contentType: d.mimeType,
    mimeType: d.mimeType,
    fileSize: d.size,
    size: d.size,
    storedName: d.storedName || '',
    storageKey: d.storageKey || '',
    category: d.category,
    visibility: d.visibility,
    locationIds: (d.locationIds || []).map(String),
    type: d.type,
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
 * Convert images → WebP and videos → WebM (+ thumbnail), then upload to R2 or local disk.
 */
async function persistUpload(file, category) {
  validateAssetFile(file);
  let optimized = await maybeConvertImageToWebp(file);
  if (!optimized.converted) {
    optimized = await maybeConvertVideoToWebm(optimized);
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
          mimetype: thumb.mimetype,
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
      mimetype: thumb.mimetype,
      size: thumb.size,
    });
    thumbnailStorageKey = local.storedName;
    // Local disk has no public CDN URL; card falls back to play-only until R2 is used.
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
    await persistThumbnail(optimized.thumbnail);
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
  await persistThumbnail(optimized.thumbnail);
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

export async function listAssets({ role, locationId, category }) {
  if (!['documents', 'marketing_assets'].includes(category)) {
    throw new AppError('category must be documents or marketing_assets', 400);
  }
  const filter = {
    category,
    isDeleted: { $ne: true },
    ...accessFilter({ role, locationId }),
  };
  const docs = await Asset.find(filter).sort({ createdAt: -1 }).lean();
  return { assets: docs.map(formatAsset) };
}

export async function getAssetById(id, { role, locationId }) {
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

  return { asset: formatAsset(doc) };
}

export async function getAssetFilePath(id, { role, locationId }) {
  const { asset } = await getAssetById(id, { role, locationId });

  if (asset.fileUrl) {
    return {
      fileUrl: asset.fileUrl,
      originalName: asset.originalFileName,
      mimeType: asset.contentType,
      redirect: true,
    };
  }

  const filePath = path.join(ASSET_UPLOAD_ROOT, asset.storedName);
  if (!asset.storedName || !fs.existsSync(filePath)) {
    throw new AppError('File not found on server', 404);
  }
  return {
    filePath,
    originalName: asset.originalFileName,
    mimeType: asset.contentType,
    redirect: false,
  };
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
