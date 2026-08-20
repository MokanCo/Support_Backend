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

function money(n) {
  return `$${Number(n ?? 0).toFixed(2)}`;
}

function formatDate(d) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

function shouldShowPayNow(kind) {
  return ['sent', 'reminder', 'overdue', 'late_fee'].includes(kind);
}

/** Per-kind headline/accent so a reminder or overdue notice doesn't read as
 *  a fresh "Your Invoice is Ready" email — matches urgency to tone. */
const KIND_META = {
  sent: {
    headline: 'Your Invoice is Ready',
    intro: 'Please find your invoice details below.',
    accent: '#0f766e',
    accentBg: '#f0fdfa',
    accentBorder: '#99f6e4',
    badge: 'INVOICE',
  },
  reminder: {
    headline: 'Payment Reminder',
    intro: 'This is a friendly reminder that payment is due soon.',
    accent: '#b45309',
    accentBg: '#fffbeb',
    accentBorder: '#fde68a',
    badge: 'REMINDER',
  },
  overdue: {
    headline: 'Invoice Overdue',
    intro: 'This invoice is now past its due date — please arrange payment as soon as possible.',
    accent: '#b91c1c',
    accentBg: '#fef2f2',
    accentBorder: '#fecaca',
    badge: 'OVERDUE',
  },
  late_fee: {
    headline: 'Late Fee Applied',
    intro: 'A late fee has been applied to this invoice due to the missed due date.',
    accent: '#b91c1c',
    accentBg: '#fef2f2',
    accentBorder: '#fecaca',
    badge: 'LATE FEE',
  },
  receipt: {
    headline: 'Payment Received',
    intro: 'Thank you — we’ve received your payment. Here is your receipt.',
    accent: '#0f766e',
    accentBg: '#f0fdfa',
    accentBorder: '#99f6e4',
    badge: 'RECEIPT',
  },
  statement: {
    headline: 'Account Statement',
    intro: 'Here is your account statement summary.',
    accent: '#0f766e',
    accentBg: '#f0fdfa',
    accentBorder: '#99f6e4',
    badge: 'STATEMENT',
  },
};

async function recipientsForProfile(profile, location) {
  const emails = [profile?.billingEmail, profile?.secondaryBillingEmail, location?.email]
    .map((e) => String(e || '').trim().toLowerCase())
    .filter(Boolean);
  return [...new Set(emails)];
}

function billToAddress(location) {
  return [
    location?.address,
    [location?.city, location?.state, location?.zip].filter(Boolean).join(', '),
  ]
    .filter(Boolean)
    .join('\n');
}

function summaryRows(invoice) {
  const rows = [{ label: 'Subtotal', value: invoice.subtotal }];
  if (Number(invoice.discountAmount) > 0) {
    rows.push({ label: 'Discount', value: -Number(invoice.discountAmount) });
  }
  if (Number(invoice.taxAmount) > 0) {
    rows.push({ label: 'Tax', value: invoice.taxAmount });
  }
  if (Number(invoice.lateFeeAmount) > 0) {
    rows.push({ label: 'Late fee', value: invoice.lateFeeAmount });
  }
  if (Number(invoice.creditApplied) > 0) {
    rows.push({ label: 'Credit applied', value: -Number(invoice.creditApplied) });
  }
  rows.push({ label: 'Total', value: invoice.total, bold: true });
  if (Number(invoice.amountPaid) > 0) {
    rows.push({ label: 'Amount paid', value: -Number(invoice.amountPaid) });
  }
  return rows;
}

function itemsTableText(items) {
  if (!items?.length) return '';
  const lines = items.map(
    (i) => `  - ${i.name} (x${i.quantity}) — ${money(i.lineTotal ?? i.quantity * i.unitPrice)}`,
  );
  return ['', 'Items:', ...lines, ''].join('\n');
}

function itemsTableHtml(items) {
  if (!items?.length) return '';
  const rows = items
    .map(
      (i) => `<tr>
        <td style="padding:10px 0;border-top:1px solid #e2e8f0;color:#334155;font-size:13px;">
          <div style="font-weight:600;color:#0f172a;">${escapeHtml(i.name)}</div>
          ${i.description ? `<div style="color:#94a3b8;font-size:12px;margin-top:2px;">${escapeHtml(i.description)}</div>` : ''}
          <div style="color:#94a3b8;font-size:12px;margin-top:2px;">${i.quantity} &times; ${money(i.unitPrice)}</div>
        </td>
        <td style="padding:10px 0;border-top:1px solid #e2e8f0;text-align:right;vertical-align:top;color:#0f172a;font-weight:600;font-size:13px;">
          ${money(i.lineTotal ?? i.quantity * i.unitPrice)}
        </td>
      </tr>`,
    )
    .join('');
  return `
    <tr>
      <td style="padding:0 28px;">
        <p style="margin:20px 0 4px;font-size:12px;font-weight:700;letter-spacing:0.04em;text-transform:uppercase;color:#94a3b8;">Items</p>
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
          ${rows}
        </table>
      </td>
    </tr>`;
}

function summaryRowsHtml(rows) {
  return rows
    .map(
      (r) => `<div style="display:flex;justify-content:space-between;gap:12px;padding:${r.bold ? '10px 0 0' : '4px 0'};${r.bold ? 'border-top:1px solid #e2e8f0;margin-top:6px;' : ''}">
        <span style="color:${r.bold ? '#0f172a' : '#64748b'};font-size:${r.bold ? '14px' : '13px'};font-weight:${r.bold ? '700' : '500'};">${escapeHtml(r.label)}</span>
        <span style="color:${r.bold ? '#0f172a' : '#334155'};font-size:${r.bold ? '14px' : '13px'};font-weight:${r.bold ? '700' : '600'};">${r.value < 0 ? '−' : ''}${money(Math.abs(r.value))}</span>
      </div>`,
    )
    .join('');
}

/**
 * Pure template builder (no I/O) — returns {subject, text, html} for an
 * invoice email, tuned per kind (sent/reminder/overdue/late fee/receipt/
 * statement). Split out from sendInvoiceEmail so it can be previewed/tested
 * without needing a mail transport.
 */
export function buildInvoiceEmailContent({ invoice, location, profile, kind = 'sent', publicToken, settings }) {
  const meta = KIND_META[kind] || KIND_META.sent;
  const companyName = settings.companyName || 'Mokanco';

  const subjects = {
    sent: `Your Invoice is Ready — ${invoice.invoiceNumber}`,
    reminder: `Reminder: Invoice ${invoice.invoiceNumber} due ${formatDate(invoice.dueDate)}`,
    overdue: `Overdue: Invoice ${invoice.invoiceNumber}`,
    late_fee: `Late fee applied to Invoice ${invoice.invoiceNumber}`,
    receipt: `Payment received for Invoice ${invoice.invoiceNumber}`,
    statement: `Account statement — ${location?.name || 'your account'}`,
  };
  const subject = subjects[kind] || subjects.sent;

  const amountDue = Number(invoice.balanceDue ?? invoice.total ?? 0);
  const payLink =
    shouldShowPayNow(kind) && publicToken ? publicInvoicePayUrl(publicToken) : '';
  const greetingName = location?.name || profile?.billingContactName || 'there';
  const rows = summaryRows(invoice);

  // ---------------------------------------------------------------- text --
  const textLines = [
    meta.headline,
    '',
    `Hi ${greetingName},`,
    '',
    meta.intro,
    '',
    `Invoice: #${invoice.invoiceNumber}`,
    `Invoice date: ${formatDate(invoice.invoiceDate)}`,
    `Due date: ${formatDate(invoice.dueDate)}`,
    itemsTableText(invoice.items),
    ...rows.map((r) => `${r.label}: ${r.value < 0 ? '-' : ''}${money(Math.abs(r.value))}`),
    '',
    `Balance due: ${money(amountDue)}`,
    '',
  ];
  if (payLink) {
    textLines.push(
      'View your invoice and available payment options (Zelle or card) on the secure invoice page.',
      '',
      `PAY NOW: ${payLink}`,
      '',
    );
  }
  if (invoice.notes) {
    textLines.push('Notes:', invoice.notes, '');
  }
  textLines.push(
    `Questions about this invoice? Contact us${settings.supportEmail ? ` at ${settings.supportEmail}` : ''}${settings.companyPhone ? ` or ${settings.companyPhone}` : ''}.`,
    '',
    `— ${companyName}`,
  );
  const text = textLines.filter((l, i, arr) => l !== '' || arr[i - 1] !== '').join('\n');

  // ---------------------------------------------------------------- html --
  const logo = settings.logoUrl
    ? `<img src="${escapeHtml(settings.logoUrl)}" alt="${escapeHtml(companyName)}" height="28" style="display:block;margin:0 auto 8px;max-height:28px;" />`
    : '';

  const payButton = payLink
    ? `<tr>
        <td align="center" style="padding:28px 28px 8px;">
          <a href="${escapeHtml(payLink)}" style="display:inline-block;background:${meta.accent};color:#ffffff;font-weight:700;font-size:15px;letter-spacing:0.02em;padding:14px 40px;border-radius:8px;text-decoration:none;box-shadow:0 2px 8px rgba(15,23,42,0.15);">PAY NOW</a>
        </td>
      </tr>
      <tr>
        <td align="center" style="padding:0 28px 4px;color:#64748b;font-size:13px;line-height:1.5;">
          Click Pay Now to view your invoice and payment options.
        </td>
      </tr>
      <tr>
        <td align="center" style="padding:0 28px 20px;color:#94a3b8;font-size:12px;">
          Zelle and card payment options are available on the secure invoice page.
        </td>
      </tr>`
    : '';

  const notesBlock = invoice.notes
    ? `<tr>
        <td style="padding:4px 28px 20px;">
          <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;padding:12px 14px;">
            <p style="margin:0 0 4px;font-size:11px;font-weight:700;letter-spacing:0.04em;text-transform:uppercase;color:#94a3b8;">Notes</p>
            <p style="margin:0;color:#475569;font-size:13px;line-height:1.5;">${escapeHtml(invoice.notes)}</p>
          </div>
        </td>
      </tr>`
    : '';

  const address = billToAddress(location);
  const billToBlock = location
    ? `<tr>
        <td style="padding:20px 28px 0;">
          <p style="margin:0 0 4px;font-size:11px;font-weight:700;letter-spacing:0.04em;text-transform:uppercase;color:#94a3b8;">Bill To</p>
          <p style="margin:0;font-size:14px;font-weight:600;color:#0f172a;">${escapeHtml(location.name)}</p>
          ${address ? `<p style="margin:2px 0 0;font-size:13px;color:#64748b;white-space:pre-line;">${escapeHtml(address)}</p>` : ''}
        </td>
      </tr>`
    : '';

  const footerContactParts = [
    settings.supportEmail ? `Support: ${escapeHtml(settings.supportEmail)}` : '',
    settings.companyPhone ? escapeHtml(settings.companyPhone) : '',
  ].filter(Boolean);

  const html = `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8" /><meta name="viewport" content="width=device-width,initial-scale=1" />
<title>${escapeHtml(subject)}</title></head>
<body style="margin:0;padding:0;background:#f1f5f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f1f5f9;padding:32px 12px;">
    <tr><td align="center">
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:580px;background:#ffffff;border-radius:16px;overflow:hidden;border:1px solid #e2e8f0;">

        <tr>
          <td style="background:${meta.accentBg};border-bottom:1px solid ${meta.accentBorder};padding:28px 28px 22px;text-align:center;">
            ${logo}
            <div style="font-size:12px;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:${meta.accent};">${escapeHtml(companyName)}</div>
            <h1 style="margin:10px 0 0;font-size:22px;line-height:1.3;color:#0f172a;font-weight:700;">${escapeHtml(meta.headline)}</h1>
            <span style="display:inline-block;margin-top:10px;padding:3px 10px;border-radius:999px;background:${meta.accent};color:#ffffff;font-size:10px;font-weight:700;letter-spacing:0.08em;">${meta.badge} · #${escapeHtml(invoice.invoiceNumber)}</span>
          </td>
        </tr>

        <tr>
          <td style="padding:22px 28px 0;color:#334155;font-size:14px;line-height:1.6;">
            Hi <strong style="color:#0f172a;">${escapeHtml(greetingName)}</strong>,<br />
            ${escapeHtml(meta.intro)}
          </td>
        </tr>

        ${billToBlock}

        <tr>
          <td style="padding:20px 28px 0;">
            <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f8fafc;border-radius:12px;border:1px solid #e2e8f0;">
              <tr>
                <td style="padding:16px 18px;width:33%;vertical-align:top;">
                  <div style="font-size:11px;font-weight:700;letter-spacing:0.05em;text-transform:uppercase;color:#94a3b8;">Invoice Date</div>
                  <div style="margin-top:4px;font-size:14px;font-weight:600;color:#0f172a;">${escapeHtml(formatDate(invoice.invoiceDate))}</div>
                </td>
                <td style="padding:16px 18px;width:33%;vertical-align:top;border-left:1px solid #e2e8f0;">
                  <div style="font-size:11px;font-weight:700;letter-spacing:0.05em;text-transform:uppercase;color:#94a3b8;">Due Date</div>
                  <div style="margin-top:4px;font-size:14px;font-weight:600;color:#0f172a;">${escapeHtml(formatDate(invoice.dueDate))}</div>
                </td>
                <td style="padding:16px 18px;width:34%;vertical-align:top;border-left:1px solid #e2e8f0;">
                  <div style="font-size:11px;font-weight:700;letter-spacing:0.05em;text-transform:uppercase;color:#94a3b8;">Balance Due</div>
                  <div style="margin-top:4px;font-size:18px;font-weight:800;color:${meta.accent};">${money(amountDue)}</div>
                </td>
              </tr>
            </table>
          </td>
        </tr>

        ${itemsTableHtml(invoice.items)}

        <tr>
          <td style="padding:16px 28px 0;">
            ${summaryRowsHtml(rows)}
          </td>
        </tr>

        ${notesBlock}

        ${payButton}

        <tr>
          <td style="padding:20px 28px 24px;border-top:1px solid #f1f5f9;text-align:center;">
            <p style="margin:0;color:#94a3b8;font-size:12px;">
              ${footerContactParts.length ? footerContactParts.join(' &middot; ') + '<br />' : ''}
              — ${escapeHtml(companyName)}
            </p>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;

  return { subject, text, html };
}

/**
 * Invoice emails: branded summary + itemized breakdown + PAY NOW → public
 * invoice URL. Detailed Zelle/card instructions and QR live on the public
 * page only.
 */
export async function sendInvoiceEmail({ invoice, location, profile, kind = 'sent', publicToken }) {
  const settings = await getOrCreateSettings();
  const toList = await recipientsForProfile(profile, location);
  if (!toList.length) return false;

  const { subject, text, html } = buildInvoiceEmailContent({
    invoice,
    location,
    profile,
    kind,
    publicToken,
    settings,
  });

  try {
    await dispatchEmail({ to: toList, subject, text, html });
    return true;
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error('[arMail] send failed', e?.message || e);
    return false;
  }
}
