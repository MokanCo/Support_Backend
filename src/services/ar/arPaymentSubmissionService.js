import ArPaymentSubmission from '../../models/ArPaymentSubmission.js';
import ArInvoice from '../../models/ArInvoice.js';
import Location from '../../models/Location.js';
import User from '../../models/User.js';
import { AppError } from '../../utils/AppError.js';
import { assertCanRecordPayments, money, toObjectId } from './arAccess.js';
import { getInvoice } from './arInvoiceService.js';
import { recordPayment } from './arPaymentService.js';
import { writeArAudit } from './arAuditService.js';
import { createArPaymentSubmittedAdminNotification } from '../notificationService.js';

function formatSubmission(doc, extra = {}) {
  const d = doc.toObject ? doc.toObject() : doc;
  return {
    id: String(d._id),
    invoiceId: String(d.invoiceId),
    locationId: String(d.locationId),
    submittedBy: d.submittedBy ? String(d.submittedBy) : null,
    amount: d.amount,
    paymentMethod: d.paymentMethod,
    paymentDate: d.paymentDate,
    transactionReference: d.transactionReference,
    notes: d.notes,
    proofUrl: d.proofUrl || '',
    source: d.source || 'partner_portal',
    status: d.status,
    reviewedBy: d.reviewedBy ? String(d.reviewedBy) : null,
    reviewedAt: d.reviewedAt,
    reviewNote: d.reviewNote,
    resultingPaymentId: d.resultingPaymentId ? String(d.resultingPaymentId) : null,
    createdAt: d.createdAt,
    ...extra,
  };
}

/**
 * A partner reporting "I sent $X via method Y for this invoice" — pure
 * self-reported intent. Nothing here touches the invoice's balance/status;
 * that only happens if/when an admin approves it (reviewSubmission below).
 */
export async function submitPayment(actor, invoiceId, { amount, paymentMethod, transactionReference, notes, paymentDate } = {}) {
  const { invoice } = await getInvoice(actor, invoiceId); // throws if not found / not accessible

  const numericAmount = money(amount);
  if (numericAmount <= 0) {
    throw new AppError('A valid amount is required', 400);
  }
  if (!paymentMethod || typeof paymentMethod !== 'string') {
    throw new AppError('A payment method is required', 400);
  }

  const pending = await ArPaymentSubmission.findOne({
    invoiceId: toObjectId(invoice.id, 'invoiceId'),
    status: 'pending',
  }).lean();
  if (pending) {
    throw new AppError(
      'A payment confirmation is already pending verification for this invoice',
      409,
    );
  }

  const doc = await ArPaymentSubmission.create({
    invoiceId: toObjectId(invoice.id, 'invoiceId'),
    locationId: toObjectId(invoice.locationId, 'locationId'),
    submittedBy: actor.id,
    amount: numericAmount,
    paymentMethod,
    paymentDate: paymentDate ? new Date(paymentDate) : new Date(),
    transactionReference: String(transactionReference || '').trim(),
    notes: String(notes || '').trim(),
    source: 'partner_portal',
  });

  await createArPaymentSubmittedAdminNotification({
    submissionId: doc.id,
    invoiceId: invoice.id,
    invoiceNumber: invoice.invoiceNumber,
    amount: numericAmount,
    method: paymentMethod,
    locationName: invoice.locationName || 'Unknown location',
    partnerName: actor.name || actor.email || 'A partner',
  });

  await writeArAudit({
    entityType: 'payment_submission',
    entityId: doc.id,
    action: 'payment_submission_created',
    description: `Partner reported sending $${numericAmount.toFixed(2)} via ${paymentMethod} for ${invoice.invoiceNumber}`,
    newValue: formatSubmission(doc),
    actor,
  });

  return { submission: formatSubmission(doc, { invoiceNumber: invoice.invoiceNumber }) };
}

export async function listSubmissions(actor, { status = 'pending' } = {}) {
  if (!['admin', 'support'].includes(actor?.role)) {
    throw new AppError('Access denied', 403);
  }
  const filter = {};
  if (status && status !== 'all') filter.status = status;

  const rows = await ArPaymentSubmission.find(filter).sort({ createdAt: -1 }).limit(200).lean();
  if (!rows.length) return { submissions: [] };

  const invoiceIds = [...new Set(rows.map((r) => String(r.invoiceId)).filter(Boolean))];
  const locationIds = [...new Set(rows.map((r) => String(r.locationId)).filter(Boolean))];
  // Public invoice submissions have submittedBy: null — never String(null) → "null"
  const submitterIds = [
    ...new Set(
      rows
        .map((r) => r.submittedBy)
        .filter((id) => id != null && id !== '')
        .map((id) => String(id)),
    ),
  ];

  const [invoices, locations, submitters] = await Promise.all([
    invoiceIds.length
      ? ArInvoice.find({ _id: { $in: invoiceIds } }).select('invoiceNumber').lean()
      : Promise.resolve([]),
    locationIds.length
      ? Location.find({ _id: { $in: locationIds } }).select('name').lean()
      : Promise.resolve([]),
    submitterIds.length
      ? User.find({ _id: { $in: submitterIds } }).select('name email').lean()
      : Promise.resolve([]),
  ]);

  const invoiceMap = new Map(invoices.map((i) => [String(i._id), i.invoiceNumber || '']));
  const locationMap = new Map(locations.map((l) => [String(l._id), l.name || '']));
  const submitterMap = new Map(submitters.map((u) => [String(u._id), u.name || u.email || '']));

  return {
    submissions: rows.map((r) =>
      formatSubmission(r, {
        invoiceNumber: invoiceMap.get(String(r.invoiceId)) || '',
        locationName: locationMap.get(String(r.locationId)) || '',
        submittedByName: submitterMap.get(String(r.submittedBy)) || '',
      }),
    ),
  };
}

export async function reviewSubmission(actor, id, { decision, note } = {}) {
  assertCanRecordPayments(actor); // admin-only, same gate as recording a real payment
  if (!['approve', 'reject'].includes(decision)) {
    throw new AppError('decision must be approve or reject', 400);
  }

  const doc = await ArPaymentSubmission.findById(id);
  if (!doc) throw new AppError('Submission not found', 404);
  if (doc.status !== 'pending') {
    throw new AppError('This submission has already been reviewed', 409);
  }

  if (decision === 'reject') {
    doc.status = 'rejected';
    doc.reviewedBy = actor.id;
    doc.reviewedAt = new Date();
    doc.reviewNote = String(note || '').trim();
    await doc.save();

    await writeArAudit({
      entityType: 'payment_submission',
      entityId: doc.id,
      action: 'payment_submission_rejected',
      description: 'Payment submission rejected',
      actor,
    });
    return { submission: formatSubmission(doc) };
  }

  // Approve: reuse the existing, already-tested recordPayment flow rather
  // than re-implementing balance/status updates or the receipt email here.
  const verifiedLabel =
    doc.source === 'public_invoice'
      ? 'Public invoice confirmation, admin-verified'
      : 'Partner-reported, admin-verified';
  const { payment } = await recordPayment(actor, {
    invoiceId: String(doc.invoiceId),
    amount: doc.amount,
    paymentDate: doc.paymentDate,
    paymentMethod: doc.paymentMethod,
    transactionReference: doc.transactionReference,
    notes: doc.notes ? `${doc.notes} (${verifiedLabel})` : verifiedLabel,
  });

  doc.status = 'approved';
  doc.reviewedBy = actor.id;
  doc.reviewedAt = new Date();
  doc.reviewNote = String(note || '').trim();
  doc.resultingPaymentId = toObjectId(payment.id, 'paymentId');
  await doc.save();

  await writeArAudit({
    entityType: 'payment_submission',
    entityId: doc.id,
    action: 'payment_submission_approved',
    description: `Approved and recorded as payment ${payment.id}`,
    actor,
  });

  return { submission: formatSubmission(doc) };
}
