import nodemailer from 'nodemailer';

let smtpTransport;

const DEFAULT_TIMEOUT_MS = 25_000;

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

export function getDefaultFrom() {
  return cleanEnv(process.env.SMTP_FROM) || cleanEnv(process.env.SMTP_USER) || 'noreply@localhost';
}

function normalizeRecipients(to) {
  if (!to) return [];
  const list = Array.isArray(to) ? to : [to];
  return [...new Set(list.map((e) => String(e).trim()).filter(Boolean))];
}

export function getSmtpTransport() {
  if (smtpTransport !== undefined) return smtpTransport;

  const user = cleanEnv(process.env.SMTP_USER);
  const pass = cleanEnv(process.env.SMTP_PASS);
  if (!user || !pass) {
    smtpTransport = null;
    return null;
  }

  const host = cleanEnv(process.env.SMTP_HOST) || 'smtp.gmail.com';
  const port = Number(cleanEnv(process.env.SMTP_PORT) || '587');
  const secure =
    cleanEnv(process.env.SMTP_SECURE).toLowerCase() === 'true'
    || cleanEnv(process.env.SMTP_SECURE) === '1'
    || port === 465;

  smtpTransport = nodemailer.createTransport({
    host,
    port,
    secure,
    auth: { user, pass },
    requireTLS: !secure && port === 587,
    connectionTimeout: 15_000,
    greetingTimeout: 15_000,
    socketTimeout: 20_000,
  });

  return smtpTransport;
}

export function isMailConfigured() {
  return Boolean(cleanEnv(process.env.SMTP_USER) && cleanEnv(process.env.SMTP_PASS));
}

export function getMailConfigStatus() {
  const configured = isMailConfigured();
  return {
    configured,
    provider: 'smtp',
    host: cleanEnv(process.env.SMTP_HOST) || 'smtp.gmail.com',
    port: Number(cleanEnv(process.env.SMTP_PORT) || '587'),
    from: getDefaultFrom(),
    hint: configured ? null : 'Set SMTP_USER and SMTP_PASS in environment variables.',
  };
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

  const transport = getSmtpTransport();
  if (!transport) {
    throw new Error('Mail not configured (set SMTP_USER + SMTP_PASS)');
  }

  return sendViaSmtp(
    transport,
    {
      from: mailFrom,
      to: recipients.length === 1 ? recipients[0] : recipients,
      subject,
      text,
      html,
      replyTo: replyTo || undefined,
    },
    timeoutMs,
  );
}

/** Startup diagnostics — does not block HTTP. */
export async function logMailProviderStatus() {
  const status = getMailConfigStatus();

  if (!status.configured) {
    // eslint-disable-next-line no-console
    console.warn('[mail] SMTP not configured. Set SMTP_USER and SMTP_PASS.');
    return;
  }

  const transport = getSmtpTransport();
  try {
    await transport.verify();
    // eslint-disable-next-line no-console
    console.info(
      `[mail] SMTP verified (${status.host}:${status.port}, from ${status.from})`,
    );
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error('[mail] SMTP verify failed', e?.message || e);
  }
}

export { escapeHtml };
