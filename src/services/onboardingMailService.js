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

function adminDashboardUrl(requestId) {
  const base = (process.env.APP_URL || process.env.FRONTEND_URL || '').replace(/\/$/, '');
  if (!base || !requestId) return '';
  return `${base}/dashboard/onboardings/view?id=${encodeURIComponent(requestId)}`;
}

async function sendMail({ to, subject, text, html }) {
  const from = process.env.SMTP_FROM?.trim() || process.env.SMTP_USER?.trim() || 'noreply@localhost';
  const transport = getTransport();
  if (!transport || !to) {
    console.info('[mail]', subject, text.replace(/\n/g, ' | '));
    return false;
  }
  try {
    await transport.sendMail({ from, to, subject, text, html });
    return true;
  } catch (e) {
    console.error('[mail] send failed', e);
    return false;
  }
}

export async function sendOnboardingAdminNewRequestEmail(payload) {
  const to =
    process.env.ADMIN_EMAIL?.trim()
    || process.env.SMTP_USER?.trim();
  if (!to) return false;

  const subject = 'New Location Onboarding Request';
  const owner = payload.ownerName;
  const location = payload.locationName;
  const reviewUrl = payload.reviewUrl || '';

  const text = [
    'New Location Onboarding Request',
    '',
    `${owner} has submitted a new onboarding request for ${location}.`,
    '',
    `Email: ${payload.email}`,
    `Phone: ${payload.phone}`,
    `Services: ${(payload.services || []).join(', ')}`,
    reviewUrl ? `\nReview in dashboard: ${reviewUrl}` : '',
  ].join('\n');

  const html = `<!DOCTYPE html><html><body style="font-family:system-ui,sans-serif;padding:24px;">
    <h2>New Location Onboarding Request</h2>
    <p><strong>${escapeHtml(owner)}</strong> has submitted a new onboarding request for <strong>${escapeHtml(location)}</strong>.</p>
    <p>Email: ${escapeHtml(payload.email)}<br>Phone: ${escapeHtml(payload.phone)}</p>
    <p>Services: ${escapeHtml((payload.services || []).join(', '))}</p>
    ${reviewUrl ? `<p><a href="${escapeHtml(reviewUrl)}">Review in admin dashboard</a></p>` : ''}
  </body></html>`;

  return sendMail({ to, subject, text, html });
}

export async function sendOnboardingApprovalEmail(payload) {
  const subject = `Your onboarding for ${payload.locationName} has been approved`;
  const text = [
    `Hello ${payload.ownerName},`,
    '',
    `Great news! Your onboarding request for ${payload.locationName} has been approved.`,
    '',
    `Tracking ID: ${payload.trackingId}`,
    '',
    'Track your onboarding progress here:',
    payload.trackingUrl,
    '',
    'On the tracking page you can see overall progress, completed tasks, pending tasks, admin comments, timeline, and current status.',
    '',
    'No login is required.',
    '',
    'Thank you.',
  ].join('\n');

  const html = `<!DOCTYPE html><html><body style="font-family:system-ui,sans-serif;padding:24px;max-width:560px;">
    <p>Hello <strong>${escapeHtml(payload.ownerName)}</strong>,</p>
    <p>Great news! Your onboarding request for <strong>${escapeHtml(payload.locationName)}</strong> has been approved.</p>
    <p><strong>Tracking ID:</strong><br>${escapeHtml(payload.trackingId)}</p>
    <p><a href="${escapeHtml(payload.trackingUrl)}" style="display:inline-block;padding:12px 24px;background:#2a2a2a;color:#fff;text-decoration:none;border-radius:6px;">Track onboarding progress</a></p>
    <p style="color:#555;font-size:14px;">No login required. We'll continue updating your progress as work is completed.</p>
    <p>Thank you.</p>
  </body></html>`;

  return sendMail({ to: payload.to, subject, text, html });
}

export async function sendOnboardingMilestoneEmail(payload) {
  const subject = `Onboarding update: ${payload.milestone}`;
  const text = [
    `Hello ${payload.ownerName},`,
    '',
    `A milestone was completed for ${payload.locationName}:`,
    payload.milestone,
    '',
    `View progress: ${payload.trackingUrl}`,
  ].join('\n');
  const html = `<!DOCTYPE html><html><body style="font-family:system-ui,sans-serif;padding:24px;">
    <p>Hello ${escapeHtml(payload.ownerName)},</p>
    <p>A milestone was completed for <strong>${escapeHtml(payload.locationName)}</strong>:</p>
    <p><strong>${escapeHtml(payload.milestone)}</strong></p>
    <p><a href="${escapeHtml(payload.trackingUrl)}">View progress</a></p>
  </body></html>`;
  return sendMail({ to: payload.to, subject, text, html });
}

export async function sendOnboardingPublicCommentEmail(payload) {
  const subject = `New comment on your onboarding: ${payload.taskTitle}`;
  const text = [
    `Hello ${payload.ownerName},`,
    '',
    `A new comment was added to "${payload.taskTitle}":`,
    payload.comment,
    '',
    `View: ${payload.trackingUrl}`,
  ].join('\n');
  const html = `<!DOCTYPE html><html><body style="font-family:system-ui,sans-serif;padding:24px;">
    <p>Hello ${escapeHtml(payload.ownerName)},</p>
    <p>New comment on <strong>${escapeHtml(payload.taskTitle)}</strong>:</p>
    <p style="border-left:3px solid #2a2a2a;padding-left:12px;">${escapeHtml(payload.comment)}</p>
    <p><a href="${escapeHtml(payload.trackingUrl)}">View tracking page</a></p>
  </body></html>`;
  return sendMail({ to: payload.to, subject, text, html });
}

export async function sendOnboardingCompletedEmail(payload) {
  const subject = `Onboarding completed for ${payload.locationName}`;
  const text = [
    `Hello ${payload.ownerName},`,
    '',
    `Your onboarding for ${payload.locationName} is now complete.`,
    `Tracking ID: ${payload.trackingId}`,
    payload.trackingUrl,
  ].join('\n');
  const html = `<!DOCTYPE html><html><body style="font-family:system-ui,sans-serif;padding:24px;">
    <p>Hello ${escapeHtml(payload.ownerName)},</p>
    <p>Your onboarding for <strong>${escapeHtml(payload.locationName)}</strong> is now <strong>complete</strong>.</p>
    <p>Tracking ID: ${escapeHtml(payload.trackingId)}</p>
    <p><a href="${escapeHtml(payload.trackingUrl)}">View final summary</a></p>
  </body></html>`;
  return sendMail({ to: payload.to, subject, text, html });
}

export { adminDashboardUrl };

export async function sendOnboardingChatNotificationEmail(payload) {
  if (payload.toAdmin) {
    const to =
      process.env.ADMIN_EMAIL?.trim()
      || process.env.SMTP_USER?.trim();
    if (!to) return false;

    const reviewUrl = adminDashboardUrl(payload.requestId);
    const subject = `Onboarding message from ${payload.ownerName}`;
    const text = [
      `${payload.ownerName} sent a message about ${payload.locationName}:`,
      '',
      payload.text,
      '',
      `Email: ${payload.email}`,
      payload.trackingId ? `Tracking ID: ${payload.trackingId}` : '',
      reviewUrl ? `\nReply in dashboard: ${reviewUrl}` : '',
    ].join('\n');

    const html = `<!DOCTYPE html><html><body style="font-family:system-ui,sans-serif;padding:24px;">
      <h2>New onboarding message</h2>
      <p><strong>${escapeHtml(payload.ownerName)}</strong> (${escapeHtml(payload.locationName)}) wrote:</p>
      <p style="border-left:3px solid #2a2a2a;padding-left:12px;">${escapeHtml(payload.text)}</p>
      ${reviewUrl ? `<p><a href="${escapeHtml(reviewUrl)}">Reply in admin dashboard</a></p>` : ''}
    </body></html>`;

    return sendMail({ to, subject, text, html });
  }

  if (!payload.to) return false;
  const subject = `Reply on your onboarding: ${payload.locationName}`;
  const text = [
    `Hello ${payload.ownerName},`,
    '',
    'Our team replied to your message:',
    payload.text,
    '',
    payload.trackingUrl ? `View and reply: ${payload.trackingUrl}` : '',
  ].join('\n');

  const html = `<!DOCTYPE html><html><body style="font-family:system-ui,sans-serif;padding:24px;">
    <p>Hello ${escapeHtml(payload.ownerName)},</p>
    <p>Our team replied about <strong>${escapeHtml(payload.locationName)}</strong>:</p>
    <p style="border-left:3px solid #2a2a2a;padding-left:12px;">${escapeHtml(payload.text)}</p>
    ${payload.trackingUrl ? `<p><a href="${escapeHtml(payload.trackingUrl)}">Open tracking page to reply</a></p>` : ''}
  </body></html>`;

  return sendMail({ to: payload.to, subject, text, html });
}
