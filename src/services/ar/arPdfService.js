import PDFDocument from 'pdfkit';
import { getOrCreateSettings } from './arSettingsService.js';
import { resolveTemplateForInvoice } from './arInvoiceTemplateService.js';
import { AR_DEFAULT_INVOICE_BLOCKS } from '../../constants/arConstants.js';

function money(n) {
  return `$${Number(n || 0).toFixed(2)}`;
}

function renderBlock(doc, block, ctx) {
  if (block.enabled === false) return;

  const { invoice, location, profile, settings } = ctx;
  const align = block.align || 'left';
  const fontSize = Number(block.fontSize) || 10;

  switch (block.type) {
    case 'company_header': {
      const company = settings.companyName || 'Mokanco';
      doc.fontSize(Math.max(fontSize + 8, 18)).fillColor('#000').text(company, { align });
      doc.fontSize(fontSize).fillColor('#555');
      if (settings.companyAddress) doc.text(settings.companyAddress, { align });
      if (settings.companyPhone) doc.text(settings.companyPhone, { align });
      if (settings.billingEmail) doc.text(settings.billingEmail, { align });
      doc.fillColor('#000').moveDown();
      break;
    }
    case 'invoice_meta': {
      doc.fontSize(Math.max(fontSize + 4, 14)).fillColor('#000').text('INVOICE', { align: 'right' });
      doc.fontSize(fontSize);
      doc.text(`Invoice #: ${invoice.invoiceNumber || 'DRAFT'}`, { align: 'right' });
      if (invoice.invoiceDate) {
        doc.text(`Date: ${new Date(invoice.invoiceDate).toLocaleDateString()}`, { align: 'right' });
      }
      if (invoice.dueDate) {
        doc.text(`Due: ${new Date(invoice.dueDate).toLocaleDateString()}`, { align: 'right' });
      }
      doc.moveDown();
      break;
    }
    case 'bill_to': {
      doc.fontSize(fontSize + 1).fillColor('#000').text('Bill To', { underline: true, align });
      doc.fontSize(fontSize);
      doc.text(location?.name || '', { align });
      if (profile?.billingEmail) doc.text(profile.billingEmail, { align });
      const addr = profile?.billingAddress || {};
      if (addr.line1) doc.text(addr.line1, { align });
      const cityLine = [addr.city, addr.state, addr.zip].filter(Boolean).join(', ');
      if (cityLine) doc.text(cityLine, { align });
      doc.moveDown();
      break;
    }
    case 'line_items': {
      doc.fontSize(fontSize + 1).fillColor('#000').text('Items', { underline: true, align });
      doc.moveDown(0.4);
      for (const item of invoice.items || []) {
        doc
          .fontSize(fontSize)
          .fillColor('#000')
          .text(
            `${item.name}  x${item.quantity}  @ ${money(item.unitPrice)}  = ${money(item.lineTotal)}`,
            { align },
          );
        if (item.description) {
          doc.fillColor('#666').text(`  ${item.description}`, { align }).fillColor('#000');
        }
      }
      doc.moveDown();
      break;
    }
    case 'totals': {
      doc.fontSize(fontSize).fillColor('#000');
      doc.text(`Subtotal: ${money(invoice.subtotal)}`, { align: 'right' });
      if (invoice.discountAmount) {
        doc.text(`Discount: -${money(invoice.discountAmount)}`, { align: 'right' });
      }
      if (invoice.taxAmount) {
        doc.text(`Tax: ${money(invoice.taxAmount)}`, { align: 'right' });
      }
      if (invoice.lateFeeAmount) {
        doc.text(`Late fee: ${money(invoice.lateFeeAmount)}`, { align: 'right' });
      }
      if (invoice.creditApplied) {
        doc.text(`Credits: -${money(invoice.creditApplied)}`, { align: 'right' });
      }
      doc.fontSize(fontSize + 2).text(`Total: ${money(invoice.total)}`, { align: 'right' });
      doc.text(`Balance due: ${money(invoice.balanceDue)}`, { align: 'right' });
      doc.moveDown();
      break;
    }
    case 'notes': {
      if (!invoice.notes) break;
      doc.fontSize(fontSize + 1).fillColor('#000').text(block.label || 'Notes', { underline: true, align });
      doc.fontSize(fontSize).text(invoice.notes, { align });
      doc.moveDown();
      break;
    }
    case 'payment_instructions': {
      const text = settings.paymentInstructions || '';
      if (!text) break;
      doc.fontSize(fontSize).fillColor('#555').text(text, { align });
      doc.fillColor('#000').moveDown();
      break;
    }
    case 'terms': {
      const text = settings.termsAndConditions || '';
      if (!text) break;
      doc.fontSize(fontSize + 1).fillColor('#000').text(block.label || 'Terms & Conditions', {
        underline: true,
        align,
      });
      doc.fontSize(fontSize).fillColor('#555').text(text, { align });
      doc.fillColor('#000').moveDown();
      break;
    }
    case 'custom_text': {
      const text = String(block.content || '').trim();
      if (!text) break;
      doc.fontSize(fontSize).fillColor('#000').text(text, { align });
      doc.moveDown();
      break;
    }
    case 'spacer': {
      doc.moveDown(1.2);
      break;
    }
    default:
      break;
  }
}

/**
 * Generate invoice PDF using an optional layout template (ordered blocks).
 */
export async function generateInvoicePdfBuffer(invoice, location, profile, templateOverride) {
  const settings = await getOrCreateSettings();
  const template =
    templateOverride
    || (await resolveTemplateForInvoice(invoice.invoiceTemplateId || invoice.templateId));

  const blocks =
    template?.blocks?.length > 0
      ? template.blocks
      : AR_DEFAULT_INVOICE_BLOCKS.map((b, i) => ({
          id: String(i),
          ...b,
          content: '',
          align: 'left',
          fontSize: 10,
        }));

  const ctx = { invoice, location, profile, settings };

  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 50, size: 'LETTER' });
    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    for (const block of blocks) {
      renderBlock(doc, block, ctx);
    }

    doc.end();
  });
}
