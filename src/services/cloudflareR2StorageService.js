import { randomUUID } from 'crypto';
import path from 'path';
import { Readable } from 'node:stream';
import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { AppError } from '../utils/AppError.js';

/**
 * Cloudflare R2 storage (S3-compatible) with separate buckets per category.
 *
 * Shared credentials:
 *   CLOUDFLARE_ACCOUNT_ID
 *   CLOUDFLARE_R2_ACCESS_KEY
 *   CLOUDFLARE_R2_SECRET_KEY
 *
 * Documents bucket:
 *   CLOUDFLARE_R2_DOCUMENTS_BUCKET_NAME
 *   CLOUDFLARE_R2_DOCUMENTS_PUBLIC_BASE_URL
 *
 * Marketing assets bucket:
 *   CLOUDFLARE_R2_MARKETING_BUCKET_NAME
 *   CLOUDFLARE_R2_MARKETING_PUBLIC_BASE_URL
 *
 * Legacy single-bucket fallback (optional):
 *   CLOUDFLARE_R2_BUCKET_NAME
 *   CLOUDFLARE_R2_PUBLIC_BASE_URL
 */

const CATEGORY_ENV = {
  documents: {
    bucket: 'CLOUDFLARE_R2_DOCUMENTS_BUCKET_NAME',
    publicUrl: 'CLOUDFLARE_R2_DOCUMENTS_PUBLIC_BASE_URL',
    folder: 'documents',
  },
  marketing_assets: {
    bucket: 'CLOUDFLARE_R2_MARKETING_BUCKET_NAME',
    publicUrl: 'CLOUDFLARE_R2_MARKETING_PUBLIC_BASE_URL',
    folder: 'marketing-assets',
  },
};

let cachedClient = undefined;

function getCredentials() {
  return {
    accountId: process.env.CLOUDFLARE_ACCOUNT_ID?.trim(),
    accessKeyId: process.env.CLOUDFLARE_R2_ACCESS_KEY?.trim(),
    secretAccessKey: process.env.CLOUDFLARE_R2_SECRET_KEY?.trim(),
  };
}

/**
 * Resolve bucket + public URL for a category.
 * Prefers category-specific env vars; falls back to the legacy single-bucket vars.
 */
function getBucketConfig(category) {
  const mapping = CATEGORY_ENV[category];
  if (!mapping) {
    throw new AppError(`Unknown storage category: ${category}`, 400);
  }

  const categoryBucket = process.env[mapping.bucket]?.trim();
  const categoryPublicUrl = (process.env[mapping.publicUrl] || '').trim().replace(/\/$/, '');
  const legacyBucket = process.env.CLOUDFLARE_R2_BUCKET_NAME?.trim();
  const legacyPublicUrl = (process.env.CLOUDFLARE_R2_PUBLIC_BASE_URL || '').trim().replace(/\/$/, '');

  return {
    bucketName: categoryBucket || legacyBucket,
    publicBaseUrl: categoryPublicUrl || legacyPublicUrl,
    folder: mapping.folder,
  };
}

export function isR2Configured(category) {
  const { accountId, accessKeyId, secretAccessKey } = getCredentials();
  if (!accountId || !accessKeyId || !secretAccessKey) return false;

  if (category) {
    const { bucketName } = getBucketConfig(category);
    return Boolean(bucketName);
  }

  return (
    isR2Configured('documents') || isR2Configured('marketing_assets')
  );
}

export function publicUrlForKey(category, key) {
  if (!key) return '';
  const { publicBaseUrl } = getBucketConfig(category);
  if (!publicBaseUrl) return '';
  return `${publicBaseUrl}/${String(key).replace(/^\/+/, '')}`;
}

/**
 * Read an object from R2 by key. Used so production can serve files without
 * relying on a public CDN URL or a local uploads/ folder.
 */
export async function getObjectBuffer(category, key) {
  if (!key) return null;
  const client = getClient();
  const { bucketName } = getBucketConfig(category);
  if (!client || !bucketName) return null;
  try {
    const out = await client.send(
      new GetObjectCommand({
        Bucket: bucketName,
        Key: String(key).replace(/^\/+/, ''),
      }),
    );
    const bytes = await out.Body.transformToByteArray();
    if (!bytes?.length) return null;
    return {
      buffer: Buffer.from(bytes),
      contentType: out.ContentType || 'application/octet-stream',
    };
  } catch (err) {
    const status = err?.$metadata?.httpStatusCode;
    if (status !== 404) {
      // eslint-disable-next-line no-console
      console.warn(`[r2] getObject failed key=${key} status=${status} ${err?.name || err?.message}`);
    }
    return null;
  }
}

/**
 * Stream an object (supports HTTP Range so PDF viewers can show the first pages quickly).
 * @returns {Promise<{ body: import('stream').Readable | ReadableStream; contentType: string; contentLength?: number; contentRange?: string } | null>}
 */
export async function getObjectStream(category, key, range) {
  const client = getClient();
  const { bucketName } = getBucketConfig(category);
  if (!client || !bucketName) return null;
  try {
    const out = await client.send(
      new GetObjectCommand({
        Bucket: bucketName,
        Key: String(key).replace(/^\/+/, ''),
        ...(range ? { Range: String(range) } : {}),
      }),
    );
    if (!out.Body) return null;
    return {
      body: out.Body,
      contentType: out.ContentType || 'application/octet-stream',
      contentLength: out.ContentLength,
      contentRange: out.ContentRange,
    };
  } catch (err) {
    const status = err?.$metadata?.httpStatusCode;
    if (status === 416) {
      const rangeErr = new AppError('Requested range not satisfiable', 416);
      throw rangeErr;
    }
    if (status !== 404) {
      // eslint-disable-next-line no-console
      console.warn(`[r2] getObjectStream failed key=${key} status=${status} ${err?.name || err?.message}`);
    }
    return null;
  }
}

export function bodyToNodeStream(body) {
  if (!body) return null;
  if (typeof body.pipe === 'function') return body;
  return Readable.fromWeb(body);
}

/**
 * Direct-to-R2 GET URL. ResponseContentType lets the browser treat PDFs as PDFs
 * even when the stored object metadata is wrong.
 */
export async function getPresignedGetUrl(category, key, options = {}) {
  const client = getClient();
  const { bucketName } = getBucketConfig(category);
  if (!client || !bucketName || !key) return null;
  const filename = String(options.filename || 'file')
    .replace(/["\r\n]/g, '_')
    .slice(0, 180);
  try {
    const command = new GetObjectCommand({
      Bucket: bucketName,
      Key: String(key).replace(/^\/+/, ''),
      ...(options.contentType ? { ResponseContentType: options.contentType } : {}),
      ResponseContentDisposition: `inline; filename="${filename}"`,
    });
    return await getSignedUrl(client, command, {
      expiresIn: Number(options.expiresIn) || 300,
    });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn(`[r2] presign failed key=${key} ${err?.name || err?.message}`);
    return null;
  }
}

function getClient() {
  if (cachedClient !== undefined) return cachedClient;
  const { accountId, accessKeyId, secretAccessKey } = getCredentials();
  if (!accountId || !accessKeyId || !secretAccessKey) {
    cachedClient = null;
    return null;
  }
  cachedClient = new S3Client({
    region: 'auto',
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId, secretAccessKey },
    // AWS SDK v3 default checksums can break R2 signatures (401 Unauthorized).
    requestChecksumCalculation: 'WHEN_REQUIRED',
    responseChecksumValidation: 'WHEN_REQUIRED',
  });
  return cachedClient;
}

function sanitizeExt(originalName) {
  const ext = path.extname(originalName || '').toLowerCase().slice(0, 16);
  return /^[a-z0-9.]+$/i.test(ext) ? ext : '';
}

/**
 * @param {{ buffer: Buffer; originalname: string; mimetype: string; size: number }} file
 * @param {{ category: 'documents' | 'marketing_assets'; folder?: string }} options
 * @returns {Promise<{ key: string; fileUrl: string; originalName: string; contentType: string; fileSize: number }>}
 */
export async function uploadFile(file, options = {}) {
  const category = options.category || 'documents';

  if (!isR2Configured(category)) {
    throw new AppError(
      `Cloudflare R2 is not configured for ${category}. Set CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_R2_ACCESS_KEY, CLOUDFLARE_R2_SECRET_KEY, and the category bucket + public URL env vars.`,
      503,
    );
  }
  if (!file?.buffer?.length) {
    throw new AppError('File content is required', 400);
  }

  const client = getClient();
  const { bucketName, folder: defaultFolder } = getBucketConfig(category);
  const folder = (options.folder || defaultFolder).replace(/^\/+|\/+$/g, '');
  const ext = sanitizeExt(file.originalname);
  const key = `${folder}/${Date.now()}-${randomUUID().replace(/-/g, '').slice(0, 12)}${ext}`;

  try {
    await client.send(
      new PutObjectCommand({
        Bucket: bucketName,
        Key: key,
        Body: file.buffer,
        ContentType: file.mimetype || 'application/octet-stream',
        ContentLength: file.size,
      }),
    );
  } catch (err) {
    const code = err?.Code || err?.name || '';
    const status = err?.$metadata?.httpStatusCode;
    // eslint-disable-next-line no-console
    console.error(`[r2] upload failed bucket=${bucketName} key=${key} code=${code} status=${status}`);
    if (code === 'AccessDenied' || status === 403) {
      throw new AppError(
        `Cloudflare R2 Access Denied for bucket "${bucketName}". Create an R2 API token with Object Read & Write permission on this bucket (R2 → Manage R2 API Tokens), then update CLOUDFLARE_R2_ACCESS_KEY and CLOUDFLARE_R2_SECRET_KEY, and restart the server.`,
        503,
      );
    }
    if (code === 'Unauthorized' || status === 401) {
      throw new AppError(
        `Cloudflare R2 Unauthorized for bucket "${bucketName}". Check CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_R2_ACCESS_KEY, and CLOUDFLARE_R2_SECRET_KEY (must be an R2 S3 API token), then restart the server so .env changes load.`,
        503,
      );
    }
    if (code === 'NoSuchBucket' || status === 404) {
      throw new AppError(
        `Cloudflare R2 bucket "${bucketName}" was not found. Check CLOUDFLARE_R2_DOCUMENTS_BUCKET_NAME / CLOUDFLARE_R2_MARKETING_BUCKET_NAME.`,
        503,
      );
    }
    throw new AppError(
      `Failed to upload file to Cloudflare R2 (${code || 'unknown error'}).`,
      503,
    );
  }

  return {
    key,
    fileUrl: publicUrlForKey(category, key),
    originalName: file.originalname,
    contentType: file.mimetype || 'application/octet-stream',
    fileSize: file.size,
  };
}

export const CloudflareR2StorageService = {
  isConfigured: isR2Configured,
  uploadFile,
  getObjectBuffer,
  getObjectStream,
  getPresignedGetUrl,
  publicUrlForKey,
};
