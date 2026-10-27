import ArCredit from '../../models/ArCredit.js';
import ArInvoice from '../../models/ArInvoice.js';
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
import { recalculateTotals, pushTimeline, refreshInvoiceBalances } from './arInvoiceService.js';

function formatCredit(doc) {
  const d = doc.toObject ? doc.toObject() : doc;
  return {
    id: String(d._id),
    locationId: String(d.locationId),
    invoiceId: d.invoiceId ? String(d.invoiceId) : null,
    type: d.type,
    amount: d.amount,
    remainingAmount: d.remainingAmount,
    reason: d.reason,
    creditDate: d.creditDate,
    createdAt: d.createdAt,
  };
}

export async function listCredits(actor, query) {
  assertCanViewAr(actor);
  const { page, pageSize, sort, order, skip } = parseListQuery(query, {
    defaultSort: 'creditDate',
  });
  const filter = { isDeleted: { $ne: true }, ...locationScopeFilter(actor, query.locationId) };
  const [items, total] = await Promise.all([
    ArCredit.find(filter).sort({ [sort]: order }).skip(skip).limit(pageSize).lean(),
    ArCredit.countDocuments(filter),
  ]);
  return {
    credits: items.map(formatCredit),
    total,
    page,
    pageSize,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
  };
}

export async function createCredit(actor, input, ipAddress = '') {
  assertCanManageAr(actor);
  if (!input.locationId) throw new AppError('locationId is required', 400);
  const amount = money(input.amount);
  if (amount <= 0) throw new AppError('Amount must be greater than zero', 400);

  const credit = await ArCredit.create({
    locationId: input.locationId,
    invoiceId: input.invoiceId || null,
    type: input.type || 'credit_note',
    amount,
    remainingAmount: amount,
    reason: String(input.reason || '').trim(),
    creditDate: input.creditDate ? new Date(input.creditDate) : new Date(),
    createdBy: actor.id,
  });

  if (input.invoiceId && input.applyNow !== false) {
    await applyCreditToInvoice(actor, credit._id, input.invoiceId, amount, ipAddress);
  }

  await writeArAudit({
    entityType: 'credit',
    entityId: String(credit._id),
    action: 'credit_created',
    description: `Credit created: $${amount}`,
    newValue: formatCredit(credit),
    actor,
    ipAddress,
  });

  return { credit: formatCredit(await ArCredit.findById(credit._id)) };
}

export async function applyCreditToInvoice(actor, creditId, invoiceId, amount, ipAddress = '') {
  assertCanManageAr(actor);
  const credit = await ArCredit.findOne({ _id: creditId, isDeleted: { $ne: true } });
  if (!credit) throw new AppError('Credit not found', 404);
  const invoice = await ArInvoice.findOne({ _id: invoiceId, isDeleted: { $ne: true } });
  if (!invoice) throw new AppError('Invoice not found', 404);
  if (String(credit.locationId) !== String(invoice.locationId)) {
    throw new AppError('Credit and invoice must belong to the same partner', 400);
  }

  const applyAmt = money(Math.min(amount || credit.remainingAmount, credit.remainingAmount, invoice.balanceDue));
  if (applyAmt <= 0) throw new AppError('Nothing to apply', 400);

  credit.remainingAmount = money(credit.remainingAmount - applyAmt);
  await credit.save();

  invoice.creditApplied = money(invoice.creditApplied + applyAmt);
  const totals = recalculateTotals(invoice);
  Object.assign(invoice, totals);
  pushTimeline(invoice, {
    eventType: 'credit_applied',
    title: 'Credit Applied',
    description: `$${applyAmt.toFixed(2)} credit applied`,
    userId: actor.id,
    userName: actor.name,
    ipAddress,
  });
  await invoice.save();
  await refreshInvoiceBalances(invoice._id);

  return { credit: formatCredit(credit), applied: applyAmt };
}
