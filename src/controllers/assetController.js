import fs from 'fs';
import {
  createAsset,
  listAssets,
  getAssetById,
  getAssetFilePath,
  getAssetThumbnailBuffer,
  removeAsset,
  removeAssetLocation,
} from '../services/assetService.js';
import { AppError } from '../utils/AppError.js';
import { asyncHandler } from '../utils/asyncHandler.js';

/**
 * multer turns repeated form fields into an array only when there are 2+ values;
 * a single selection arrives as a plain string. Normalize both cases.
 */
export function normalizeLocationIds(input) {
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

function actorFromReq(req) {
  return {
    role: req.user.role,
    locationId: req.user.locationId ? String(req.user.locationId) : null,
  };
}

export const uploadAsset = asyncHandler(async (req, res) => {
  if (!req.file) throw new AppError('No file uploaded', 400);

  const {
    category,
    visibility = 'global',
    locationIds,
    type,
    name,
    Name,
  } = req.body;

  if (!['documents', 'marketing_assets'].includes(category)) {
    throw new AppError('category must be documents or marketing_assets', 400);
  }

  const result = await createAsset({
    file: req.file,
    category,
    visibility,
    locationIds: normalizeLocationIds(locationIds),
    type,
    name: name || Name,
    userId: req.user.id,
  });

  res.status(201).json(result);
});

export const listAssetsHandler = asyncHandler(async (req, res) => {
  const { category } = req.query;
  const result = await listAssets({
    ...actorFromReq(req),
    category,
  });
  res.json(result);
});

export const getAssetHandler = asyncHandler(async (req, res) => {
  const result = await getAssetById(req.params.id, actorFromReq(req));
  res.json(result);
});

export const serveAssetFile = asyncHandler(async (req, res) => {
  const actor = actorFromReq(req);
  const fileInfo = await getAssetFilePath(req.params.id, actor);
  const encodedName = encodeURIComponent(fileInfo.originalName);
  const asDownload =
    req.query.download === '1' ||
    req.query.download === 'true' ||
    String(req.query.disposition || '').toLowerCase() === 'attachment';
  const isVideo = String(fileInfo.mimeType || '').startsWith('video/');

  // Videos: only admins may request attachment/download. Everyone else can
  // stream inline for playback only (no Content-Disposition: attachment).
  if (asDownload && isVideo && actor.role !== 'admin') {
    throw new AppError('Only admins can download videos', 403);
  }

  const disposition = asDownload ? 'attachment' : 'inline';
  const contentDisposition = asDownload
    ? `${disposition}; filename="${encodedName}"; filename*=UTF-8''${encodedName}`
    : // Omit filename on inline video to discourage "Save as" from headers.
      isVideo
      ? 'inline'
      : `${disposition}; filename="${encodedName}"; filename*=UTF-8''${encodedName}`;

  res.setHeader('X-Content-Type-Options', 'nosniff');
  if (isVideo) {
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('X-Robots-Tag', 'noindex, nofollow');
  }

  if (fileInfo.redirect && fileInfo.fileUrl) {
    // Always proxy from R2 — never redirect the browser to the public CDN URL
    // (that would expose a copyable direct download link).
    const upstream = await fetch(fileInfo.fileUrl);
    if (!upstream.ok) {
      throw new AppError('File not found on storage', 404);
    }
    const contentType =
      upstream.headers.get('content-type') ||
      fileInfo.mimeType ||
      'application/octet-stream';
    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Disposition', contentDisposition);
    const buf = Buffer.from(await upstream.arrayBuffer());
    res.send(buf);
    return;
  }

  res.setHeader('Content-Type', fileInfo.mimeType || 'application/octet-stream');
  res.setHeader('Content-Disposition', contentDisposition);
  fs.createReadStream(fileInfo.filePath).pipe(res);
});

export const serveAssetThumbnail = asyncHandler(async (req, res) => {
  const { buffer, mimeType } = await getAssetThumbnailBuffer(
    req.params.id,
    actorFromReq(req),
  );
  res.setHeader('Content-Type', mimeType || 'image/jpeg');
  res.setHeader('Cache-Control', 'private, max-age=86400');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.send(buffer);
});

export const deleteAssetHandler = asyncHandler(async (req, res) => {
  const result = await removeAsset(req.params.id);
  res.json(result);
});

export const removeAssetLocationHandler = asyncHandler(async (req, res) => {
  const result = await removeAssetLocation(req.params.id, req.params.locationId);
  res.json(result);
});

/** Fixed-category upload used by /api/documents and /api/marketing-assets */
export function makeCategoryUploadHandler(category) {
  return asyncHandler(async (req, res) => {
    if (!req.file) throw new AppError('No file uploaded', 400);

    const {
      visibility = 'global',
      locationIds,
      type,
      name,
      Name,
    } = req.body;

    const result = await createAsset({
      file: req.file,
      category,
      visibility,
      locationIds: normalizeLocationIds(locationIds),
      type,
      name: name || Name,
      userId: req.user.id,
    });

    // Match Document-oriented response shape for dedicated routes
    if (category === 'documents') {
      res.status(201).json({ document: result.asset });
      return;
    }
    res.status(201).json({ asset: result.asset });
  });
}

export function makeCategoryListHandler(category) {
  return asyncHandler(async (req, res) => {
    const result = await listAssets({
      ...actorFromReq(req),
      category,
    });
    if (category === 'documents') {
      res.json({ documents: result.assets });
      return;
    }
    res.json({ assets: result.assets });
  });
}

export function makeCategoryGetHandler(category) {
  return asyncHandler(async (req, res) => {
    const result = await getAssetById(req.params.id, actorFromReq(req));
    if (result.asset.category !== category) {
      throw new AppError('Not found', 404);
    }
    if (category === 'documents') {
      res.json({ document: result.asset });
      return;
    }
    res.json({ asset: result.asset });
  });
}

export function makeCategoryDeleteHandler(category) {
  return asyncHandler(async (req, res) => {
    const existing = await getAssetById(req.params.id, {
      role: 'admin',
      locationId: null,
    });
    if (existing.asset.category !== category) {
      throw new AppError('Not found', 404);
    }
    const result = await removeAsset(req.params.id);
    res.json(result);
  });
}
