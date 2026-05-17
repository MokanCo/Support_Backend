import nodemailer from 'nodemailer';

let smtpTransport;

const DEFAULT_TIMEOUT_MS = 20_000;

function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function getSmtpTransport() {
  if (smtpTransport !== undefined) return smtpTransport;
  const host = process.env.SMTP_HOST?.trim();
  const port = Number(process.env.SMTP_PORT || '587');
  const user = process.env.SMTP_USER?.trim();
  const pass = process.env.SMTP_PASS?.trim();
  if (!host || !user) {
    smtpTransport = null;
    return null;
  }
  const secure =
    process.env.SMTP_SECURE === 'true' || process.env.SMTP_SECURE === '1' || port === 465;
  smtpTransport = nodemailer.createTransport({
    host,
    port,
    secure,
    auth: { user, pass: pass || '' },
    requireTLS: !secure && port === 587,
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 15_000,
  });
  return smtpTransport;
}

export function getDefaultFrom() {
  return (
    process.env.RESEND_FROM?.trim()
    || process.env.SMTP_FROM?.trim()
    || process.env.SMTP_USER?.trim()
    || 'noreply@localhost'
  );
}

export function getResendApiKey() {
  return process.env.RESEND_API_KEY?.trim() || '';
}

function normalizeRecipients(to) {
  if (!to) return [];
  const list = Array.isArray(to) ? to : [to];
  return [...new Set(list.map((e) => String(e).trim()).filter(Boolean))];
}

async function sendViaResend({ from, to, subject, text, html, replyTo }, timeoutMs) {
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

/**
 * Send email via HTTPS (Resend) when configured, else SMTP.
 * Resend works on Render free tier; SMTP ports 587/465 are blocked there.
 */
export async function dispatchEmail(
  { from, to, subject, text, html, replyTo },
  timeoutMs = DEFAULT_TIMEOUT_MS,
) {
  const mailFrom = from || getDefaultFrom();
  const recipients = normalizeRecipients(to);
  if (recipients.length === 0) {
    throw new Error('No recipients');
  }

  if (getResendApiKey()) {
    return sendViaResend(
      { from: mailFrom, to: recipients, subject, text, html, replyTo },
      timeoutMs,
    );
  }

  const transport = getSmtpTransport();
  if (!transport) {
    throw new Error('Mail not configured (set RESEND_API_KEY or SMTP_HOST + SMTP_USER)');
  }

  return sendViaSmtp(
    transport,
    {
      from: mailFrom,
      to: recipients.length === 1 ? recipients[0] : recipients.join(', '),
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
  const resend = Boolean(getResendApiKey());
  const smtp = getSmtpTransport();

  if (resend) {
    // eslint-disable-next-line no-console
    console.info('[mail] Resend API configured (HTTPS — works on Render free tier)');
    return;
  }

  if (!smtp) {
    // eslint-disable-next-line no-console
    console.warn(
      '[mail] No mail provider configured. Set RESEND_API_KEY (recommended on Render) or SMTP_HOST + SMTP_USER.',
    );
    return;
  }

  if (process.env.RENDER) {
    // eslint-disable-next-line no-console
    console.warn(
      '[mail] Running on Render without RESEND_API_KEY. Free-tier instances block SMTP ports 587/465 — invites may fail. Add RESEND_API_KEY or upgrade to a paid instance.',
    );
  }

  try {
    await smtp.verify();
    // eslint-disable-next-line no-console
    console.info('[mail] SMTP connection verified');
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error('[mail] SMTP verify failed', e?.message || e);
  }
}

export { escapeHtml };
