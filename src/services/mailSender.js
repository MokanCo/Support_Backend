import nodemailer from 'nodemailer';

let emailTransport;

const DEFAULT_TIMEOUT_MS = 20_000;

function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Render web services block outbound SMTP (587/465). Use Resend (HTTPS) there. */
export function isRenderDeployment() {
  return Boolean(
    process.env.RENDER
    || process.env.RENDER_SERVICE_ID
    || process.env.RENDER_SERVICE_NAME,
  );
}

export function getResendApiKey() {
  return process.env.RESEND_API_KEY?.trim() || '';
}

export function getDefaultFrom() {
  return process.env.RESEND_FROM?.trim() || process.env.SMTP_USER?.trim() || 'noreply@localhost';
}

function normalizeRecipients(to) {
  if (!to) return [];
  const list = Array.isArray(to) ? to : [to];
  return [...new Set(list.map((e) => String(e).trim()).filter(Boolean))];
}

function addressToString(addr) {
  if (!addr) return '';
  if (typeof addr === 'string') return addr.trim();
  if (Array.isArray(addr)) {
    return addr.map(addressToString).filter(Boolean).join(', ');
  }
  if (typeof addr === 'object' && addr.address) {
    const name = addr.name ? String(addr.name).trim() : '';
    return name ? `${name} <${addr.address}>` : addr.address;
  }
  return String(addr).trim();
}

function recipientsFromMailData(data) {
  const raw = data.to ?? data.cc ?? data.bcc;
  if (!raw) return [];
  const list = Array.isArray(raw) ? raw : [raw];
  return normalizeRecipients(
    list.map((entry) => {
      if (typeof entry === 'object' && entry?.address) return entry.address;
      return addressToString(entry);
    }),
  );
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
    return { messageId: body?.id || `resend-${Date.now()}`, accepted: recipients };
  } finally {
    clearTimeout(timer);
  }
}

/** Nodemailer transport that sends via Resend HTTPS API (works on Render). */
function createResendTransport() {
  return {
    name: 'resend-http',
    version: '1.0.0',
    send(mail, callback) {
      const data = mail.data;
      const from = addressToString(data.from) || getDefaultFrom();
      const to = recipientsFromMailData(data);
      const replyTo = addressToString(data.replyTo) || undefined;

      sendViaResend(
        {
          from,
          to,
          subject: data.subject || '(no subject)',
          text: data.text,
          html: data.html,
          replyTo,
        },
        DEFAULT_TIMEOUT_MS,
      )
        .then((info) => callback(null, info))
        .catch((err) => callback(err));
    },
  };
}

function createGmailTransport() {
  const user = process.env.SMTP_USER?.trim();
  const pass = process.env.SMTP_PASS?.trim();
  if (!user || !pass) return null;
  return nodemailer.createTransport({
    service: 'gmail',
    auth: { user, pass },
  });
}

/**
 * Single nodemailer transport: Resend (HTTPS) when RESEND_API_KEY is set,
 * else Gmail locally. Gmail SMTP is disabled on Render (ports blocked).
 */
export function getSmtpTransport() {
  if (emailTransport !== undefined) return emailTransport;

  if (getResendApiKey()) {
    emailTransport = nodemailer.createTransport(createResendTransport());
    return emailTransport;
  }

  if (isRenderDeployment()) {
    emailTransport = null;
    return null;
  }

  emailTransport = createGmailTransport();
  return emailTransport;
}

export function isMailConfigured() {
  if (getResendApiKey()) return true;
  if (isRenderDeployment()) return false;
  return Boolean(process.env.SMTP_USER?.trim() && process.env.SMTP_PASS?.trim());
}

async function sendViaTransport(transport, mailOptions, timeoutMs) {
  let timer;
  try {
    await Promise.race([
      transport.sendMail(mailOptions),
      new Promise((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`Email send timed out after ${timeoutMs}ms`)),
          timeoutMs,
        );
      }),
    ]);
    return true;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function mailNotConfiguredError() {
  if (isRenderDeployment()) {
    return new Error(
      'Email on Render requires RESEND_API_KEY (and RESEND_FROM with a verified domain). '
      + 'Gmail/nodemailer SMTP cannot run on Render — outbound ports 587/465 are blocked. '
      + 'Sign up at https://resend.com, verify your domain, and add env vars in the Render dashboard.',
    );
  }
  return new Error('Mail not configured (set RESEND_API_KEY or SMTP_USER + SMTP_PASS for local Gmail)');
}

/**
 * Send email via nodemailer (Resend HTTPS transport on Render, Gmail locally).
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

  const transport = getSmtpTransport();
  if (!transport) {
    throw mailNotConfiguredError();
  }

  return sendViaTransport(
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
  if (getResendApiKey()) {
    // eslint-disable-next-line no-console
    console.info('[mail] Resend API via nodemailer (HTTPS — works on Render)');
    return;
  }

  if (isRenderDeployment()) {
    // eslint-disable-next-line no-console
    console.error(
      '[mail] Render deployment detected but RESEND_API_KEY is missing. '
      + 'Gmail SMTP will not work (ports 587/465 blocked). Add RESEND_API_KEY and RESEND_FROM in Render env.',
    );
    return;
  }

  const gmail = createGmailTransport();
  if (!gmail) {
    // eslint-disable-next-line no-console
    console.warn(
      '[mail] No mail provider configured. Set RESEND_API_KEY (production/Render) or SMTP_USER + SMTP_PASS (local Gmail).',
    );
    return;
  }

  try {
    await gmail.verify();
    // eslint-disable-next-line no-console
    console.info('[mail] Gmail (nodemailer) connection verified — local/dev only');
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error('[mail] Gmail verify failed', e?.message || e);
  }
}

export { escapeHtml };
