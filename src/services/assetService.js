import fs from 'fs';
import path from 'path';
import Asset from '../models/Asset.js';
import { AppError } from '../utils/AppError.js';

export const ASSET_UPLOAD_ROOT = path.join(process.cwd(), 'uploads', 'assets');

function formatAsset(doc) {
  const d = doc && typeof doc.toObject === 'function' ? doc.toObject() : doc;
  return {
    id: String(d._id),
    originalName: d.originalName,
    storedName: d.storedName,
    mimeType: d.mimeType,
    size: d.size,
    category: d.category,
    visibility: d.visibility,
    locationIds: (d.locationIds || []).map(String),
    type: d.type,
    uploadedBy: String(d.uploadedBy),
    expiresAt: d.expiresAt,
    createdAt: d.createdAt,
  };
}

export async function createAsset({ file, category, visibility, locationIds, type, userId }) {
  const doc = await Asset.create({
    originalName: file.originalname,
    storedName: file.filename,
    mimeType: file.mimetype,
    size: file.size,
    category,
    visibility,
    locationIds: visibility === 'location' ? (locationIds || []) : [],
    type: category === 'marketing_assets' ? type : undefined,
    uploadedBy: userId,
  });
  return { asset: formatAsset(doc) };
}

export async function listAssets({ role, locationId, category }) {
  const filter = { category };

  if (role !== 'admin') {
    // Partners see global assets + assets shared with their location
    const orClauses = [{ visibility: 'global' }];
    if (locationId) {
      orClauses.push({ visibility: 'location', locationIds: locationId });
    }
    filter.$or = orClauses;
  }

  const docs = await Asset.find(filter).sort({ createdAt: -1 }).lean();
  return { assets: docs.map(formatAsset) };
}

export async function getAssetFilePath(id, { role, locationId }) {
  const doc = await Asset.findById(id);
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

  const filePath = path.join(ASSET_UPLOAD_ROOT, doc.storedName);
  if (!fs.existsSync(filePath)) {
    throw new AppError('File not found on server', 404);
  }
  return { filePath, originalName: doc.originalName, mimeType: doc.mimeType };
}

export async function removeAsset(id) {
  const doc = await Asset.findByIdAndDelete(id);
  if (!doc) throw new AppError('Asset not found', 404);

  const filePath = path.join(ASSET_UPLOAD_ROOT, doc.storedName);
  await fs.promises.unlink(filePath).catch(() => {});

  return { ok: true };
}

/**
 * Removes a single location from an asset shared across multiple locations,
 * instead of deleting the whole record. Only deletes the asset (and its file)
 * once it has no locations left to belong to.
 */
export async function removeAssetLocation(id, locationId) {
  const doc = await Asset.findById(id);
  if (!doc) throw new AppError('Asset not found', 404);
  if (doc.visibility !== 'location') {
    throw new AppError('This asset is not location-specific', 400);
  }

  doc.locationIds = doc.locationIds.filter((lid) => String(lid) !== String(locationId));

  if (doc.locationIds.length === 0) {
    await Asset.findByIdAndDelete(id);
    const filePath = path.join(ASSET_UPLOAD_ROOT, doc.storedName);
    await fs.promises.unlink(filePath).catch(() => {});
    return { deleted: true, asset: null };
  }

  await doc.save();
  return { deleted: false, asset: formatAsset(doc) };
}
