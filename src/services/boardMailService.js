import nodemailer from 'nodemailer';

let cached;

function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function getTransport() {
  if (cached !== undefined) return cached;
  const host = process.env.SMTP_HOST?.trim();
  const port = Number(process.env.SMTP_PORT || '587');
  const user = process.env.SMTP_USER?.trim();
  const pass = process.env.SMTP_PASS?.trim();
  if (!host || !user) {
    cached = null;
    return null;
  }
  cached = nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
    auth: { user, pass: pass || '' },
  });
  return cached;
}

/**
 * Board task completion email. `assigneeName` should be the assignee’s display name (`BoardTask.assignedTo` → User.name).
 * @param {{
 *   to: string[];
 *   taskTitle: string;
 *   ticketCode?: string | null;
 *   boardName: string;
 *   boardId?: string;
 *   taskId?: string;
 *   assigneeName?: string | null;
 * }} payload
 */
export async function sendTaskCompleteEmails(payload) {
  const from = process.env.SMTP_FROM?.trim() || process.env.SMTP_USER?.trim() || 'noreply@localhost';
  const transport = getTransport();
  const subject = `Completed: ${payload.taskTitle}`;
  const assigneeLabel = payload.assigneeName?.trim() || 'Unassigned';
  const base = (process.env.APP_URL || process.env.FRONTEND_URL || '').replace(/\/$/, '');
  const taskUrl =
    base && payload.boardId && payload.taskId
      ? `${base}/board/${payload.boardId}/task/${payload.taskId}`
      : '';
  const lines = [
    `The task "${payload.taskTitle}" assigned to ${assigneeLabel} has been completed.`,
    '',
    'Task details:',
    `Board: ${payload.boardName}`,
    `Task: ${payload.taskTitle}`,
    `Assignee: ${assigneeLabel}`,
  ];
  if (taskUrl) lines.push('', `View in app: ${taskUrl}`);
  if (payload.ticketCode) lines.push(`Ticket: ${payload.ticketCode}`);
  const text = lines.join('\n');

  const safeAssignee = escapeHtml(assigneeLabel);
  const safeTitle = escapeHtml(payload.taskTitle);
  const safeBoard = escapeHtml(payload.boardName);
  const safeTicket = payload.ticketCode ? escapeHtml(payload.ticketCode) : '';
  const href = taskUrl ? escapeHtml(taskUrl) : '';
  const buttonBlock = taskUrl
    ? `<table role="presentation" cellspacing="0" cellpadding="0" border="0" style="margin:24px 0;">
  <tr>
    <td align="left">
      <a href="${href}" target="_blank" rel="noopener noreferrer"
        style="display:inline-block;padding:12px 28px;background:#0d6efd;color:#ffffff !important;text-decoration:none;border-radius:6px;font-weight:600;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;font-size:15px;line-height:1.2;">
        View task
      </a>
    </td>
  </tr>
</table>
<p style="margin:0 0 16px;font-size:13px;color:#666;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;">
  Or open this link: <a href="${href}" style="color:#0d6efd;">${href}</a>
</p>`
    : `<p style="margin:16px 0 0;font-size:14px;color:#666;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;">No app link configured (set APP_URL or FRONTEND_URL).</p>`;

  const html = `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width"></head>
<body style="margin:0;padding:24px;background:#f4f4f5;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:#1a1a1a;">
  <div style="max-width:560px;margin:0 auto;background:#ffffff;padding:28px 32px;border-radius:8px;border:1px solid #e5e5e5;">
    <p style="margin:0 0 16px;font-size:16px;line-height:1.5;">The task <strong>${safeTitle}</strong> assigned to <strong>${safeAssignee}</strong> has been completed.</p>
    <p style="margin:0 0 8px;font-size:14px;color:#555;"><strong>Board</strong><br>${safeBoard}</p>
    <p style="margin:0 0 8px;font-size:14px;color:#555;"><strong>Task</strong><br>${safeTitle}</p>
    <p style="margin:0 0 8px;font-size:14px;color:#555;"><strong>Assignee</strong><br>${safeAssignee}</p>
    ${safeTicket ? `<p style="margin:0 0 8px;font-size:14px;color:#555;"><strong>Ticket</strong><br>${safeTicket}</p>` : ''}
    ${buttonBlock}
  </div>
</body>
</html>`;

  if (!transport || !payload.to?.length) {
    console.info('[boards] Task complete (no SMTP or recipients):', text.replace(/\n/g, ' | '));
    return false;
  }
  try {
    await transport.sendMail({
      from,
      to: payload.to.join(', '),
      subject,
      text,
      html,
    });
    return true;
  } catch (e) {
    console.error('[boards] send mail failed', e);
    return false;
  }
}

/**
 * @param {{ to: string[]; ticketRef: string; title: string; locationName?: string | null }} payload
 */
export async function sendTicketCompletedEmails(payload) {
  const from = process.env.SMTP_FROM?.trim() || process.env.SMTP_USER?.trim() || 'noreply@localhost';
  const transport = getTransport();
  const ref = payload.ticketRef || '—';
  const subject = `Ticket ${ref} completed`;
  const lines = [
    'This support ticket has been marked completed.',
    '',
    `Reference: ${ref}`,
    `Title: ${payload.title || '—'}`,
  ];
  if (payload.locationName) lines.push(`Location: ${payload.locationName}`);
  const text = lines.join('\n');

  if (!transport || !payload.to?.length) {
    // eslint-disable-next-line no-console
    console.info('[mail] Ticket complete (no SMTP or recipients):', text.replace(/\n/g, ' | '));
    return false;
  }
  try {
    await transport.sendMail({
      from,
      to: payload.to.join(', '),
      subject,
      text,
    });
    return true;
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error('[mail] ticket completion send failed', e);
    return false;
  }
}

/**
 * @param {{
 *   to: string;
 *   assigneeName: string;
 *   ticketRef: string;
 *   title: string;
 *   locationName?: string | null;
 *   ticketId?: string;
 * }} payload
 */
export async function sendTicketAssignedEmail(payload) {
  const from = process.env.SMTP_FROM?.trim() || process.env.SMTP_USER?.trim() || 'noreply@localhost';
  const transport = getTransport();
  const ref = payload.ticketRef || '—';
  const subject = `Ticket ${ref} assigned to you`;
  const base = (process.env.APP_URL || process.env.FRONTEND_URL || '').replace(/\/$/, '');
  const ticketUrl = base && payload.ticketId ? `${base}/dashboard/tickets/${payload.ticketId}` : '';

  const lines = [
    `Hi ${payload.assigneeName},`,
    '',
    `A support ticket has been assigned to you.`,
    '',
    `Reference: ${ref}`,
    `Title: ${payload.title || '—'}`,
  ];
  if (payload.locationName) lines.push(`Location: ${payload.locationName}`);
  if (ticketUrl) lines.push('', `View ticket: ${ticketUrl}`);
  const text = lines.join('\n');

  const safeName = escapeHtml(payload.assigneeName);
  const safeRef = escapeHtml(ref);
  const safeTitle = escapeHtml(payload.title || '—');
  const safeLoc = payload.locationName ? escapeHtml(payload.locationName) : '';
  const href = ticketUrl ? escapeHtml(ticketUrl) : '';
  const buttonBlock = href
    ? `<table role="presentation" cellspacing="0" cellpadding="0" border="0" style="margin:24px 0;">
  <tr>
    <td align="left">
      <a href="${href}" target="_blank" rel="noopener noreferrer"
        style="display:inline-block;padding:12px 28px;background:#0d6efd;color:#ffffff !important;text-decoration:none;border-radius:6px;font-weight:600;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;font-size:15px;line-height:1.2;">
        View ticket
      </a>
    </td>
  </tr>
</table>
<p style="margin:0 0 16px;font-size:13px;color:#666;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;">
  Or open this link: <a href="${href}" style="color:#0d6efd;">${href}</a>
</p>`
    : '';

  const html = `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width"></head>
<body style="margin:0;padding:24px;background:#f4f4f5;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:#1a1a1a;">
  <div style="max-width:560px;margin:0 auto;background:#ffffff;padding:28px 32px;border-radius:8px;border:1px solid #e5e5e5;">
    <p style="margin:0 0 16px;font-size:16px;line-height:1.5;">Hi <strong>${safeName}</strong>, a support ticket has been assigned to you.</p>
    <p style="margin:0 0 8px;font-size:14px;color:#555;"><strong>Reference</strong><br>${safeRef}</p>
    <p style="margin:0 0 8px;font-size:14px;color:#555;"><strong>Title</strong><br>${safeTitle}</p>
    ${safeLoc ? `<p style="margin:0 0 8px;font-size:14px;color:#555;"><strong>Location</strong><br>${safeLoc}</p>` : ''}
    ${buttonBlock}
  </div>
</body>
</html>`;

  if (!transport || !payload.to) {
    // eslint-disable-next-line no-console
    console.info('[mail] Ticket assigned (no SMTP or recipient):', text.replace(/\n/g, ' | '));
    return false;
  }
  try {
    await transport.sendMail({ from, to: payload.to, subject, text, html });
    return true;
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error('[mail] ticket assignment send failed', e);
    return false;
  }
}

/**
 * Public contact form email.
 * @param {{
 *   name: string;
 *   email: string;
 *   message: string;
 *   subject?: string;
 *   adminEmail?: string;
 * }} payload
 */
export async function sendContactFormEmail(payload) {
  const from = process.env.SMTP_FROM?.trim() || process.env.SMTP_USER?.trim() || 'noreply@localhost';
  const transport = getTransport();
  const to =
    payload.adminEmail?.trim()
    || process.env.ADMIN_EMAIL?.trim()
    || process.env.SMTP_USER?.trim();
  const subject = payload.subject?.trim() || 'New Support contact form submission';

  if (!to) return false;

  const safeName = escapeHtml(payload.name);
  const safeEmail = escapeHtml(payload.email);
  const safeMessage = escapeHtml(payload.message);
  const safeSubject = escapeHtml(subject);

  const text = [
    'New contact form submission',
    '',
    `Name: ${payload.name}`,
    `Email: ${payload.email}`,
    `Subject: ${subject}`,
    '',
    'Message:',
    payload.message,
  ].join('\n');

  const html = `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width"></head>
<body style="margin:0;padding:16px;background:#f4f4f5;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:#1a1a1a;">
  <div style="max-width:560px;margin:0 auto;background:#ffffff;padding:20px 24px;border-radius:8px;border:1px solid #e5e5e5;">
    <p style="margin:0 0 12px;font-size:18px;font-weight:600;">New contact form submission</p>
    <p style="margin:0 0 8px;font-size:14px;color:#555;"><strong>Name</strong><br>${safeName}</p>
    <p style="margin:0 0 8px;font-size:14px;color:#555;"><strong>Email</strong><br>${safeEmail}</p>
    <p style="margin:0 0 8px;font-size:14px;color:#555;"><strong>Subject</strong><br>${safeSubject}</p>
    <p style="margin:0;font-size:14px;color:#555;white-space:pre-wrap;"><strong>Message</strong><br>${safeMessage}</p>
  </div>
</body>
</html>`;

  if (!transport) {
    console.info('[mail] Contact form (no SMTP):', text.replace(/\n/g, ' | '));
    return false;
  }

  try {
    await transport.sendMail({
      from,
      to,
      subject: `[Contact] ${subject}`,
      text,
      html,
      replyTo: payload.email,
    });
    return true;
  } catch (e) {
    console.error('[mail] contact form send failed', e);
    return false;
  }
}
