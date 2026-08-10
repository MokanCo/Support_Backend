import { dispatchEmail } from '../mailSender.js';
import { getOrCreateSettings } from './arSettingsService.js';

function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

async function recipientsForProfile(profile, location) {
  const emails = [
    profile?.billingEmail,
    profile?.secondaryBillingEmail,
    location?.email,
  ]
    .map((e) => String(e || '').trim().toLowerCase())
    .filter(Boolean);
  return [...new Set(emails)];
}

export async function sendInvoiceEmail({ invoice, location, profile, kind = 'sent' }) {
  const settings = await getOrCreateSettings();
  const toList = await recipientsForProfile(profile, location);
  if (!toList.length) return false;

  const subjects = {
    sent: `Invoice ${invoice.invoiceNumber} from ${settings.companyName}`,
    reminder: `Reminder: Invoice ${invoice.invoiceNumber} due ${new Date(invoice.dueDate).toLocaleDateString()}`,
    overdue: `Overdue: Invoice ${invoice.invoiceNumber}`,
    late_fee: `Late fee applied to Invoice ${invoice.invoiceNumber}`,
    receipt: `Payment received for Invoice ${invoice.invoiceNumber}`,
    statement: `Account statement — ${location?.name || 'your account'}`,
  };

  const subject = subjects[kind] || subjects.sent;
  const text = [
    `Hello ${location?.name || 'Partner'},`,
    '',
    subject,
    '',
    `Invoice: ${invoice.invoiceNumber}`,
    `Total: $${Number(invoice.total).toFixed(2)}`,
    `Balance due: $${Number(invoice.balanceDue).toFixed(2)}`,
    `Due date: ${new Date(invoice.dueDate).toLocaleDateString()}`,
    '',
    settings.paymentInstructions || '',
    '',
    `— ${settings.companyName}`,
  ].join('\n');

  const html = `<!DOCTYPE html><html><body style="font-family:system-ui,sans-serif;padding:24px;">
    <h2>${escapeHtml(subject)}</h2>
    <p>Hello <strong>${escapeHtml(location?.name || 'Partner')}</strong>,</p>
    <p>Invoice <strong>${escapeHtml(invoice.invoiceNumber)}</strong></p>
    <p>Total: $${Number(invoice.total).toFixed(2)}<br>
    Balance due: $${Number(invoice.balanceDue).toFixed(2)}<br>
    Due: ${escapeHtml(new Date(invoice.dueDate).toLocaleDateString())}</p>
    <p style="color:#555;">${escapeHtml(settings.paymentInstructions || '')}</p>
    <p>— ${escapeHtml(settings.companyName)}</p>
  </body></html>`;

  try {
    await dispatchEmail({ to: toList, subject, text, html });
    return true;
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error('[arMail] send failed', e?.message || e);
    return false;
  }
}
