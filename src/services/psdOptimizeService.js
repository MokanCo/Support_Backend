import path from 'path';
import { readPsd, writePsdBuffer } from 'ag-psd';
import { AppError } from '../utils/AppError.js';

const PSD_EXT = new Set(['.psd', '.psb']);
const PSD_MIME = new Set([
  'image/vnd.adobe.photoshop',
  'application/x-photoshop',
  'image/x-psd',
  'application/photoshop',
]);

/** Pathological PSDs can declare huge canvases/layer counts without encoding
 *  any real data — guard against decoding something that would exhaust memory. */
const MAX_PSD_DIMENSION = 30000;
const MAX_PSD_LAYERS = 2000;
const PSD_MEMORY_LIMIT = 2 * 1024 * 1024 * 1024;

export function isPsdFile(file) {
  if (!file) return false;
  const ext = path.extname(file.originalname || '').toLowerCase();
  if (PSD_EXT.has(ext)) return true;
  return !ext && PSD_MIME.has(String(file.mimetype || '').toLowerCase());
}

function assertLayerCountWithinLimit(psd) {
  let total = 0;
  function walk(layers) {
    for (const layer of layers || []) {
      total += 1;
      if (total > MAX_PSD_LAYERS) {
        throw new AppError('PSD has too many layers to process', 400);
      }
      if (layer.children) walk(layer.children);
    }
  }
  walk(psd.children);
}

/**
 * Re-encode a PSD using ZIP container compression instead of the raw/RLE
 * channel data Photoshop writes by default. `useRawData` keeps layer and
 * composite pixel bytes exactly as stored — only the compression mode they
 * are packed with changes — so this is lossless, not a re-sample.
 */
function recompress(psd, isLargeDocFormat) {
  if (psd.width > MAX_PSD_DIMENSION || psd.height > MAX_PSD_DIMENSION) {
    throw new AppError('PSD canvas is too large to process', 400);
  }
  assertLayerCountWithinLimit(psd);
  return writePsdBuffer(psd, { compress: true, psb: isLargeDocFormat });
}

/**
 * Always attempt to losslessly shrink a PSD before storage — the upload is
 * already capped at the same size limit as every other file type (enforced
 * upstream by multer), so this always runs on a bounded-size input. Falls
 * back to the original buffer if parsing fails or re-encoding doesn't
 * actually help (some PSDs are already ZIP-compressed) — this function never
 * returns something larger than what came in. No preview/thumbnail is
 * generated — PSDs are shown with a generic Photoshop icon in the UI instead.
 */
export async function maybeCompressPsd(file) {
  if (!file?.buffer?.length || !isPsdFile(file)) {
    return { buffer: file?.buffer, originalname: file?.originalname, mimetype: file?.mimetype, size: file?.size, converted: false };
  }

  const ext = path.extname(file.originalname || '').toLowerCase();
  const isLargeDocFormat = ext === '.psb';

  try {
    const psd = readPsd(file.buffer, {
      useRawData: true,
      totalMemoryLimit: PSD_MEMORY_LIMIT,
    });

    const compressed = recompress(psd, isLargeDocFormat);
    const useCompressed = Boolean(compressed?.length) && compressed.length < file.buffer.length;

    return {
      buffer: useCompressed ? compressed : file.buffer,
      originalname: file.originalname,
      mimetype: 'image/vnd.adobe.photoshop',
      size: useCompressed ? compressed.length : file.buffer.length,
      converted: useCompressed,
    };
  } catch (err) {
    if (err instanceof AppError) throw err;
    // eslint-disable-next-line no-console
    console.warn('[psd] compression failed, storing original file', err?.message || err);
    return {
      buffer: file.buffer,
      originalname: file.originalname,
      mimetype: file.mimetype || 'image/vnd.adobe.photoshop',
      size: file.buffer.length,
      converted: false,
    };
  }
}
