import ArStatement from '../../models/ArStatement.js';
import ArInvoice from '../../models/ArInvoice.js';
import ArPayment from '../../models/ArPayment.js';
import ArCredit from '../../models/ArCredit.js';
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
import { sendInvoiceEmail } from './arMailService.js';

function formatStatement(doc, locationName = '') {
  const d = doc.toObject ? doc.toObject() : doc;
  return {
    id: String(d._id),
    locationId: String(d.locationId),
    locationName,
    periodStart: d.periodStart,
    periodEnd: d.periodEnd,
    openingBalance: d.openingBalance,
    closingBalance: d.closingBalance,
    lines: d.lines || [],
    emailedAt: d.emailedAt,
    createdAt: d.createdAt,
  };
}

export async function listStatements(actor, query) {
  assertCanViewAr(actor);
  const { page, pageSize, sort, order, skip } = parseListQuery(query);
  const filter = { isDeleted: { $ne: true }, ...locationScopeFilter(actor, query.locationId) };
  const [items, total] = await Promise.all([
    ArStatement.find(filter).sort({ [sort]: order }).skip(skip).limit(pageSize).lean(),
    ArStatement.countDocuments(filter),
  ]);
  const locs = await Location.find({ _id: { $in: items.map((i) => i.locationId) } }).lean();
  const map = new Map(locs.map((l) => [String(l._id), l.name]));
  return {
    statements: items.map((i) => formatStatement(i, map.get(String(i.locationId)) || '')),
    total,
    page,
    pageSize,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
  };
}

export async function generateStatement(actor, { locationId, periodStart, periodEnd }, ipAddress = '') {
  assertCanManageAr(actor);
  if (!locationId || !periodStart || !periodEnd) {
    throw new AppError('locationId, periodStart, and periodEnd are required', 400);
  }
  const start = new Date(periodStart);
  const end = new Date(periodEnd);
  end.setHours(23, 59, 59, 999);

  const priorInvoices = await ArInvoice.find({
    locationId,
    isDeleted: { $ne: true },
    status: { $nin: ['draft', 'cancelled', 'void'] },
    invoiceDate: { $lt: start },
  }).lean();
  const priorPayments = await ArPayment.find({
    locationId,
    isDeleted: { $ne: true },
    paymentDate: { $lt: start },
  }).lean();
  const priorCredits = await ArCredit.find({
    locationId,
    isDeleted: { $ne: true },
    creditDate: { $lt: start },
  }).lean();

  let opening = 0;
  for (const i of priorInvoices) opening += Number(i.total) || 0;
  for (const p of priorPayments) opening -= Number(p.amount) || 0;
  for (const c of priorCredits) opening -= Number(c.amount) || 0;
  opening = money(opening);

  const invoices = await ArInvoice.find({
    locationId,
    isDeleted: { $ne: true },
    status: { $nin: ['draft', 'cancelled', 'void'] },
    invoiceDate: { $gte: start, $lte: end },
  }).lean();
  const payments = await ArPayment.find({
    locationId,
    isDeleted: { $ne: true },
    paymentDate: { $gte: start, $lte: end },
  }).lean();
  const credits = await ArCredit.find({
    locationId,
    isDeleted: { $ne: true },
    creditDate: { $gte: start, $lte: end },
  }).lean();

  const lines = [];
  let balance = opening;
  lines.push({
    date: start,
    type: 'opening',
    reference: '',
    description: 'Opening balance',
    amount: opening,
    balance,
  });

  const events = [
    ...invoices.map((i) => ({
      date: i.invoiceDate,
      type: 'invoice',
      reference: i.invoiceNumber,
      description: `Invoice ${i.invoiceNumber}`,
      amount: Number(i.total) || 0,
    })),
    ...payments.map((p) => ({
      date: p.paymentDate,
      type: 'payment',
      reference: p.transactionReference || '',
      description: 'Payment received',
      amount: -(Number(p.amount) || 0),
    })),
    ...credits.map((c) => ({
      date: c.creditDate,
      type: 'credit',
      reference: c.type,
      description: c.reason || 'Credit',
      amount: -(Number(c.amount) || 0),
    })),
  ].sort((a, b) => new Date(a.date) - new Date(b.date));

  for (const e of events) {
    balance = money(balance + e.amount);
    lines.push({ ...e, balance });
  }

  lines.push({
    date: end,
    type: 'closing',
    reference: '',
    description: 'Closing balance',
    amount: balance,
    balance,
  });

  const doc = await ArStatement.create({
    locationId,
    periodStart: start,
    periodEnd: end,
    openingBalance: opening,
    closingBalance: balance,
    lines,
    generatedBy: actor.id,
  });

  const location = await Location.findById(locationId).lean();
  await writeArAudit({
    entityType: 'statement',
    entityId: String(doc._id),
    action: 'statement_generated',
    description: `Statement generated for ${location?.name}`,
    actor,
    ipAddress,
  });

  return { statement: formatStatement(doc, location?.name || '') };
}

export async function emailStatement(actor, id, ipAddress = '') {
  assertCanManageAr(actor);
  const doc = await ArStatement.findOne({ _id: id, isDeleted: { $ne: true } });
  if (!doc) throw new AppError('Statement not found', 404);
  const location = await Location.findById(doc.locationId).lean();
  const profile = await ArBillingProfile.findOne({ locationId: doc.locationId }).lean();
  await sendInvoiceEmail({
    invoice: {
      invoiceNumber: `STMT-${doc.periodStart.toISOString().slice(0, 7)}`,
      total: doc.closingBalance,
      balanceDue: doc.closingBalance,
      dueDate: doc.periodEnd,
    },
    location,
    profile,
    kind: 'statement',
  });
  doc.emailedAt = new Date();
  await doc.save();
  await writeArAudit({
    entityType: 'statement',
    entityId: String(doc._id),
    action: 'statement_emailed',
    description: 'Statement emailed',
    actor,
    ipAddress,
  });
  return { statement: formatStatement(doc, location?.name || '') };
}
