import ArInvoice from '../../models/ArInvoice.js';
import ArInvoiceCounter from '../../models/ArInvoiceCounter.js';
import ArPayment from '../../models/ArPayment.js';
import Location from '../../models/Location.js';
import ArBillingProfile from '../../models/ArBillingProfile.js';
import { AppError } from '../../utils/AppError.js';
import {
  assertCanManageAr,
  assertCanViewAr,
  assertCanAccessLocation,
  locationScopeFilter,
  parseListQuery,
  money,
} from './arAccess.js';
import { writeArAudit } from './arAuditService.js';
import { getOrCreateSettings } from './arSettingsService.js';
import { generateInvoicePdfBuffer } from './arPdfService.js';
import { sendInvoiceEmail } from './arMailService.js';
import { ensurePublicPaymentToken } from './arPublicInvoiceService.js';

function calcLine(item) {
  const quantity = Number(item.quantity) || 0;
  const unitPrice = money(item.unitPrice);
  const lineTotal = money(quantity * unitPrice);
  return {
    productId: item.productId || null,
    name: String(item.name || '').trim(),
    description: String(item.description || '').trim(),
    quantity,
    unitPrice,
    taxable: Boolean(item.taxable),
    taxPercentage: money(item.taxPercentage),
    lineTotal,
  };
}

export function recalculateTotals(invoiceLike) {
  const items = (invoiceLike.items || []).map(calcLine);
  const subtotal = money(items.reduce((s, i) => s + i.lineTotal, 0));
  let taxAmount = 0;
  for (const item of items) {
    if (item.taxable && item.taxPercentage > 0) {
      taxAmount += money((item.lineTotal * item.taxPercentage) / 100);
    }
  }
  taxAmount = money(taxAmount);
  const discountAmount = money(invoiceLike.discountAmount);
  const lateFeeAmount = money(invoiceLike.lateFeeAmount);
  const creditApplied = money(invoiceLike.creditApplied);
  const total = money(subtotal - discountAmount + taxAmount + lateFeeAmount - creditApplied);
  const amountPaid = money(invoiceLike.amountPaid);
  const balanceDue = money(Math.max(0, total - amountPaid));
  return {
    items,
    subtotal,
    taxAmount,
    discountAmount,
    lateFeeAmount,
    creditApplied,
    total: Math.max(0, total),
    amountPaid,
    balanceDue,
  };
}

function deriveStatus(invoice) {
  if (['cancelled', 'void', 'draft', 'pending_approval', 'scheduled'].includes(invoice.status)) {
    return invoice.status;
  }
  if (invoice.balanceDue <= 0 && invoice.total > 0) return 'paid';
  if (invoice.amountPaid > 0 && invoice.balanceDue > 0) return 'partially_paid';
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const due = new Date(invoice.dueDate);
  due.setHours(0, 0, 0, 0);
  if (due < today && invoice.balanceDue > 0) return 'overdue';
  if (invoice.viewedAt) return 'viewed';
  if (invoice.sentAt) return 'sent';
  return invoice.status;
}

function pushTimeline(invoice, event) {
  invoice.timeline = invoice.timeline || [];
  invoice.timeline.push({
    eventType: event.eventType,
    title: event.title,
    description: event.description || '',
    userId: event.userId || null,
    userName: event.userName || '',
    ipAddress: event.ipAddress || '',
    createdAt: new Date(),
  });
}

function formatInvoice(doc, locationName = '') {
  const d = doc.toObject ? doc.toObject() : doc;
  return {
    id: String(d._id),
    invoiceNumber: d.invoiceNumber,
    locationId: String(d.locationId),
    locationName,
    recurringTemplateId: d.recurringTemplateId ? String(d.recurringTemplateId) : null,
    invoiceTemplateId: d.invoiceTemplateId ? String(d.invoiceTemplateId) : null,
    status: d.status,
    invoiceDate: d.invoiceDate,
    dueDate: d.dueDate,
    billingPeriodStart: d.billingPeriodStart,
    billingPeriodEnd: d.billingPeriodEnd,
    currency: d.currency,
    items: d.items || [],
    notes: d.notes,
    internalNotes: d.internalNotes,
    discountAmount: d.discountAmount,
    taxAmount: d.taxAmount,
    lateFeeAmount: d.lateFeeAmount,
    creditApplied: d.creditApplied,
    subtotal: d.subtotal,
    total: d.total,
    amountPaid: d.amountPaid,
    balanceDue: d.balanceDue,
    attachments: d.attachments || [],
    timeline: d.timeline || [],
    pdfUrl: d.pdfUrl,
    publicPaymentToken: d.publicPaymentToken || null,
    sentAt: d.sentAt,
    viewedAt: d.viewedAt,
    paidAt: d.paidAt,
    scheduledSendAt: d.scheduledSendAt,
    createdAt: d.createdAt,
    updatedAt: d.updatedAt,
  };
}

export async function nextInvoiceNumber() {
  const settings = await getOrCreateSettings();
  const year = new Date().getFullYear();
  const counter = await ArInvoiceCounter.findOneAndUpdate(
    { year },
    { $inc: { seq: 1 } },
    { upsert: true, new: true },
  );
  const pad = Math.max(3, Number(settings.invoiceNumberPadding) || 6);
  const seq = String(counter.seq).padStart(pad, '0');
  const prefix = settings.invoiceNumberPrefix || 'INV';
  if (settings.invoiceNumberIncludeYear !== false) {
    return `${prefix}-${year}-${seq}`;
  }
  return `${prefix}-${seq}`;
}

export async function listInvoices(actor, query) {
  assertCanViewAr(actor);
  const { page, pageSize, sort, order, search, skip } = parseListQuery(query, {
    defaultSort: 'invoiceDate',
  });
  const filter = { isDeleted: { $ne: true }, ...locationScopeFilter(actor, query.locationId) };
  if (query.status) filter.status = query.status;
  if (search) {
    filter.$or = [
      { invoiceNumber: new RegExp(search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i') },
      { notes: new RegExp(search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i') },
    ];
  }

  const [items, total] = await Promise.all([
    ArInvoice.find(filter).sort({ [sort]: order }).skip(skip).limit(pageSize).lean(),
    ArInvoice.countDocuments(filter),
  ]);

  const locIds = [...new Set(items.map((i) => String(i.locationId)))];
  const locs = await Location.find({ _id: { $in: locIds } }).lean();
  const locMap = new Map(locs.map((l) => [String(l._id), l.name]));

  return {
    invoices: items.map((i) => formatInvoice(i, locMap.get(String(i.locationId)) || '')),
    total,
    page,
    pageSize,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
  };
}

export async function getInvoice(actor, id) {
  assertCanViewAr(actor);
  const doc = await ArInvoice.findOne({ _id: id, isDeleted: { $ne: true } });
  if (!doc) throw new AppError('Invoice not found', 404);
  assertCanAccessLocation(actor, doc.locationId);
  // Ensure partners/admins can open the same public Pay Now URL as the email.
  if (
    doc.invoiceNumber &&
    !['draft', 'void', 'cancelled'].includes(doc.status) &&
    (!doc.publicPaymentToken || doc.publicPaymentTokenRevokedAt)
  ) {
    await ensurePublicPaymentToken(doc);
  }
  const location = await Location.findById(doc.locationId).lean();
  return { invoice: formatInvoice(doc, location?.name || '') };
}

export async function createInvoice(actor, input, ipAddress = '') {
  assertCanManageAr(actor);
  const locationId = input.locationId;
  if (!locationId) throw new AppError('locationId is required', 400);
  const location = await Location.findById(locationId);
  if (!location) throw new AppError('Location not found', 404);

  const settings = await getOrCreateSettings();
  const invoiceDate = input.invoiceDate ? new Date(input.invoiceDate) : new Date();
  const terms = Number(input.paymentTermsDays ?? settings.defaultPaymentTermsDays) || 15;
  const dueDate = input.dueDate
    ? new Date(input.dueDate)
    : new Date(invoiceDate.getTime() + terms * 86400000);

  const totals = recalculateTotals({
    items: input.items || [],
    discountAmount: input.discountAmount || 0,
    lateFeeAmount: 0,
    creditApplied: 0,
    amountPaid: 0,
  });

  const doc = new ArInvoice({
    locationId,
    status: input.status || 'draft',
    invoiceDate,
    dueDate,
    billingPeriodStart: input.billingPeriodStart || null,
    billingPeriodEnd: input.billingPeriodEnd || null,
    currency: input.currency || settings.defaultCurrency || 'USD',
    notes: input.notes || settings.defaultNotes || '',
    internalNotes: input.internalNotes || '',
    invoiceTemplateId: input.invoiceTemplateId || null,
    ...totals,
    createdBy: actor.id,
  });

  pushTimeline(doc, {
    eventType: 'created',
    title: 'Invoice Created',
    description: 'Invoice draft created',
    userId: actor.id,
    userName: actor.name,
    ipAddress,
  });

  await doc.save();
  await writeArAudit({
    entityType: 'invoice',
    entityId: String(doc._id),
    action: 'invoice_created',
    description: 'Invoice created',
    newValue: formatInvoice(doc, location.name),
    actor,
    ipAddress,
  });

  return { invoice: formatInvoice(doc, location.name) };
}

export async function updateInvoice(actor, id, patch, ipAddress = '') {
  assertCanManageAr(actor);
  const doc = await ArInvoice.findOne({ _id: id, isDeleted: { $ne: true } });
  if (!doc) throw new AppError('Invoice not found', 404);
  if (['paid', 'void', 'cancelled'].includes(doc.status) && patch.items) {
    throw new AppError('Cannot edit line items on a closed invoice', 400);
  }
  const prev = formatInvoice(doc);
  const location = await Location.findById(doc.locationId).lean();

  if (patch.invoiceDate) doc.invoiceDate = new Date(patch.invoiceDate);
  if (patch.dueDate) doc.dueDate = new Date(patch.dueDate);
  if (patch.notes !== undefined) doc.notes = patch.notes;
  if (patch.internalNotes !== undefined) doc.internalNotes = patch.internalNotes;
  if (patch.invoiceTemplateId !== undefined) {
    doc.invoiceTemplateId = patch.invoiceTemplateId || null;
  }
  if (patch.billingPeriodStart !== undefined) doc.billingPeriodStart = patch.billingPeriodStart;
  if (patch.billingPeriodEnd !== undefined) doc.billingPeriodEnd = patch.billingPeriodEnd;
  if (patch.discountAmount !== undefined) doc.discountAmount = money(patch.discountAmount);
  if (patch.items) {
    const totals = recalculateTotals({
      items: patch.items,
      discountAmount: doc.discountAmount,
      lateFeeAmount: doc.lateFeeAmount,
      creditApplied: doc.creditApplied,
      amountPaid: doc.amountPaid,
    });
    Object.assign(doc, totals);
  } else if (patch.discountAmount !== undefined) {
    const totals = recalculateTotals(doc);
    Object.assign(doc, totals);
  }

  pushTimeline(doc, {
    eventType: 'updated',
    title: 'Invoice Updated',
    userId: actor.id,
    userName: actor.name,
    ipAddress,
  });
  await doc.save();
  await writeArAudit({
    entityType: 'invoice',
    entityId: String(doc._id),
    action: 'invoice_updated',
    description: 'Invoice updated',
    previousValue: prev,
    newValue: formatInvoice(doc, location?.name),
    actor,
    ipAddress,
  });
  return { invoice: formatInvoice(doc, location?.name || '') };
}

export async function approveInvoice(actor, id, ipAddress = '') {
  assertCanManageAr(actor);
  const doc = await ArInvoice.findOne({ _id: id, isDeleted: { $ne: true } });
  if (!doc) throw new AppError('Invoice not found', 404);
  if (!['draft', 'pending_approval'].includes(doc.status)) {
    throw new AppError('Only draft/pending invoices can be approved', 409);
  }
  if (!doc.invoiceNumber) {
    doc.invoiceNumber = await nextInvoiceNumber();
  }
  doc.status = 'sent';
  doc.approvedBy = actor.id;
  pushTimeline(doc, {
    eventType: 'approved',
    title: 'Invoice Approved',
    userId: actor.id,
    userName: actor.name,
    ipAddress,
  });
  await doc.save();
  return getInvoice(actor, id);
}

export async function sendInvoice(actor, id, ipAddress = '') {
  assertCanManageAr(actor);
  const doc = await ArInvoice.findOne({ _id: id, isDeleted: { $ne: true } });
  if (!doc) throw new AppError('Invoice not found', 404);
  if (['void', 'cancelled'].includes(doc.status)) {
    throw new AppError('Cannot send a void/cancelled invoice', 409);
  }
  if (!doc.invoiceNumber) doc.invoiceNumber = await nextInvoiceNumber();

  const publicToken = await ensurePublicPaymentToken(doc);

  const location = await Location.findById(doc.locationId).lean();
  const profile = await ArBillingProfile.findOne({ locationId: doc.locationId }).lean();

  const sent = await sendInvoiceEmail({
    invoice: doc,
    location,
    profile,
    kind: 'sent',
    publicToken,
  });

  doc.sentAt = new Date();
  if (!['partially_paid', 'paid', 'overdue'].includes(doc.status)) {
    doc.status = 'sent';
  }
  pushTimeline(doc, {
    eventType: 'sent',
    title: 'Invoice Sent',
    description: sent ? 'Email delivered' : 'Email attempted (check mail config)',
    userId: actor.id,
    userName: actor.name,
    ipAddress,
  });
  await doc.save();
  await writeArAudit({
    entityType: 'invoice',
    entityId: String(doc._id),
    action: 'invoice_sent',
    description: `Invoice ${doc.invoiceNumber} sent`,
    actor,
    ipAddress,
  });
  return getInvoice(actor, id);
}

export async function markInvoiceViewed(actor, id) {
  assertCanViewAr(actor);
  const doc = await ArInvoice.findOne({ _id: id, isDeleted: { $ne: true } });
  if (!doc) throw new AppError('Invoice not found', 404);
  assertCanAccessLocation(actor, doc.locationId);
  if (!doc.viewedAt) {
    doc.viewedAt = new Date();
    if (doc.status === 'sent') doc.status = 'viewed';
    pushTimeline(doc, {
      eventType: 'viewed',
      title: 'Invoice Viewed',
      userId: actor.id,
      userName: actor.name,
    });
    await doc.save();
  }
  return getInvoice(actor, id);
}

export async function duplicateInvoice(actor, id, ipAddress = '') {
  assertCanManageAr(actor);
  const src = await ArInvoice.findOne({ _id: id, isDeleted: { $ne: true } }).lean();
  if (!src) throw new AppError('Invoice not found', 404);
  return createInvoice(
    actor,
    {
      locationId: String(src.locationId),
      items: src.items,
      notes: src.notes,
      discountAmount: src.discountAmount,
      status: 'draft',
    },
    ipAddress,
  );
}

export async function cancelInvoice(actor, id, ipAddress = '') {
  assertCanManageAr(actor);
  const doc = await ArInvoice.findOne({ _id: id, isDeleted: { $ne: true } });
  if (!doc) throw new AppError('Invoice not found', 404);
  doc.status = 'cancelled';
  pushTimeline(doc, {
    eventType: 'cancelled',
    title: 'Invoice Cancelled',
    userId: actor.id,
    userName: actor.name,
    ipAddress,
  });
  await doc.save();
  return getInvoice(actor, id);
}

export async function voidInvoice(actor, id, ipAddress = '') {
  assertCanManageAr(actor);
  const doc = await ArInvoice.findOne({ _id: id, isDeleted: { $ne: true } });
  if (!doc) throw new AppError('Invoice not found', 404);
  doc.status = 'void';
  pushTimeline(doc, {
    eventType: 'void',
    title: 'Invoice Voided',
    userId: actor.id,
    userName: actor.name,
    ipAddress,
  });
  await doc.save();
  return getInvoice(actor, id);
}

export async function deleteInvoice(actor, id, ipAddress = '') {
  assertCanManageAr(actor);
  const doc = await ArInvoice.findOne({ _id: id, isDeleted: { $ne: true } });
  if (!doc) throw new AppError('Invoice not found', 404);
  if (!['draft', 'cancelled', 'void'].includes(doc.status)) {
    throw new AppError('Only draft/cancelled/void invoices can be deleted', 409);
  }
  doc.isDeleted = true;
  await doc.save();
  await writeArAudit({
    entityType: 'invoice',
    entityId: String(doc._id),
    action: 'invoice_deleted',
    description: 'Invoice soft-deleted',
    actor,
    ipAddress,
  });
  return { ok: true };
}

export async function refreshInvoiceBalances(invoiceId) {
  const doc = await ArInvoice.findById(invoiceId);
  if (!doc || doc.isDeleted) return null;
  const payments = await ArPayment.find({
    invoiceId,
    isDeleted: { $ne: true },
  }).lean();
  const amountPaid = money(payments.reduce((s, p) => s + Number(p.amount), 0));
  doc.amountPaid = amountPaid;
  const totals = recalculateTotals(doc);
  Object.assign(doc, totals);
  doc.status = deriveStatus(doc);
  if (doc.status === 'paid' && !doc.paidAt) doc.paidAt = new Date();
  await doc.save();
  return doc;
}

export async function getInvoicePdf(actor, id) {
  assertCanViewAr(actor);
  const doc = await ArInvoice.findOne({ _id: id, isDeleted: { $ne: true } });
  if (!doc) throw new AppError('Invoice not found', 404);
  assertCanAccessLocation(actor, doc.locationId);
  const location = await Location.findById(doc.locationId).lean();
  const profile = await ArBillingProfile.findOne({ locationId: doc.locationId }).lean();
  const buffer = await generateInvoicePdfBuffer(doc, location, profile);
  return {
    buffer,
    filename: `${doc.invoiceNumber || 'draft'}.pdf`,
  };
}

export { formatInvoice, pushTimeline, deriveStatus };
