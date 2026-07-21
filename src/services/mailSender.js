import dns from 'node:dns';
import net from 'node:net';
import nodemailer from 'nodemailer';

const DEFAULT_TIMEOUT_MS = 60_000;
const RENDER_MIN_TIMEOUT_MS = 55_000;

function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function cleanEnv(value) {
  if (value == null) return '';
  const trimmed = String(value).trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"'))
    || (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1).trim();
  }
  return trimmed;
}

function isRenderHost() {
  return Boolean(
    process.env.RENDER
    || process.env.RENDER_SERVICE_ID
    || process.env.RENDER_SERVICE_NAME,
  );
}

function effectiveTimeoutMs(requestedMs) {
  const base = requestedMs || DEFAULT_TIMEOUT_MS;
  if (isRenderHost()) {
    return Math.max(base, RENDER_MIN_TIMEOUT_MS);
  }
  return base;
}

function ipv4Lookup(hostname, _options, callback) {
  dns.lookup(hostname, { family: 4 }, callback);
}

export function getResendApiKey() {
  return cleanEnv(process.env.RESEND_API_KEY);
}

export function getDefaultFrom() {
  return (
    cleanEnv(process.env.RESEND_FROM)
    || cleanEnv(process.env.SMTP_FROM)
    || cleanEnv(process.env.SMTP_USER)
    || 'noreply@localhost'
  );
}

function normalizeRecipients(to) {
  if (!to) return [];
  const list = Array.isArray(to) ? to : [to];
  return [...new Set(list.map((e) => String(e).trim()).filter(Boolean))];
}

function smtpCredentials() {
  const user = cleanEnv(process.env.SMTP_USER);
  const pass = cleanEnv(process.env.SMTP_PASS);
  if (!user || !pass) return null;
  return { user, pass };
}

function smtpHost() {
  return cleanEnv(process.env.SMTP_HOST) || 'smtp.gmail.com';
}

/**
 * On Render always try 465 (SSL) then 587 — ignore SMTP_PORT=587 there (587 often hangs).
 * Locally honour SMTP_PORT when set.
 */
function smtpPortCandidates() {
  if (isRenderHost()) {
    return [
      { port: 465, secure: true },
      { port: 587, secure: false },
    ];
  }

  const explicit = cleanEnv(process.env.SMTP_PORT);
  if (explicit) {
    const port = Number(explicit);
    const secure =
      cleanEnv(process.env.SMTP_SECURE).toLowerCase() === 'true'
      || cleanEnv(process.env.SMTP_SECURE) === '1'
      || port === 465;
    return [{ port, secure }];
  }

  return [
    { port: 587, secure: false },
    { port: 465, secure: true },
  ];
}

function createSmtpTransport({ port, secure }) {
  const creds = smtpCredentials();
  if (!creds) return null;

  const host = smtpHost();
  return nodemailer.createTransport({
    host,
    port,
    secure,
    auth: creds,
    requireTLS: !secure && port === 587,
    connectionTimeout: 45_000,
    greetingTimeout: 45_000,
    socketTimeout: 60_000,
    tls: {
      servername: host,
      minVersion: 'TLSv1.2',
    },
    lookup: ipv4Lookup,
  });
}

function testTcpReachable(host, port, timeoutMs = 12_000) {
  return new Promise((resolve, reject) => {
    const socket = net.connect({ host, port, family: 4 });
    const timer = setTimeout(() => {
      socket.destroy();
      reject(new Error(`TCP connection timeout (${host}:${port})`));
    }, timeoutMs);
    socket.once('connect', () => {
      clearTimeout(timer);
      socket.end();
      resolve({ host, port, ok: true });
    });
    socket.once('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

async function sendViaResendHttp({ from, to, subject, text, html, replyTo }, timeoutMs) {
  const apiKey = getResendApiKey();
  if (!apiKey) return false;

  const recipients = normalizeRecipients(to);
  if (recipients.length === 0) return false;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from,
        to: recipients,
        subject,
        text: text || undefined,
        html: html || undefined,
        reply_to: replyTo || undefined,
      }),
      signal: controller.signal,
    });

    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      const msg = body?.message || body?.error || res.statusText;
      throw new Error(`Resend API ${res.status}: ${msg}`);
    }
    return true;
  } finally {
    clearTimeout(timer);
  }
}

/** Live SMTP + TCP diagnostics (for /health?verify=1). */
export async function verifyMailConnection() {
  const host = smtpHost();
  const status = getMailConfigStatus();
  if (!status.configured) {
    return { ok: false, error: 'SMTP_USER or SMTP_PASS missing', ...status };
  }

  const tcp = {};
  for (const port of [465, 587]) {
    try {
      // eslint-disable-next-line no-await-in-loop
      tcp[String(port)] = await testTcpReachable(host, port);
    } catch (e) {
      tcp[String(port)] = { ok: false, error: e?.message || String(e) };
    }
  }

  let smtpOk = false;
  let smtpVia = null;
  let lastError = null;

  for (const cfg of smtpPortCandidates()) {
    const transport = createSmtpTransport(cfg);
    try {
      // eslint-disable-next-line no-await-in-loop
      await transport.verify();
      smtpOk = true;
      smtpVia = `${host}:${cfg.port}`;
      break;
    } catch (e) {
      lastError = e?.message || String(e);
    }
  }

  return {
    ok: smtpOk,
    tcp,
    smtpVerified: smtpOk,
    smtpVia,
    resendAvailable: Boolean(getResendApiKey()),
    error: smtpOk ? null : lastError,
    hint: smtpOk
      ? null
      : tcp['465']?.ok === false && tcp['587']?.ok === false
        ? 'Gmail SMTP ports unreachable from Render. Add RESEND_API_KEY + RESEND_FROM as HTTPS fallback.'
        : 'TCP reachable but SMTP auth failed — regenerate Google App Password for SMTP_PASS.',
    ...status,
  };
}

/** @deprecated kept for boardMailService compatibility */
export function getSmtpTransport() {
  const candidates = smtpPortCandidates();
  return createSmtpTransport(candidates[0]);
}

export function isMailConfigured() {
  return Boolean(smtpCredentials()) || Boolean(getResendApiKey());
}

export function getMailConfigStatus() {
  const smtp = Boolean(smtpCredentials());
  const resend = Boolean(getResendApiKey());
  const candidates = smtpPortCandidates();
  const primary = candidates[0];
  return {
    configured: smtp || resend,
    provider: resend && !smtp ? 'resend' : smtp ? 'smtp' : null,
    smtp,
    resend,
    host: smtpHost(),
    port: primary.port,
    secure: primary.secure,
    portsTried: candidates.map((c) => c.port),
    render: isRenderHost(),
    from: getDefaultFrom(),
    hint: smtp || resend
      ? null
      : 'Set SMTP_USER + SMTP_PASS, or RESEND_API_KEY + RESEND_FROM.',
  };
}

function isRetryableSmtpError(err) {
  const msg = String(err?.message || err || '').toLowerCase();
  const code = String(err?.code || '').toUpperCase();
  return (
    code === 'ETIMEDOUT'
    || code === 'ESOCKET'
    || code === 'ECONNRESET'
    || code === 'ECONNREFUSED'
    || code === 'ENOTFOUND'
    || msg.includes('connection timeout')
    || msg.includes('timeout')
    || msg.includes('connect etimedout')
    || msg.includes('greeting never received')
  );
}

async function sendViaSmtp(transport, mailOptions, timeoutMs) {
  let timer;
  try {
    await Promise.race([
      transport.sendMail(mailOptions),
      new Promise((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`SMTP send timed out after ${timeoutMs}ms`)),
          timeoutMs,
        );
      }),
    ]);
    return true;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export async function dispatchEmail(
  { from, to, subject, text, html, replyTo },
  timeoutMs = DEFAULT_TIMEOUT_MS,
) {
  const mailFrom = from || getDefaultFrom();
  const recipients = normalizeRecipients(to);
  if (recipients.length === 0) {
    throw new Error('No recipients');
  }

  const limit = effectiveTimeoutMs(timeoutMs);
  const mailOptions = {
    from: mailFrom,
    to: recipients.length === 1 ? recipients[0] : recipients,
    subject,
    text,
    html,
    replyTo: replyTo || undefined,
  };

  const creds = smtpCredentials();
  let lastError;

  if (creds) {
    const host = smtpHost();
    const candidates = smtpPortCandidates();

    for (let i = 0; i < candidates.length; i += 1) {
      const cfg = candidates[i];
      const transport = createSmtpTransport(cfg);
      try {
        // eslint-disable-next-line no-await-in-loop
        await sendViaSmtp(transport, mailOptions, limit);
        if (i > 0) {
          // eslint-disable-next-line no-console
          console.info(`[mail] Sent via ${host}:${cfg.port} (fallback)`);
        }
        return true;
      } catch (err) {
        lastError = err;
        const hasNext = i < candidates.length - 1;
        // eslint-disable-next-line no-console
        console.error(
          `[mail] SMTP failed ${host}:${cfg.port} (secure=${cfg.secure})`,
          err?.message || err,
        );
        if (!isRetryableSmtpError(err) || !hasNext) {
          break;
        }
        // eslint-disable-next-line no-console
        console.warn(`[mail] Retrying SMTP on port ${candidates[i + 1].port}...`);
      }
    }
  }

  if (getResendApiKey()) {
    try {
      await sendViaResendHttp(
        { from: mailFrom, to: recipients, subject, text, html, replyTo },
        limit,
      );
      // eslint-disable-next-line no-console
      console.info('[mail] Sent via Resend HTTPS (SMTP fallback)');
      return true;
    } catch (err) {
      lastError = err;
      // eslint-disable-next-line no-console
      console.error('[mail] Resend fallback failed', err?.message || err);
    }
  }

  if (!creds && !getResendApiKey()) {
    throw new Error('Mail not configured (set SMTP_USER + SMTP_PASS or RESEND_API_KEY)');
  }

  throw lastError || new Error('SMTP send failed');
}

/** Startup diagnostics — does not block HTTP. */
export async function logMailProviderStatus() {
  const status = getMailConfigStatus();

  if (!status.configured) {
    // eslint-disable-next-line no-console
    console.warn('[mail] Not configured. Set SMTP_USER + SMTP_PASS (or RESEND_API_KEY).');
    return;
  }

  if (getResendApiKey()) {
    // eslint-disable-next-line no-console
    console.info('[mail] Resend HTTPS fallback available');
  }

  if (!smtpCredentials()) return;

  const host = smtpHost();
  let lastError;

  for (const cfg of smtpPortCandidates()) {
    const transport = createSmtpTransport(cfg);
    try {
      // eslint-disable-next-line no-await-in-loop
      await transport.verify();
      // eslint-disable-next-line no-console
      console.info(
        `[mail] SMTP verified (${host}:${cfg.port}, secure=${cfg.secure}, from ${status.from})`,
      );
      return;
    } catch (e) {
      lastError = e;
      // eslint-disable-next-line no-console
      console.error(`[mail] SMTP verify failed ${host}:${cfg.port}`, e?.message || e);
    }
  }

  // eslint-disable-next-line no-console
  console.error(
    '[mail] SMTP unavailable on all ports.',
    lastError?.message || lastError,
    getResendApiKey()
      ? '→ Emails will use Resend HTTPS fallback when sending.'
      : '→ Add RESEND_API_KEY + RESEND_FROM on Render for HTTPS fallback (port 443).',
  );
}

export { escapeHtml };
