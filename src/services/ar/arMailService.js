import { dispatchEmail } from '../mailSender.js';
import { getOrCreateSettings } from './arSettingsService.js';

function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

const TYPE_LABELS = {
  zelle: 'Zelle',
  wire: 'Wire Transfer',
  ach: 'ACH / Bank Transfer',
  check: 'Check',
  cash: 'Cash',
  card: 'Credit Card',
  other: 'Other',
};

/** Emails for an invoice that still has a balance owed show every enabled
 *  payment method; a paid receipt or a statement doesn't need them. */
function shouldShowPaymentMethods(kind) {
  return ['sent', 'reminder', 'overdue', 'late_fee'].includes(kind);
}

function enabledPaymentMethods(settings) {
  return (settings.paymentMethods || []).filter((m) => m.enabled !== false);
}

/** Link into the portal's own secure payment page (requires the partner to be
 *  logged in — reuses existing auth, no separate public token system) where
 *  they can view this method's details and, after actually sending the money
 *  themselves, report it for an admin to verify. */
function payUrl(invoiceId, type) {
  const base = (process.env.APP_URL || process.env.FRONTEND_URL || '').replace(/\/$/, '');
  if (!base || !invoiceId) return '';
  return `${base}/dashboard/ar/pay?invoice=${encodeURIComponent(invoiceId)}&method=${encodeURIComponent(type)}`;
}

function zelleRecipientLine(m) {
  const parts = [m.recipientEmail, m.recipientPhone].map((v) => String(v || '').trim()).filter(Boolean);
  return parts.length ? parts.join(' or ') : m.details || '';
}

/** The prominent, numbered Zelle block the spec asks for — placed above the
 *  PAY NOW button. Only rendered when a Zelle method is actually configured. */
function zelleBlockText(method, invoice, invoiceId) {
  const recipient = zelleRecipientLine(method);
  const amount = Number(invoice.balanceDue).toFixed(2);
  const lines = [
    '',
    'HOW TO PAY WITH ZELLE',
    '',
    '1. Open your banking app and select Zelle.',
    '2. Choose "Send Money with Zelle".',
    '3. Enter the Zelle recipient shown below.',
    '4. Enter the exact invoice amount.',
    '5. Enter the invoice number in the memo/message.',
    '6. Review the payment details and send the payment.',
    '7. After sending the payment, click PAY NOW below',
    '   to view the invoice and confirm your payment.',
    '',
  ];
  if (recipient) lines.push('Zelle Recipient:', recipient, '');
  lines.push('Invoice:', invoice.invoiceNumber, '', 'Amount:', `$${amount}`, '');
  const url = payUrl(invoiceId, method.type);
  if (url) lines.push(`PAY NOW: ${url}`);
  return lines.join('\n');
}

function zelleBlockHtml(method, invoice, invoiceId) {
  const recipient = zelleRecipientLine(method);
  const amount = Number(invoice.balanceDue).toFixed(2);
  const url = payUrl(invoiceId, method.type);
  const qr = method.qrCodeUrl
    ? `<div style="margin:14px 0;"><img src="${escapeHtml(method.qrCodeUrl)}" alt="Zelle QR code" width="140" height="140" style="border:1px solid #e2e8f0;border-radius:8px;" /></div>`
    : '';
  return `
    <div style="margin-top:20px;padding:18px;border:1px solid #e2e8f0;border-radius:12px;background:#f8fafc;">
      <p style="font-weight:700;color:#0f172a;font-size:15px;margin:0 0 10px;">HOW TO PAY WITH ZELLE</p>
      <ol style="color:#334155;font-size:14px;line-height:1.6;margin:0 0 14px;padding-left:20px;">
        <li>Open your banking app and select Zelle.</li>
        <li>Choose &ldquo;Send Money with Zelle&rdquo;.</li>
        <li>Enter the Zelle recipient shown below.</li>
        <li>Enter the exact invoice amount.</li>
        <li>Enter the invoice number in the memo/message.</li>
        <li>Review the payment details and send the payment.</li>
        <li>After sending the payment, click PAY NOW below to view the invoice and confirm your payment.</li>
      </ol>
      ${qr}
      ${recipient ? `<p style="margin:0 0 8px;color:#0f172a;"><strong>Zelle Recipient:</strong><br>${escapeHtml(recipient)}</p>` : ''}
      <p style="margin:0 0 8px;color:#0f172a;"><strong>Invoice:</strong><br>${escapeHtml(invoice.invoiceNumber)}</p>
      <p style="margin:0 0 16px;color:#0f172a;"><strong>Amount:</strong><br>$${amount}</p>
      ${
        url
          ? `<a href="${url}" style="display:inline-block;background:#0d9488;color:#ffffff;font-weight:700;font-size:14px;padding:12px 28px;border-radius:8px;text-decoration:none;">PAY NOW</a>`
          : ''
      }
    </div>`;
}

function otherMethodsTextBlock(methods) {
  if (!methods.length) return '';
  const lines = methods.map(
    (m) => `- ${m.label || TYPE_LABELS[m.type] || 'Payment method'}: ${m.details || ''}`.trim(),
  );
  return ['', 'Other ways to pay:', ...lines].join('\n');
}

function otherMethodsHtmlBlock(methods) {
  if (!methods.length) return '';
  const items = methods
    .map(
      (m) => `<div style="margin-bottom:10px;padding:12px 14px;border:1px solid #e2e8f0;border-radius:10px;background:#f8fafc;">
        <div style="font-weight:600;color:#0f172a;">${escapeHtml(m.label || TYPE_LABELS[m.type] || 'Payment method')}</div>
        ${m.details ? `<div style="color:#475569;margin-top:2px;">${escapeHtml(m.details)}</div>` : ''}
      </div>`,
    )
    .join('');
  return `<div style="margin-top:16px;">
    <p style="font-weight:600;color:#0f172a;margin-bottom:8px;">Other ways to pay</p>
    ${items}
  </div>`;
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
  const showMethods = shouldShowPaymentMethods(kind);
  const methods = showMethods ? enabledPaymentMethods(settings) : [];
  const zelle = methods.find((m) => m.type === 'zelle');
  const otherMethods = methods.filter((m) => m !== zelle);
  const invoiceId = invoice.id || (invoice._id ? String(invoice._id) : '');

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
    zelle ? zelleBlockText(zelle, invoice, invoiceId) : '',
    otherMethodsTextBlock(otherMethods),
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
    ${zelle ? zelleBlockHtml(zelle, invoice, invoiceId) : ''}
    ${otherMethodsHtmlBlock(otherMethods)}
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
