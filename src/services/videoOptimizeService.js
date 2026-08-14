import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { randomUUID } from 'crypto';
import { spawn } from 'child_process';
import ffmpegPath from 'ffmpeg-static';
import { AppError } from '../utils/AppError.js';

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

export function isConvertibleVideo(file) {
  if (!file) return false;
  const mime = String(file.mimetype || '').toLowerCase();
  if (mime.startsWith('video/') || CONVERTIBLE_MIME.has(mime)) return true;
  const ext = path.extname(file.originalname || '').toLowerCase();
  return CONVERTIBLE_EXT.has(ext);
}

function webmFileName(originalName) {
  const base = path.basename(originalName || 'video', path.extname(originalName || ''));
  const safe = (base || 'video').replace(/[^\w.\-()+ ]+/g, '_').slice(0, 180);
  return `${safe}.webm`;
}

function thumbFileName(originalName) {
  const base = path.basename(originalName || 'video', path.extname(originalName || ''));
  const safe = (base || 'video').replace(/[^\w.\-()+ ]+/g, '_').slice(0, 180);
  return `${safe}-thumb.jpg`;
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
 * Grab a single frame near the start for the asset card thumbnail.
 * Soft-fails to null so a bad frame never blocks the video upload.
 */
async function extractThumbnail(inputPath, originalName) {
  const thumbPath = path.join(path.dirname(inputPath), `${randomUUID()}.jpg`);
  try {
    await runFfmpeg([
      '-y',
      '-ss',
      '0.25',
      '-i',
      inputPath,
      '-frames:v',
      '1',
      '-vf',
      'scale=640:-2',
      '-q:v',
      '4',
      thumbPath,
    ]);
    const buffer = await fs.readFile(thumbPath);
    if (!buffer.length) return null;
    return {
      buffer,
      originalname: thumbFileName(originalName),
      mimetype: 'image/jpeg',
      size: buffer.length,
    };
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('[video] thumbnail extraction failed', err?.message || err);
    return null;
  } finally {
    await fs.unlink(thumbPath).catch(() => {});
  }
}

/**
 * Convert uploaded video to WebM (VP9 + Opus) and extract a JPEG thumbnail.
 * Already-WebM files pass through (still get a thumbnail). Non-videos pass through.
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
  const mime = String(file.mimetype || '').toLowerCase();
  const alreadyWebm = ext === '.webm' || mime === 'video/webm';

  const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'ar-video-'));
  const inputPath = path.join(tmpRoot, `in${ext || '.mp4'}`);
  const outputPath = path.join(tmpRoot, `${randomUUID()}.webm`);

  try {
    await fs.writeFile(inputPath, file.buffer);
    const thumbnail = await extractThumbnail(inputPath, file.originalname);

    if (alreadyWebm) {
      return {
        buffer: file.buffer,
        originalname: webmFileName(file.originalname),
        mimetype: 'video/webm',
        size: file.size,
        converted: false,
        thumbnail,
      };
    }

    // VP9 + Opus: solid browser support, smaller than typical source uploads.
    await runFfmpeg([
      '-y',
      '-i',
      inputPath,
      '-c:v',
      'libvpx-vp9',
      '-crf',
      '36',
      '-b:v',
      '0',
      '-row-mt',
      '1',
      '-deadline',
      'good',
      '-cpu-used',
      '4',
      '-c:a',
      'libopus',
      '-b:a',
      '96k',
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
    console.error('[video] WebM conversion failed', err?.message || err);
    throw new AppError(
      'Could not convert video to WebM. Try a shorter clip or a different format (MP4/MOV).',
      400,
    );
  } finally {
    await fs.rm(tmpRoot, { recursive: true, force: true }).catch(() => {});
  }
}
