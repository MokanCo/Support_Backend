import path from 'path';
import sharp from 'sharp';
import { AppError } from '../utils/AppError.js';

/** Raster formats we convert to WebP before storage. SVG stays as-is (vector). */
const CONVERTIBLE_MIME = new Set([
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/gif',
  'image/webp',
  'image/tiff',
  'image/bmp',
  'image/avif',
]);

const CONVERTIBLE_EXT = new Set([
  '.jpg',
  '.jpeg',
  '.png',
  '.gif',
  '.webp',
  '.tif',
  '.tiff',
  '.bmp',
  '.avif',
]);

export function isConvertibleImage(file) {
  if (!file) return false;
  const mime = String(file.mimetype || '').toLowerCase();
  if (CONVERTIBLE_MIME.has(mime)) return true;
  const ext = path.extname(file.originalname || '').toLowerCase();
  return CONVERTIBLE_EXT.has(ext);
}

function webpFileName(originalName, suffix = '') {
  const base = path.basename(originalName || 'image', path.extname(originalName || ''));
  const safe = (base || 'image').replace(/[^\w.\-()+ ]+/g, '_').slice(0, 180);
  return `${safe}${suffix}.webp`;
}

/**
 * Convert raster images to WebP to reduce storage size.
 * Non-images and SVG pass through unchanged.
 *
 * @param {{ buffer: Buffer; originalname: string; mimetype: string; size: number }} file
 * @returns {Promise<{ buffer: Buffer; originalname: string; mimetype: string; size: number; converted: boolean }>}
 */
export async function maybeConvertImageToWebp(file) {
  if (!file?.buffer?.length) return { ...file, converted: false };
  if (!isConvertibleImage(file)) {
    return {
      buffer: file.buffer,
      originalname: file.originalname,
      mimetype: file.mimetype,
      size: file.size,
      converted: false,
    };
  }

  try {
    const buffer = await sharp(file.buffer, { animated: false })
      .rotate() // honor EXIF orientation
      .webp({
        quality: 80,
        effort: 4,
      })
      .toBuffer();

    return {
      buffer,
      originalname: webpFileName(file.originalname),
      mimetype: 'image/webp',
      size: buffer.length,
      converted: true,
    };
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[images] WebP conversion failed', err?.message || err);
    throw new AppError(
      'Could not convert image to WebP. Try a different image file.',
      400,
    );
  }
}

/**
 * Small WebP card preview (CDN-friendly). Used for video frames and image assets.
 *
 * @param {Buffer} buffer
 * @param {{ originalname?: string; width?: number; quality?: number }} [opts]
 * @returns {Promise<{ buffer: Buffer; originalname: string; mimetype: string; size: number } | null>}
 */
export async function toWebpThumbnail(buffer, opts = {}) {
  if (!buffer?.length) return null;
  const width = opts.width ?? 640;
  const quality = opts.quality ?? 72;
  const originalname = opts.originalname || 'thumb.webp';
  try {
    const out = await sharp(buffer, { animated: false, failOn: 'none' })
      .rotate()
      .resize({ width, withoutEnlargement: true })
      .webp({ quality, effort: 4 })
      .toBuffer();
    if (!out.length) return null;
    return {
      buffer: out,
      originalname: webpFileName(originalname, '-thumb'),
      mimetype: 'image/webp',
      size: out.length,
    };
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('[images] WebP thumbnail failed', err?.message || err);
    return null;
  }
}
