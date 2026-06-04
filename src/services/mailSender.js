import dns from 'node:dns';
import net from 'node:net';
import nodemailer from 'nodemailer';

const DEFAULT_TIMEOUT_MS = 45_000;

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

function ipv4Lookup(hostname, _options, callback) {
  dns.lookup(hostname, { family: 4 }, callback);
}

export function getDefaultFrom() {
  return cleanEnv(process.env.SMTP_FROM) || cleanEnv(process.env.SMTP_USER) || 'noreply@localhost';
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

/** Port / TLS combinations to try (465 first on Render — 587 often times out there). */
function smtpPortCandidates() {
  const explicit = cleanEnv(process.env.SMTP_PORT);
  if (explicit) {
    const port = Number(explicit);
    const secure =
      cleanEnv(process.env.SMTP_SECURE).toLowerCase() === 'true'
      || cleanEnv(process.env.SMTP_SECURE) === '1'
      || port === 465;
    return [{ port, secure }];
  }

  if (isRenderHost()) {
    return [
      { port: 465, secure: true },
      { port: 587, secure: false },
    ];
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
    connectionTimeout: 30_000,
    greetingTimeout: 30_000,
    socketTimeout: 45_000,
    tls: {
      servername: host,
      minVersion: 'TLSv1.2',
    },
    lookup: ipv4Lookup,
  });
}

function createGmailServiceTransport() {
  const creds = smtpCredentials();
  if (!creds) return null;
  return nodemailer.createTransport({
    service: 'gmail',
    auth: creds,
    connectionTimeout: 30_000,
    greetingTimeout: 30_000,
    socketTimeout: 45_000,
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

  if (!smtpOk) {
    const gmailTransport = createGmailServiceTransport();
    if (gmailTransport) {
      try {
        await gmailTransport.verify();
        smtpOk = true;
        smtpVia = 'gmail-service';
      } catch (e) {
        lastError = e?.message || String(e);
      }
    }
  }

  return {
    ok: smtpOk,
    tcp,
    smtpVerified: smtpOk,
    smtpVia,
    error: smtpOk ? null : lastError,
    hint: smtpOk
      ? null
      : tcp['465']?.ok === false && tcp['587']?.ok === false
        ? 'Cannot reach Gmail SMTP from this server. Check Render instance type and Google Workspace SMTP settings.'
        : 'TCP works but SMTP auth failed — regenerate Google App Password and update SMTP_PASS on Render.',
    ...status,
  };
}

/** @deprecated kept for boardMailService compatibility */
export function getSmtpTransport() {
  const candidates = smtpPortCandidates();
  return createSmtpTransport(candidates[0]);
}

export function isMailConfigured() {
  return Boolean(smtpCredentials());
}

export function getMailConfigStatus() {
  const configured = isMailConfigured();
  const candidates = smtpPortCandidates();
  const primary = candidates[0];
  return {
    configured,
    provider: 'smtp',
    host: smtpHost(),
    port: primary.port,
    secure: primary.secure,
    portsTried: candidates.map((c) => c.port),
    render: isRenderHost(),
    from: getDefaultFrom(),
    hint: configured
      ? null
      : 'Set SMTP_USER and SMTP_PASS in environment variables.',
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
  const creds = smtpCredentials();
  if (!creds) {
    throw new Error('Mail not configured (set SMTP_USER + SMTP_PASS)');
  }

  const mailFrom = from || getDefaultFrom();
  const recipients = normalizeRecipients(to);
  if (recipients.length === 0) {
    throw new Error('No recipients');
  }

  const mailOptions = {
    from: mailFrom,
    to: recipients.length === 1 ? recipients[0] : recipients,
    subject,
    text,
    html,
    replyTo: replyTo || undefined,
  };

  const host = smtpHost();
  const candidates = smtpPortCandidates();
  let lastError;

  for (let i = 0; i < candidates.length; i += 1) {
    const cfg = candidates[i];
    const transport = createSmtpTransport(cfg);
    try {
      // eslint-disable-next-line no-await-in-loop
      await sendViaSmtp(transport, mailOptions, timeoutMs);
      if (i > 0) {
        // eslint-disable-next-line no-console
        console.info(`[mail] Sent via ${host}:${cfg.port} (fallback)`);
      }
      return true;
    } catch (err) {
      lastError = err;
      const retryable = isRetryableSmtpError(err);
      const hasNext = i < candidates.length - 1;
      // eslint-disable-next-line no-console
      console.error(
        `[mail] SMTP failed ${host}:${cfg.port} (secure=${cfg.secure})`,
        err?.message || err,
      );
      if (!retryable || !hasNext) {
        break;
      }
      // eslint-disable-next-line no-console
      console.warn(`[mail] Retrying SMTP on port ${candidates[i + 1].port}...`);
    }
  }

  const gmailTransport = createGmailServiceTransport();
  if (gmailTransport) {
    try {
      await sendViaSmtp(gmailTransport, mailOptions, timeoutMs);
      // eslint-disable-next-line no-console
      console.info('[mail] Sent via gmail-service (fallback)');
      return true;
    } catch (err) {
      lastError = err;
      // eslint-disable-next-line no-console
      console.error('[mail] Gmail service transport failed', err?.message || err);
    }
  }

  throw lastError || new Error('SMTP send failed');
}

/** Startup diagnostics — does not block HTTP. */
export async function logMailProviderStatus() {
  const status = getMailConfigStatus();

  if (!status.configured) {
    // eslint-disable-next-line no-console
    console.warn('[mail] SMTP not configured. Set SMTP_USER and SMTP_PASS.');
    return;
  }

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

  const gmailTransport = createGmailServiceTransport();
  if (gmailTransport) {
    try {
      await gmailTransport.verify();
      // eslint-disable-next-line no-console
      console.info(`[mail] SMTP verified (gmail-service, from ${status.from})`);
      return;
    } catch (e) {
      lastError = e;
      // eslint-disable-next-line no-console
      console.error('[mail] Gmail service verify failed', e?.message || e);
    }
  }

  // eslint-disable-next-line no-console
  console.error(
    '[mail] All SMTP methods failed.',
    lastError?.message || lastError,
    '→ Check SMTP_PASS (Google App Password) on Render and Google Admin → Apps → Google Workspace → Gmail → SMTP relay settings.',
  );
}

export { escapeHtml };
