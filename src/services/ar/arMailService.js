import { dispatchEmail } from '../mailSender.js';
import { getOrCreateSettings } from './arSettingsService.js';
import { publicInvoicePayUrl } from './arPublicInvoiceService.js';

function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function shouldShowPayNow(kind) {
  return ['sent', 'reminder', 'overdue', 'late_fee'].includes(kind);
}

async function recipientsForProfile(profile, location) {
  const emails = [profile?.billingEmail, profile?.secondaryBillingEmail, location?.email]
    .map((e) => String(e || '').trim().toLowerCase())
    .filter(Boolean);
  return [...new Set(emails)];
}

/**
 * Invoice emails: short summary + PAY NOW → public invoice URL.
 * Detailed Zelle instructions and QR live on the public page only.
 */
export async function sendInvoiceEmail({ invoice, location, profile, kind = 'sent', publicToken }) {
  const settings = await getOrCreateSettings();
  const toList = await recipientsForProfile(profile, location);
  if (!toList.length) return false;

  const subjects = {
    sent: `Your Invoice is Ready — ${invoice.invoiceNumber}`,
    reminder: `Reminder: Invoice ${invoice.invoiceNumber} due ${new Date(invoice.dueDate).toLocaleDateString()}`,
    overdue: `Overdue: Invoice ${invoice.invoiceNumber}`,
    late_fee: `Late fee applied to Invoice ${invoice.invoiceNumber}`,
    receipt: `Payment received for Invoice ${invoice.invoiceNumber}`,
    statement: `Account statement — ${location?.name || 'your account'}`,
  };

  const subject = subjects[kind] || subjects.sent;
  const amountDue = Number(invoice.balanceDue ?? invoice.total ?? 0).toFixed(2);
  const dueDate = new Date(invoice.dueDate).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
  const payLink =
    shouldShowPayNow(kind) && publicToken ? publicInvoicePayUrl(publicToken) : '';

  const textLines = [
    'Your Invoice is Ready',
    '',
    `Invoice #${invoice.invoiceNumber}`,
    '',
    'Amount Due:',
    `$${amountDue}`,
    '',
    'Due Date:',
    dueDate,
    '',
  ];
  if (payLink) {
    textLines.push(
      'You can securely view your invoice and payment instructions by opening the link below.',
      '',
      'View available payment options — Zelle or card — from the secure invoice page.',
      '',
      `PAY NOW: ${payLink}`,
      '',
    );
  }
  textLines.push(`— ${settings.companyName || 'Mokanco'}`);
  const text = textLines.join('\n');

  const payButton = payLink
    ? `<tr>
        <td align="center" style="padding:28px 0 8px;">
          <a href="${escapeHtml(payLink)}" style="display:inline-block;background:#0f766e;color:#ffffff;font-weight:700;font-size:15px;letter-spacing:0.02em;padding:14px 36px;border-radius:8px;text-decoration:none;">PAY NOW</a>
        </td>
      </tr>
      <tr>
        <td align="center" style="padding:0 0 8px;color:#64748b;font-size:13px;line-height:1.5;">
          Click Pay Now to view your invoice and payment instructions.
        </td>
      </tr>
      <tr>
        <td align="center" style="padding:0 0 16px;color:#94a3b8;font-size:12px;">
          View available payment options — Zelle or card — from the secure invoice page.
        </td>
      </tr>`
    : '';

  const html = `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8" /><meta name="viewport" content="width=device-width,initial-scale=1" />
<title>${escapeHtml(subject)}</title></head>
<body style="margin:0;padding:0;background:#f1f5f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f1f5f9;padding:32px 12px;">
    <tr><td align="center">
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:560px;background:#ffffff;border-radius:16px;overflow:hidden;border:1px solid #e2e8f0;">
        <tr>
          <td style="padding:28px 28px 8px;text-align:center;">
            <div style="font-size:13px;font-weight:600;letter-spacing:0.08em;text-transform:uppercase;color:#0f766e;">${escapeHtml(settings.companyName || 'Mokanco')}</div>
            <h1 style="margin:12px 0 0;font-size:22px;line-height:1.3;color:#0f172a;font-weight:700;">Your Invoice is Ready</h1>
          </td>
        </tr>
        <tr>
          <td style="padding:8px 28px 0;text-align:center;color:#64748b;font-size:14px;">
            Invoice <strong style="color:#0f172a;">#${escapeHtml(invoice.invoiceNumber)}</strong>
          </td>
        </tr>
        <tr>
          <td style="padding:24px 28px;">
            <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f8fafc;border-radius:12px;border:1px solid #e2e8f0;">
              <tr>
                <td style="padding:18px 20px;width:50%;vertical-align:top;">
                  <div style="font-size:11px;font-weight:600;letter-spacing:0.06em;text-transform:uppercase;color:#94a3b8;">Amount Due</div>
                  <div style="margin-top:6px;font-size:26px;font-weight:700;color:#0f172a;">$${amountDue}</div>
                </td>
                <td style="padding:18px 20px;width:50%;vertical-align:top;border-left:1px solid #e2e8f0;">
                  <div style="font-size:11px;font-weight:600;letter-spacing:0.06em;text-transform:uppercase;color:#94a3b8;">Due Date</div>
                  <div style="margin-top:6px;font-size:16px;font-weight:600;color:#0f172a;">${escapeHtml(dueDate)}</div>
                </td>
              </tr>
            </table>
          </td>
        </tr>
        ${payButton}
        <tr>
          <td style="padding:8px 28px 28px;text-align:center;color:#94a3b8;font-size:12px;">
            — ${escapeHtml(settings.companyName || 'Mokanco')}
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;

  try {
    await dispatchEmail({ to: toList, subject, text, html });
    return true;
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error('[arMail] send failed', e?.message || e);
    return false;
  }
}
