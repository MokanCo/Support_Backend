import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { randomUUID } from 'crypto';
import { spawn } from 'child_process';
import ffmpegPath from 'ffmpeg-static';
import { AppError } from '../utils/AppError.js';
import { toWebpThumbnail } from './imageOptimizeService.js';

const CONVERTIBLE_MIME = new Set([
  'video/mp4',
  'video/quicktime',
  'video/x-msvideo',
  'video/x-matroska',
  'video/webm',
  'video/mpeg',
  'video/3gpp',
  'video/x-ms-wmv',
  'video/avi',
]);

const CONVERTIBLE_EXT = new Set([
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

/** Browser-friendly formats — upload as-is (only thumbnail extracted). */
const PASSTHROUGH_EXT = new Set(['.mp4', '.m4v', '.webm']);
const PASSTHROUGH_MIME = new Set(['video/mp4', 'video/webm']);

export function isConvertibleVideo(file) {
  if (!file) return false;
  const mime = String(file.mimetype || '').toLowerCase();
  if (mime.startsWith('video/') || CONVERTIBLE_MIME.has(mime)) return true;
  const ext = path.extname(file.originalname || '').toLowerCase();
  return CONVERTIBLE_EXT.has(ext);
}

function shouldPassthrough(file) {
  const ext = path.extname(file.originalname || '').toLowerCase();
  const mime = String(file.mimetype || '').toLowerCase();
  return PASSTHROUGH_EXT.has(ext) || PASSTHROUGH_MIME.has(mime);
}

function webmFileName(originalName) {
  const base = path.basename(originalName || 'video', path.extname(originalName || ''));
  const safe = (base || 'video').replace(/[^\w.\-()+ ]+/g, '_').slice(0, 180);
  return `${safe}.webm`;
}

function runFfmpeg(args) {
  return new Promise((resolve, reject) => {
    if (!ffmpegPath) {
      reject(new Error('ffmpeg-static binary is not available'));
      return;
    }
    const child = spawn(ffmpegPath, args, { windowsHide: true });
    let stderr = '';
    child.stderr.on('data', (chunk) => {
      stderr += String(chunk);
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(stderr.slice(-2000) || `ffmpeg exited with code ${code}`));
    });
  });
}

/**
 * Grab a single frame near the start, then convert to WebP for CDN card previews.
 * Soft-fails to null so a bad frame never blocks the video upload.
 */
async function extractThumbnail(inputPath, originalName) {
  const framePath = path.join(path.dirname(inputPath), `${randomUUID()}.jpg`);
  const attempts = [
    // Fast keyframe seek
    ['-y', '-ss', '0.5', '-i', inputPath, '-frames:v', '1', '-vf', 'scale=640:-2', '-q:v', '5', framePath],
    // Accurate decode fallback (some files have no early keyframe)
    ['-y', '-i', inputPath, '-ss', '1', '-frames:v', '1', '-vf', 'scale=640:-2', '-q:v', '5', framePath],
    ['-y', '-i', inputPath, '-frames:v', '1', '-vf', 'scale=640:-2', '-q:v', '5', framePath],
  ];

  try {
    for (const args of attempts) {
      try {
        await runFfmpeg(args);
        const frame = await fs.readFile(framePath);
        if (!frame.length) continue;
        const webp = await toWebpThumbnail(frame, { originalname: originalName || 'video' });
        if (webp?.buffer?.length) return webp;
      } catch {
        /* try next */
      }
    }
    return null;
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('[video] thumbnail extraction failed', err?.message || err);
    return null;
  } finally {
    await fs.unlink(framePath).catch(() => {});
  }
}

/**
 * Extract a thumbnail from an in-memory video buffer (used for on-demand
 * generation when an older asset has no thumbnailUrl in production).
 */
export async function extractThumbnailFromVideoBuffer(videoBuffer, originalName = 'video.mp4') {
  if (!videoBuffer?.length) return null;
  const ext = path.extname(originalName || '').toLowerCase() || '.mp4';
  const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'ar-thumb-'));
  const inputPath = path.join(tmpRoot, `in${ext}`);
  try {
    await fs.writeFile(inputPath, videoBuffer);
    return await extractThumbnail(inputPath, originalName);
  } finally {
    await fs.rm(tmpRoot, { recursive: true, force: true }).catch(() => {});
  }
}

/**
 * Prepare video for storage:
 * - MP4 / WebM: passthrough (fast) + WebP thumbnail
 * - Other formats: fast VP8 WebM re-encode + WebP thumbnail
 *
 * @param {{ buffer: Buffer; originalname: string; mimetype: string; size: number }} file
 */
export async function maybeConvertVideoToWebm(file) {
  if (!file?.buffer?.length) return { ...file, converted: false, thumbnail: null };
  if (!isConvertibleVideo(file)) {
    return {
      buffer: file.buffer,
      originalname: file.originalname,
      mimetype: file.mimetype,
      size: file.size,
      converted: false,
      thumbnail: null,
    };
  }

  const ext = path.extname(file.originalname || '').toLowerCase();
  const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'ar-video-'));
  const inputPath = path.join(tmpRoot, `in${ext || '.mp4'}`);
  const outputPath = path.join(tmpRoot, `${randomUUID()}.webm`);

  try {
    await fs.writeFile(inputPath, file.buffer);
    const thumbnail = await extractThumbnail(inputPath, file.originalname);

    // Fast path: keep browser-native MP4/WebM without re-encoding.
    if (shouldPassthrough(file)) {
      const mime =
        ext === '.webm' || String(file.mimetype || '').includes('webm')
          ? 'video/webm'
          : 'video/mp4';
      return {
        buffer: file.buffer,
        originalname: file.originalname,
        mimetype: mime,
        size: file.size,
        converted: false,
        thumbnail,
      };
    }

    // Fast WebM (VP8) for formats that need conversion — realtime deadline.
    await runFfmpeg([
      '-y',
      '-i',
      inputPath,
      '-vf',
      "scale='min(1280,iw)':-2",
      '-c:v',
      'libvpx',
      '-b:v',
      '1.2M',
      '-deadline',
      'realtime',
      '-cpu-used',
      '8',
      '-c:a',
      'libvorbis',
      '-q:a',
      '4',
      '-ac',
      '2',
      outputPath,
    ]);

    const buffer = await fs.readFile(outputPath);
    if (!buffer.length) {
      throw new Error('Converted WebM file is empty');
    }

    return {
      buffer,
      originalname: webmFileName(file.originalname),
      mimetype: 'video/webm',
      size: buffer.length,
      converted: true,
      thumbnail,
    };
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[video] processing failed', err?.message || err);
    throw new AppError(
      'Could not process video. Try an MP4 file or a shorter clip.',
      400,
    );
  } finally {
    await fs.rm(tmpRoot, { recursive: true, force: true }).catch(() => {});
  }
}
