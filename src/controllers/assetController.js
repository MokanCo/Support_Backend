import fs from 'fs';
import {
  createAsset,
  listAssets,
  getAssetFilePath,
  removeAsset,
  removeAssetLocation,
} from '../services/assetService.js';
import { AppError } from '../utils/AppError.js';

/**
 * multer turns repeated form fields into an array only when there are 2+ values;
 * a single selection arrives as a plain string. Normalize both cases without
 * ever throwing on a plain (non-JSON) id string.
 */
function normalizeLocationIds(input) {
  if (!input) return [];
  const values = Array.isArray(input) ? input : [input];
  return values.flatMap((v) => {
    if (typeof v !== 'string') return [];
    const trimmed = v.trim();
    if (trimmed.startsWith('[')) {
      try {
        const parsed = JSON.parse(trimmed);
        return Array.isArray(parsed) ? parsed : [trimmed];
      } catch {
        return [trimmed];
      }
    }
    return trimmed ? [trimmed] : [];
  });
}

export async function uploadAsset(req, res, next) {
  try {
    if (!req.file) throw new AppError('No file uploaded', 400);

    const { category, visibility = 'global', locationIds, type } = req.body;
    if (!['documents', 'marketing_assets'].includes(category)) {
      throw new AppError('category must be documents or marketing_assets', 400);
    }

    const parsedLocationIds = normalizeLocationIds(locationIds);

    const result = await createAsset({
      file: req.file,
      category,
      visibility,
      locationIds: parsedLocationIds,
      type,
      userId: req.user.id,
    });

    res.status(201).json(result);
  } catch (err) {
    if (req.file?.path) {
      await fs.promises.unlink(req.file.path).catch(() => {});
    }
    next(err);
  }
}

export async function listAssetsHandler(req, res, next) {
  try {
    const { category } = req.query;
    if (!['documents', 'marketing_assets'].includes(category)) {
      throw new AppError('category must be documents or marketing_assets', 400);
    }
    const result = await listAssets({
      role: req.user.role,
      locationId: req.user.locationId ? String(req.user.locationId) : null,
      category,
    });
    res.json(result);
  } catch (err) {
    next(err);
  }
}

export async function serveAssetFile(req, res, next) {
  try {
    const { filePath, originalName, mimeType } = await getAssetFilePath(req.params.id, {
      role: req.user.role,
      locationId: req.user.locationId ? String(req.user.locationId) : null,
    });
    const encodedName = encodeURIComponent(originalName);
    res.setHeader('Content-Type', mimeType || 'application/octet-stream');
    res.setHeader('Content-Disposition', `inline; filename="${encodedName}"`);
    fs.createReadStream(filePath).pipe(res);
  } catch (err) {
    next(err);
  }
}

export async function deleteAssetHandler(req, res, next) {
  try {
    const result = await removeAsset(req.params.id);
    res.json(result);
  } catch (err) {
    next(err);
  }
}

export async function removeAssetLocationHandler(req, res, next) {
  try {
    const result = await removeAssetLocation(req.params.id, req.params.locationId);
    res.json(result);
  } catch (err) {
    next(err);
  }
}
