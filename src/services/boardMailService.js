import {
  dispatchEmail,
  escapeHtml,
  getDefaultFrom,
  getSmtpTransport,
  isMailConfigured,
} from './mailSender.js';
import {
  renderBodyParagraph,
  renderBrandedEmail,
  renderCommentQuote,
  renderDetailRow,
  renderFooterNote,
  renderGradientButton,
  renderInlineCode,
  renderLinkFallback,
} from './emailTemplate.js';

const MAIL_SEND_TIMEOUT_MS = 60_000;
const INVITE_MAIL_TIMEOUT_MS = 60_000;

/** @deprecated use getSmtpTransport from mailSender */
export function getTransport() {
  return getSmtpTransport();
}

function mailConfigured() {
  return isMailConfigured();
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
  const from = getDefaultFrom();
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
  const bodyHtml = [
    renderBodyParagraph(
      `The task <strong>${safeTitle}</strong> assigned to <strong>${safeAssignee}</strong> has been completed.`,
      { large: true },
    ),
    renderDetailRow('Board', safeBoard),
    renderDetailRow('Task', safeTitle),
    renderDetailRow('Assignee', safeAssignee),
    safeTicket ? renderDetailRow('Ticket', safeTicket) : '',
    href
      ? renderGradientButton({ label: 'View task', href })
        + renderLinkFallback(href)
      : renderFooterNote('No app link configured (set APP_URL or FRONTEND_URL).'),
  ].join('');

  const html = renderBrandedEmail({
    preheader: `Task completed: ${payload.taskTitle}`,
    bodyHtml,
  });

  if (!mailConfigured() || !payload.to?.length) {
    console.info('[boards] Task complete (no mail provider or recipients):', text.replace(/\n/g, ' | '));
    return false;
  }
  try {
    await dispatchEmail(
      { from, to: payload.to, subject, text, html },
      MAIL_SEND_TIMEOUT_MS,
    );
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
  const from = getDefaultFrom();
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

  const safeRef = escapeHtml(ref);
  const safeTitle = escapeHtml(payload.title || '—');
  const safeLoc = payload.locationName ? escapeHtml(payload.locationName) : '';
  const bodyHtml = [
    renderBodyParagraph('This support ticket has been marked completed.', { large: true }),
    renderDetailRow('Reference', safeRef),
    renderDetailRow('Title', safeTitle),
    safeLoc ? renderDetailRow('Location', safeLoc) : '',
  ].join('');
  const html = renderBrandedEmail({
    preheader: `Ticket ${ref} completed`,
    bodyHtml,
  });

  if (!mailConfigured() || !payload.to?.length) {
    // eslint-disable-next-line no-console
    console.info('[mail] Ticket complete (no mail provider or recipients):', text.replace(/\n/g, ' | '));
    return false;
  }
  try {
    await dispatchEmail(
      { from, to: payload.to, subject, text, html },
      MAIL_SEND_TIMEOUT_MS,
    );
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
function ticketViewUrl(ticketObjectId) {
  const base = (process.env.APP_URL || process.env.FRONTEND_URL || '').replace(/\/$/, '');
  if (!base || !ticketObjectId) return '';
  return `${base}/dashboard/tickets/view?id=${encodeURIComponent(String(ticketObjectId))}`;
}

/**
 * Email admins when a partner submits a new ticket.
 * @param {{
 *   to: string[];
 *   ticketRef: string;
 *   title: string;
 *   locationName?: string | null;
 *   partnerName?: string | null;
 *   ticketId?: string;
 * }} payload
 */
export async function sendNewPartnerTicketAdminEmail(payload) {
  const from = getDefaultFrom();
  const ref = payload.ticketRef || '—';
  const subject = `New ticket ${ref} from partner`;
  const ticketUrl = ticketViewUrl(payload.ticketId);
  const partnerLabel = payload.partnerName?.trim() || 'A partner';

  const lines = [
    'A new support ticket was opened by a partner.',
    '',
    `Reference: ${ref}`,
    `Title: ${payload.title || '—'}`,
    `Submitted by: ${partnerLabel}`,
  ];
  if (payload.locationName) lines.push(`Location: ${payload.locationName}`);
  if (ticketUrl) lines.push('', `View ticket: ${ticketUrl}`);
  const text = lines.join('\n');

  const safeRef = escapeHtml(ref);
  const safeTitle = escapeHtml(payload.title || '—');
  const safePartner = escapeHtml(partnerLabel);
  const safeLoc = payload.locationName ? escapeHtml(payload.locationName) : '';
  const href = ticketUrl ? escapeHtml(ticketUrl) : '';
  const bodyHtml = [
    renderBodyParagraph(`<strong>${safePartner}</strong> opened a new support ticket.`, {
      large: true,
    }),
    renderDetailRow('Reference', safeRef),
    renderDetailRow('Title', safeTitle),
    safeLoc ? renderDetailRow('Location', safeLoc) : '',
    href ? renderGradientButton({ label: 'View ticket', href }) + renderLinkFallback(href) : '',
  ].join('');

  const html = renderBrandedEmail({
    preheader: `New ticket ${ref} from partner`,
    bodyHtml,
  });

  const recipients = [...new Set((payload.to ?? []).map((e) => String(e).trim()).filter(Boolean))];
  if (!mailConfigured() || recipients.length === 0) {
    // eslint-disable-next-line no-console
    console.info('[mail] New partner ticket (no mail provider or recipients):', text.replace(/\n/g, ' | '));
    return false;
  }
  try {
    await dispatchEmail({ from, to: recipients, subject, text, html }, MAIL_SEND_TIMEOUT_MS);
    return true;
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error('[mail] new partner ticket admin email failed', e);
    return false;
  }
}

export async function sendTicketAssignedEmail(payload) {
  const from = getDefaultFrom();
  const ref = payload.ticketRef || '—';
  const subject = `Ticket ${ref} assigned to you`;
  const ticketUrl = ticketViewUrl(payload.ticketId);

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
  const bodyHtml = [
    renderBodyParagraph(
      `Hi <strong>${safeName}</strong>, a support ticket has been assigned to you.`,
      { large: true },
    ),
    renderDetailRow('Reference', safeRef),
    renderDetailRow('Title', safeTitle),
    safeLoc ? renderDetailRow('Location', safeLoc) : '',
    href
      ? renderGradientButton({ label: 'View ticket', href }) + renderLinkFallback(href)
      : '',
  ].join('');

  const html = renderBrandedEmail({
    preheader: `Ticket ${ref} assigned to you`,
    bodyHtml,
  });

  if (!mailConfigured() || !payload.to) {
    // eslint-disable-next-line no-console
    console.info('[mail] Ticket assigned (no mail provider or recipient):', text.replace(/\n/g, ' | '));
    return false;
  }
  try {
    await dispatchEmail({ from, to: payload.to, subject, text, html }, MAIL_SEND_TIMEOUT_MS);
    return true;
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error('[mail] ticket assignment send failed', e);
    return false;
  }
}

/**
 * Portal invite for a new location user (temporary password).
 * @param {{
 *   to: string;
 *   name: string;
 *   email: string;
 *   temporaryPassword: string;
 * }} payload
 */
export async function sendPortalInviteEmail(payload) {
  const from = getDefaultFrom();
  const base = (process.env.APP_URL || process.env.FRONTEND_URL || '').replace(/\/$/, '');
  const loginUrl = base ? `${base}/login` : '/login';
  const subject = 'You have been invited to the Moka&Co portal';

  const safeName = escapeHtml(payload.name);
  const safeEmail = escapeHtml(payload.email);
  const safePassword = escapeHtml(payload.temporaryPassword);
  const href = escapeHtml(loginUrl);

  const text = [
    `Hi ${payload.name},`,
    '',
    'You have been invited to use the Moka&Co portal.',
    '',
    'Your sign-in credentials:',
    `Email: ${payload.email}`,
    `Temporary password: ${payload.temporaryPassword}`,
    '',
    `Sign in: ${loginUrl}`,
    '',
    'You will be asked to choose a new password on first login.',
    'If you have any trouble signing in, please contact your administrator.',
  ].join('\n');

  const bodyHtml = [
    renderBodyParagraph(`Hi <strong>${safeName}</strong>,`, { large: true }),
    renderBodyParagraph(
      'You have been invited to use the <strong>Moka&amp;Co</strong> portal. Below are your credentials. Please sign in and choose a new password when prompted.',
    ),
    renderDetailRow('Email', safeEmail),
    renderDetailRow('Temporary password', renderInlineCode(safePassword)),
    renderGradientButton({ label: 'Sign in to portal', href }),
    renderLinkFallback(href),
    renderFooterNote('If you have any trouble signing in, please contact your administrator.'),
  ].join('');

  const html = renderBrandedEmail({
    preheader: 'Your Moka&Co portal invite',
    bodyHtml,
  });

  if (!mailConfigured() || !payload.to) {
    // eslint-disable-next-line no-console
    console.info('[mail] Portal invite (no mail provider or recipient):', text.replace(/\n/g, ' | '));
    return false;
  }
  try {
    await dispatchEmail(
      { from, to: payload.to, subject, text, html },
      INVITE_MAIL_TIMEOUT_MS,
    );
    // eslint-disable-next-line no-console
    console.info('[mail] Portal invite sent to', payload.to);
    return true;
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error('[mail] portal invite send failed', e?.message || e);
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
  const from = getDefaultFrom();
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

  const bodyHtml = [
    renderBodyParagraph('<strong>New contact form submission</strong>', { large: true }),
    renderDetailRow('Name', safeName),
    renderDetailRow('Email', safeEmail),
    renderDetailRow('Subject', safeSubject),
    `<p style="margin:0;font-size:14px;line-height:1.55;color:#1a1a1a;font-family:system-ui,-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;white-space:pre-wrap;"><strong style="color:#1a1a1a;">Message</strong><br>${safeMessage}</p>`,
  ].join('');

  const html = renderBrandedEmail({
    preheader: subject,
    bodyHtml,
  });

  if (!mailConfigured()) {
    console.info('[mail] Contact form (no mail provider):', text.replace(/\n/g, ' | '));
    return false;
  }

  try {
    await dispatchEmail(
      {
        from,
        to,
        subject: `[Contact] ${subject}`,
        text,
        html,
        replyTo: payload.email,
      },
      MAIL_SEND_TIMEOUT_MS,
    );
    return true;
  } catch (e) {
    console.error('[mail] contact form send failed', e);
    return false;
  }
}

/**
 * Tracking link email after onboarding request submission.
 * @param {{
 *   to: string;
 *   name: string;
 *   trackingUrl: string;
 *   trackingToken: string;
 * }} payload
 */
export async function sendOnboardingTrackingEmail(payload) {
  const from = process.env.SMTP_FROM?.trim() || process.env.SMTP_USER?.trim() || 'noreply@localhost';
  const transport = getTransport();
  const subject = 'Your Moka&Co location onboarding request';
  const safeName = escapeHtml(payload.name);
  const href = escapeHtml(payload.trackingUrl);

  const text = [
    `Hi ${payload.name},`,
    '',
    'Thank you for submitting your new location onboarding request.',
    'Your request is under review by our team.',
    '',
    `Track your request: ${payload.trackingUrl}`,
    '',
    `Reference: ${payload.trackingToken}`,
  ].join('\n');

  const html = `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width"></head>
<body style="margin:0;padding:24px;background:#f4f4f5;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:#1a1a1a;">
  <div style="max-width:560px;margin:0 auto;background:#ffffff;padding:28px 32px;border-radius:8px;border:1px solid #e5e5e5;">
    <p style="margin:0 0 16px;font-size:16px;line-height:1.5;">Hi <strong>${safeName}</strong>,</p>
    <p style="margin:0 0 16px;font-size:15px;line-height:1.55;">Thank you for submitting your new location onboarding request. Your request is under review by our team.</p>
    <p style="margin:0 0 16px;font-size:14px;color:#555;">Use the link below to track progress:</p>
    <a href="${href}" style="display:inline-block;padding:12px 28px;background:#2a2a2a;color:#fff;text-decoration:none;border-radius:6px;font-weight:600;">Track request</a>
    <p style="margin:16px 0 0;font-size:13px;color:#666;">Reference: ${escapeHtml(payload.trackingToken)}</p>
  </div>
</body>
</html>`;

  if (!transport || !payload.to) {
    console.info('[mail] Onboarding tracking (no SMTP or recipient):', text.replace(/\n/g, ' | '));
    return false;
  }
  try {
    await transport.sendMail({ from, to: payload.to, subject, text, html });
    return true;
  } catch (e) {
    console.error('[mail] onboarding tracking send failed', e);
    return false;
  }
}

/**
 * Notify admin of a new onboarding request.
 * @param {{ request: Record<string, unknown>; trackingUrl: string }} payload
 */
export async function sendOnboardingAdminNotificationEmail(payload) {
  const from = process.env.SMTP_FROM?.trim() || process.env.SMTP_USER?.trim() || 'noreply@localhost';
  const transport = getTransport();
  const to =
    process.env.ADMIN_EMAIL?.trim()
    || process.env.SMTP_USER?.trim();
  if (!to) return false;

  const { request } = payload;
  const personal = request.personal || {};
  const location = request.location || {};
  const subject = `New location onboarding: ${location.locationName || 'New request'}`;

  const text = [
    'New location onboarding request',
    '',
    `Applicant: ${personal.firstName} ${personal.lastName}`,
    `Email: ${personal.email}`,
    `Location: ${location.locationName}`,
    `Location email: ${location.locationEmail}`,
    `Opening date: ${location.openingDate}`,
    `Services: ${(request.selectedServices || []).join(', ')}`,
    '',
    `Track: ${payload.trackingUrl}`,
  ].join('\n');

  const html = `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="margin:0;padding:16px;background:#f4f4f5;font-family:system-ui,sans-serif;">
  <div style="max-width:560px;margin:0 auto;background:#fff;padding:20px 24px;border-radius:8px;border:1px solid #e5e5e5;">
    <p style="margin:0 0 12px;font-size:18px;font-weight:600;">New location onboarding request</p>
    <p style="margin:0 0 8px;font-size:14px;color:#555;"><strong>Applicant</strong><br>${escapeHtml(`${personal.firstName} ${personal.lastName}`)}</p>
    <p style="margin:0 0 8px;font-size:14px;color:#555;"><strong>Email</strong><br>${escapeHtml(personal.email)}</p>
    <p style="margin:0 0 8px;font-size:14px;color:#555;"><strong>Location</strong><br>${escapeHtml(location.locationName)}</p>
    <p style="margin:0 0 8px;font-size:14px;color:#555;"><strong>Opening date</strong><br>${escapeHtml(location.openingDate)}</p>
    <p style="margin:0 0 8px;font-size:14px;color:#555;"><strong>Services</strong><br>${escapeHtml((request.selectedServices || []).join(', '))}</p>
    <a href="${escapeHtml(payload.trackingUrl)}" style="display:inline-block;margin-top:12px;padding:10px 20px;background:#2a2a2a;color:#fff;text-decoration:none;border-radius:6px;font-weight:600;">View tracking</a>
  </div>
</body>
</html>`;

  if (!transport) {
    console.info('[mail] Onboarding admin notify (no SMTP):', text.replace(/\n/g, ' | '));
    return false;
  }
  try {
    await transport.sendMail({ from, to, subject, text, html });
    return true;
  } catch (e) {
    console.error('[mail] onboarding admin notify failed', e);
    return false;
  }
}

/**
 * Email when a user is @mentioned in a board task comment.
 * @param {{
 *   to: string;
 *   mentionedName: string;
 *   authorName: string;
 *   taskTitle: string;
 *   commentText: string;
 *   taskUrl: string;
 * }} payload
 */
export async function sendBoardMentionEmail(payload) {
  const from = getDefaultFrom();
  const subject = `${payload.authorName} mentioned you on: ${payload.taskTitle || 'Board task'}`;
  const text = [
    `Hi ${payload.mentionedName},`,
    '',
    `${payload.authorName} mentioned you in a comment on the board task "${payload.taskTitle || 'Untitled'}".`,
    '',
    'Comment:',
    payload.commentText,
    '',
    'Open the task:',
    payload.taskUrl,
  ].join('\n');

  const safeAuthor = escapeHtml(payload.authorName);
  const safeTask = escapeHtml(payload.taskTitle || 'Board task');
  const safeComment = escapeHtml(payload.commentText);
  const safeUrl = escapeHtml(payload.taskUrl);
  const bodyHtml = [
    renderBodyParagraph(
      `<strong>${safeAuthor}</strong> mentioned you on <strong>${safeTask}</strong>.`,
      { large: true },
    ),
    renderCommentQuote(safeComment),
    renderGradientButton({ label: 'View task', href: safeUrl }),
    renderLinkFallback(safeUrl),
  ].join('');

  const html = renderBrandedEmail({
    preheader: `${payload.authorName} mentioned you`,
    bodyHtml,
  });

  if (!mailConfigured() || !payload.to?.trim()) {
    // eslint-disable-next-line no-console
    console.info('[mail] Mention (no mail provider or to):', text.replace(/\n/g, ' | '));
    return false;
  }
  try {
    await dispatchEmail(
      { from, to: payload.to.trim(), subject, text, html },
      MAIL_SEND_TIMEOUT_MS,
    );
    return true;
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error('[mail] mention send failed', e);
    return false;
  }
}
