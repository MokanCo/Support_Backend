import crypto from 'node:crypto';

function safeEqual(leftValue, rightValue) {
  const left = Buffer.from(String(leftValue));
  const right = Buffer.from(String(rightValue));
  if (left.length !== right.length) return false;
  return crypto.timingSafeEqual(left, right);
}

function basicCredentials(header) {
  const match = /^Basic\s+([A-Za-z0-9+/=]+)\s*$/i.exec(String(header || '').trim());
  if (!match) return null;
  const decoded = Buffer.from(match[1], 'base64').toString('utf8');
  const split = decoded.indexOf(':');
  if (split < 0) return null;
  return { user: decoded.slice(0, split), pass: decoded.slice(split + 1) };
}

/**
 * Messaging callbacks use their own username and password.
 * Voice webhook credentials are not accepted here.
 * @param {import('express').Request} req
 * @param {NodeJS.ProcessEnv} [env]
 */
export function messagingRejectionReason(req, env = process.env) {
  const user = env.BANDWIDTH_MESSAGING_USERNAME || '';
  const pass = env.BANDWIDTH_MESSAGING_PASSWORD || '';
  const base = env.API_PUBLIC_URL || '';
  if (!user || !pass) return 'messaging_credentials_missing';
  if (!base.startsWith('https://')) return 'public_url_not_https';
  const header = req.get('Authorization') || '';
  if (!String(header).trim()) return 'authorization_missing';
  const supplied = basicCredentials(header);
  if (!supplied) return 'authorization_not_basic';
  if (!safeEqual(supplied.user, user) || !safeEqual(supplied.pass, pass)) return 'authorization_mismatch';
  return '';
}
