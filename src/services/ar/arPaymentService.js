import mongoose from 'mongoose';
import ArPayment from '../../models/ArPayment.js';
import ArInvoice from '../../models/ArInvoice.js';
import Location from '../../models/Location.js';
import ArBillingProfile from '../../models/ArBillingProfile.js';
import { AppError } from '../../utils/AppError.js';
import {
  assertCanRecordPayments,
  assertCanViewAr,
  locationScopeFilter,
  optionalObjectId,
  parseListQuery,
  toObjectId,
  money,
} from './arAccess.js';
import { writeArAudit } from './arAuditService.js';
import { refreshInvoiceBalances, pushTimeline } from './arInvoiceService.js';
import { sendInvoiceEmail } from './arMailService.js';

function formatPayment(doc, { invoiceNumber = '', locationName = '' } = {}) {
  const d = doc.toObject ? doc.toObject() : doc;
  return {
    id: String(d._id),
    invoiceId: String(d.invoiceId),
    invoiceNumber,
    locationId: String(d.locationId),
    locationName,
    paymentDate: d.paymentDate,
    amount: d.amount,
    originalAmount: d.originalAmount ?? d.amount,
    stripeProcessingFee: d.stripeProcessingFee || 0,
    stripeChargeAmount: d.stripeChargeAmount ?? d.amount,
    currency: d.currency || 'USD',
    paymentMethod: d.paymentMethod,
    paymentStatus: d.paymentStatus || 'paid',
    transactionReference: d.transactionReference,
    stripePaymentIntentId: d.stripePaymentIntentId || '',
    stripeCheckoutSessionId: d.stripeCheckoutSessionId || '',
    notes: d.notes,
    attachmentUrl: d.attachmentUrl,
    recordedBy: d.recordedBy ? String(d.recordedBy) : null,
    createdAt: d.createdAt,
  };
}

export async function listPayments(actor, query) {
  assertCanViewAr(actor);
  const { page, pageSize, sort, order, skip } = parseListQuery(query, {
    defaultSort: 'paymentDate',
  });
  const filter = { isDeleted: { $ne: true }, ...locationScopeFilter(actor, query.locationId) };
  if (query.includeFailed !== 'true') {
    filter.paymentStatus = { $nin: ['failed', 'pending'] };
  }
  const invoiceId = optionalObjectId(query.invoiceId, 'invoiceId');
  if (invoiceId) filter.invoiceId = invoiceId;

  const [items, total] = await Promise.all([
    ArPayment.find(filter).sort({ [sort]: order }).skip(skip).limit(pageSize).lean(),
    ArPayment.countDocuments(filter),
  ]);

  const invoiceIds = [...new Set(items.map((p) => String(p.invoiceId)))];
  const locationIds = [...new Set(items.map((p) => String(p.locationId)))];
  const [invoices, locations] = await Promise.all([
    ArInvoice.find({ _id: { $in: invoiceIds } }).select('invoiceNumber').lean(),
    Location.find({ _id: { $in: locationIds } }).select('name').lean(),
  ]);
  const invoiceMap = new Map(invoices.map((i) => [String(i._id), i.invoiceNumber || '']));
  const locationMap = new Map(locations.map((l) => [String(l._id), l.name || '']));

  return {
    payments: items.map((p) =>
      formatPayment(p, {
        invoiceNumber: invoiceMap.get(String(p.invoiceId)) || '',
        locationName: locationMap.get(String(p.locationId)) || '',
      }),
    ),
    total,
    page,
    pageSize,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
  };
}

/** Accepts a Mongo id or a human invoice number (e.g. INV-2026-000001). */
async function findInvoiceByIdOrNumber(rawValue) {
  const value = String(rawValue ?? '').trim();
  if (!value) throw new AppError('invoiceId is required', 400);

  const asObjectId = mongoose.Types.ObjectId.isValid(value)
    ? new mongoose.Types.ObjectId(value)
    : null;

  const invoice = await ArInvoice.findOne({
    isDeleted: { $ne: true },
    ...(asObjectId ? { _id: asObjectId } : { invoiceNumber: value }),
  });

  if (!invoice) {
    throw new AppError(`Invoice not found for "${value}"`, 404);
  }
  return invoice;
}

export async function recordPayment(actor, input, ipAddress = '') {
  assertCanRecordPayments(actor);
  const invoice = await findInvoiceByIdOrNumber(input.invoiceId);
  if (['void', 'cancelled', 'draft'].includes(invoice.status)) {
    throw new AppError('Cannot record payment on this invoice status', 409);
  }

  const amount = money(input.amount);
  if (amount <= 0) throw new AppError('Amount must be greater than zero', 400);

  const paymentStatus = input.paymentStatus || 'paid';
  const payment = await ArPayment.create({
    invoiceId: invoice._id,
    locationId: invoice.locationId,
    paymentDate: input.paymentDate ? new Date(input.paymentDate) : new Date(),
    amount,
    originalAmount: input.originalAmount != null ? money(input.originalAmount) : amount,
    stripeProcessingFee: money(input.stripeProcessingFee || 0),
    stripeChargeAmount:
      input.stripeChargeAmount != null ? money(input.stripeChargeAmount) : amount,
    currency: String(input.currency || invoice.currency || 'USD').toUpperCase(),
    paymentMethod: input.paymentMethod || 'zelle',
    paymentStatus,
    transactionReference: String(input.transactionReference || '').trim(),
    stripePaymentIntentId: String(input.stripePaymentIntentId || '').trim(),
    stripeCheckoutSessionId: String(input.stripeCheckoutSessionId || '').trim(),
    notes: String(input.notes || '').trim(),
    attachmentUrl: String(input.attachmentUrl || '').trim(),
    recordedBy: actor.id,
  });

  if (paymentStatus === 'failed') {
    const location = await Location.findById(invoice.locationId).lean();
    const formatted = formatPayment(payment, {
      invoiceNumber: invoice.invoiceNumber || '',
      locationName: location?.name || '',
    });
    return { payment: formatted, invoiceId: String(invoice._id) };
  }

  const updated = await refreshInvoiceBalances(invoice._id);
  pushTimeline(updated, {
    eventType: 'payment_recorded',
    title: 'Payment Recorded',
    description: `$${amount.toFixed(2)} via ${payment.paymentMethod}`,
    userId: actor.id,
    userName: actor.name,
    ipAddress,
  });
  await updated.save();

  const location = await Location.findById(invoice.locationId).lean();
  const profile = await ArBillingProfile.findOne({ locationId: invoice.locationId }).lean();
  await sendInvoiceEmail({
    invoice: updated,
    location,
    profile,
    kind: 'receipt',
  });

  const formatted = formatPayment(payment, {
    invoiceNumber: updated.invoiceNumber || '',
    locationName: location?.name || '',
  });

  await writeArAudit({
    entityType: 'payment',
    entityId: String(payment._id),
    action: 'payment_recorded',
    description: `Payment of $${amount} on ${updated.invoiceNumber}`,
    newValue: formatted,
    actor,
    ipAddress,
  });

  return { payment: formatted, invoiceId: String(updated._id) };
}

export async function deletePayment(actor, id, ipAddress = '') {
  assertCanRecordPayments(actor);
  const payment = await ArPayment.findOne({
    _id: toObjectId(id, 'payment id'),
    isDeleted: { $ne: true },
  });
  if (!payment) throw new AppError('Payment not found', 404);
  payment.isDeleted = true;
  await payment.save();
  await refreshInvoiceBalances(payment.invoiceId);
  await writeArAudit({
    entityType: 'payment',
    entityId: String(payment._id),
    action: 'payment_deleted',
    description: 'Payment soft-deleted',
    actor,
    ipAddress,
  });
  return { ok: true };
}
