import crypto from 'node:crypto';

export function bandwidthConfigured() {
  const client = process.env.BANDWIDTH_CLIENT_ID && process.env.BANDWIDTH_CLIENT_SECRET;
  const legacy = process.env.BANDWIDTH_USERNAME && process.env.BANDWIDTH_PASSWORD;
  return Boolean(client || legacy);
}

let cachedToken = '';
let cachedUntil = 0;

export async function bandwidthAccessToken() {
  const id = process.env.BANDWIDTH_CLIENT_ID || '';
  const secret = process.env.BANDWIDTH_CLIENT_SECRET || '';
  if (!id || !secret) return '';
  if (cachedToken && Date.now() < cachedUntil) return cachedToken;
  const response = await fetch('https://api.bandwidth.com/api/v1/oauth2/token', {
    method: 'POST',
    headers: {
      Authorization: `Basic ${Buffer.from(`${id}:${secret}`).toString('base64')}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials',
  });
  if (!response.ok) return '';
  const payload = await response.json();
  const token = String(payload.access_token || '');
  const expiresIn = Number(payload.expires_in) || 3600;
  cachedToken = token;
  cachedUntil = Date.now() + Math.max(30, expiresIn - 60) * 1000;
  return token;
}

export function bandwidthWebhooksReady() {
  const base = process.env.API_PUBLIC_URL || '';
  return Boolean(
    process.env.BANDWIDTH_WEBHOOK_USERNAME &&
      process.env.BANDWIDTH_WEBHOOK_PASSWORD &&
      base.startsWith('https://'),
  );
}

export function validateBandwidthRequest(req) {
  const user = process.env.BANDWIDTH_WEBHOOK_USERNAME || '';
  const pass = process.env.BANDWIDTH_WEBHOOK_PASSWORD || '';
  const base = process.env.API_PUBLIC_URL || '';
  if (!user || !pass || !base.startsWith('https://')) return false;
  const header = String(req.get('Authorization') || '');
  const expected = `Basic ${Buffer.from(`${user}:${pass}`).toString('base64')}`;
  const left = Buffer.from(header);
  const right = Buffer.from(expected);
  if (left.length !== right.length) return false;
  return crypto.timingSafeEqual(left, right);
}

export function bandwidthCallbackAuthAttributes(escapeXml) {
  const user = process.env.BANDWIDTH_WEBHOOK_USERNAME || '';
  const pass = process.env.BANDWIDTH_WEBHOOK_PASSWORD || '';
  const base = process.env.API_PUBLIC_URL || '';
  if (!user || !pass || !base.startsWith('https://')) return '';
  return ` username="${escapeXml(user)}" password="${escapeXml(pass)}"`;
}
