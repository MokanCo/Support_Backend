import fs from 'fs';
import { Readable } from 'node:stream';
import {
  createAsset,
  listAssets,
  getAssetById,
  getAssetFilePath,
  getAssetPreviewUrl,
  getAssetThumbnailBuffer,
  removeAsset,
  removeAssetLocation,
  moveAssets,
  bulkDeleteAssets,
} from '../services/assetService.js';
import {
  listFolderArchiveEntries,
  listAssetArchiveEntries,
  formatArchiveManifest,
} from '../services/assetArchiveService.js';
import {
  getObjectStream as getR2ObjectStream,
  bodyToNodeStream,
} from '../services/cloudflareR2StorageService.js';
import * as folderService from '../services/assetFolderService.js';
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
    folderId,
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
    folderId: folderId || null,
  });

  res.status(201).json(result);
});

export const listAssetsHandler = asyncHandler(async (req, res) => {
  const { category, folderId, allFolders } = req.query;
  const result = await listAssets({
    ...actorFromReq(req),
    category,
    folderId: folderId || null,
    allFolders: allFolders === '1' || allFolders === 'true',
  });
  res.json(result);
});

export const getAssetHandler = asyncHandler(async (req, res) => {
  const result = await getAssetById(req.params.id, actorFromReq(req));
  res.json(result);
});

export const serveAssetPreviewUrl = asyncHandler(async (req, res) => {
  const result = await getAssetPreviewUrl(req.params.id, actorFromReq(req));
  res.setHeader('Cache-Control', 'private, no-store');
  res.json(result);
});

function looksLikePdf(fileInfo) {
  return (
    String(fileInfo.mimeType || '').toLowerCase().includes('pdf') ||
    String(fileInfo.originalName || '').toLowerCase().endsWith('.pdf')
  );
}

export const serveAssetFile = asyncHandler(async (req, res) => {
  const actor = actorFromReq(req);
  const fileInfo = await getAssetFilePath(req.params.id, actor);
  const encodedName = encodeURIComponent(fileInfo.originalName);
  const asDownload =
    req.query.download === '1' ||
    req.query.download === 'true' ||
    String(req.query.disposition || '').toLowerCase() === 'attachment';
  const isVideo = String(fileInfo.mimeType || '').startsWith('video/');
  const looksPdf = looksLikePdf(fileInfo);

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
  res.setHeader('Accept-Ranges', 'bytes');
  res.setHeader('Cache-Control', isVideo ? 'private, no-store' : 'private, max-age=60');
  if (isVideo) {
    res.setHeader('X-Robots-Tag', 'noindex, nofollow');
  }

  const range = req.headers.range;

  if (fileInfo.storageKey) {
    const fromR2 = await getR2ObjectStream(fileInfo.category, fileInfo.storageKey, range);
    if (fromR2?.body) {
      const contentType = looksPdf
        ? 'application/pdf'
        : fromR2.contentType || fileInfo.mimeType || 'application/octet-stream';
      res.setHeader('Content-Type', contentType);
      res.setHeader('Content-Disposition', contentDisposition);
      if (fromR2.contentLength != null) {
        res.setHeader('Content-Length', String(fromR2.contentLength));
      }
      if (range && fromR2.contentRange) {
        res.status(206);
        res.setHeader('Content-Range', fromR2.contentRange);
      }
      const nodeStream = bodyToNodeStream(fromR2.body);
      if (!nodeStream) {
        throw new AppError('File not found on storage', 404);
      }
      nodeStream.on('error', () => {
        if (!res.headersSent) res.status(500);
        res.end();
      });
      nodeStream.pipe(res);
      return;
    }
  }

  if (fileInfo.redirect && fileInfo.fileUrl) {
    // Proxy from R2 public URL when API GetObject is unavailable — still stream.
    const upstream = await fetch(fileInfo.fileUrl, {
      headers: range ? { Range: range } : undefined,
    });
    if (!upstream.ok && upstream.status !== 206) {
      throw new AppError('File not found on storage', 404);
    }
    const contentType = looksPdf
      ? 'application/pdf'
      : upstream.headers.get('content-type') ||
        fileInfo.mimeType ||
        'application/octet-stream';
    res.status(upstream.status);
    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Disposition', contentDisposition);
    const contentRange = upstream.headers.get('content-range');
    if (contentRange) res.setHeader('Content-Range', contentRange);
    const contentLength = upstream.headers.get('content-length');
    if (contentLength) res.setHeader('Content-Length', contentLength);
    if (!upstream.body) {
      res.end();
      return;
    }
    Readable.fromWeb(upstream.body).pipe(res);
    return;
  }

  if (!fileInfo.filePath) {
    throw new AppError('File not found on storage', 404);
  }

  res.setHeader('Content-Type', looksPdf ? 'application/pdf' : fileInfo.mimeType || 'application/octet-stream');
  res.setHeader('Content-Disposition', contentDisposition);
  fs.createReadStream(fileInfo.filePath).pipe(res);
});

export const serveAssetThumbnail = asyncHandler(async (req, res) => {
  const { buffer, mimeType } = await getAssetThumbnailBuffer(
    req.params.id,
    actorFromReq(req),
  );
  res.setHeader('Content-Type', mimeType || 'image/webp');
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
      folderId,
    } = req.body;

    const result = await createAsset({
      file: req.file,
      category,
      visibility,
      locationIds: normalizeLocationIds(locationIds),
      type,
      name: name || Name,
      userId: req.user.id,
      folderId: folderId || null,
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
    const { folderId, allFolders } = req.query;
    const result = await listAssets({
      ...actorFromReq(req),
      category,
      folderId: folderId || null,
      allFolders: allFolders === '1' || allFolders === 'true',
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

function actorWithId(req) {
  return { ...actorFromReq(req), id: req.user.id };
}

/** Folder + move handlers bound to a fixed category. */
export function makeFolderHandlers(category) {
  return {
    create: asyncHandler(async (req, res) => {
      const result = await folderService.createFolder(actorWithId(req), {
        category,
        name: req.body.name,
        parentId: req.body.parentId || null,
      });
      res.status(201).json(result);
    }),
    list: asyncHandler(async (req, res) => {
      const result = await folderService.listFolders(actorWithId(req), {
        category,
        parentId: req.query.parentId || null,
        allFolders: req.query.allFolders === '1' || req.query.allFolders === 'true',
      });
      res.json(result);
    }),
    get: asyncHandler(async (req, res) => {
      const result = await folderService.getFolder(actorWithId(req), req.params.id, category);
      res.json(result);
    }),
    path: asyncHandler(async (req, res) => {
      const result = await folderService.getFolderPath(
        actorWithId(req),
        req.params.id,
        category,
      );
      res.json(result);
    }),
    rename: asyncHandler(async (req, res) => {
      const result = await folderService.renameFolder(actorWithId(req), req.params.id, {
        category,
        name: req.body.name,
      });
      res.json(result);
    }),
    move: asyncHandler(async (req, res) => {
      const result = await folderService.moveFolder(actorWithId(req), req.params.id, {
        category,
        parentId: req.body.parentId ?? null,
      });
      res.json(result);
    }),
    remove: asyncHandler(async (req, res) => {
      try {
        const result = await folderService.deleteFolder(actorWithId(req), req.params.id, {
          category,
          force: req.query.force === '1' || req.query.force === 'true' || req.body?.force === true,
        });
        res.json(result);
      } catch (err) {
        if (err?.code === 'FOLDER_NOT_EMPTY') {
          res.status(409).json({
            error: err.message,
            message: err.message,
            code: err.code,
            assetCount: err.assetCount,
            subfolderCount: err.subfolderCount,
          });
          return;
        }
        throw err;
      }
    }),
    ensurePath: asyncHandler(async (req, res) => {
      const result = await folderService.ensureFolderPath(actorWithId(req), {
        category,
        parentId: req.body.parentId || null,
        pathParts: Array.isArray(req.body.pathParts) ? req.body.pathParts : [],
      });
      res.json(result);
    }),
    download: asyncHandler(async (req, res) => {
      const pack = await listFolderArchiveEntries(actorWithId(req), req.params.id, category);
      if (!pack.entries.length) {
        throw new AppError('This folder has no files to download', 404);
      }
      res.json(formatArchiveManifest(pack));
    }),
  };
}

export function makeMoveAssetsHandler(category) {
  return asyncHandler(async (req, res) => {
    const result = await moveAssets(actorWithId(req), {
      category,
      assetIds: req.body.assetIds || [],
      folderId: req.body.folderId ?? null,
    });
    res.json(result);
  });
}

export function makeBulkDeleteAssetsHandler(category) {
  return asyncHandler(async (req, res) => {
    const result = await bulkDeleteAssets(actorFromReq(req), {
      category,
      assetIds: req.body.assetIds || [],
    });
    res.json(result);
  });
}

export function makeBulkDownloadAssetsHandler(category) {
  return asyncHandler(async (req, res) => {
    const pack = await listAssetArchiveEntries(actorFromReq(req), {
      category,
      assetIds: req.body.assetIds || [],
    });
    if (!pack.entries.length) {
      throw new AppError('No downloadable files in this selection', 404);
    }
    res.json(formatArchiveManifest(pack));
  });
}
