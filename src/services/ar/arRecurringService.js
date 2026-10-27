import ArRecurringTemplate from '../../models/ArRecurringTemplate.js';
import Location from '../../models/Location.js';
import { AppError } from '../../utils/AppError.js';
import {
  assertCanManageAr,
  assertCanViewAr,
  locationScopeFilter,
  parseListQuery,
  money,
} from './arAccess.js';
import { writeArAudit } from './arAuditService.js';
import ArInvoice from '../../models/ArInvoice.js';
import {
  sendInvoice,
  nextInvoiceNumber,
  recalculateTotals,
  pushTimeline,
} from './arInvoiceService.js';
import { AR_FREQUENCIES } from '../../constants/arConstants.js';

function addFrequency(date, frequency, customDays) {
  const d = new Date(date);
  switch (frequency) {
    case 'weekly':
      d.setDate(d.getDate() + 7);
      break;
    case 'biweekly':
      d.setDate(d.getDate() + 14);
      break;
    case 'monthly':
      d.setMonth(d.getMonth() + 1);
      break;
    case 'quarterly':
      d.setMonth(d.getMonth() + 3);
      break;
    case 'semi_annual':
      d.setMonth(d.getMonth() + 6);
      break;
    case 'annual':
      d.setFullYear(d.getFullYear() + 1);
      break;
    case 'custom':
      d.setDate(d.getDate() + (Number(customDays) || 30));
      break;
    default:
      d.setMonth(d.getMonth() + 1);
  }
  return d;
}

function formatTemplate(doc, locationName = '') {
  const d = doc.toObject ? doc.toObject() : doc;
  return {
    id: String(d._id),
    name: d.name,
    locationId: String(d.locationId),
    locationName,
    items: d.items || [],
    frequency: d.frequency,
    customIntervalDays: d.customIntervalDays,
    startDate: d.startDate,
    endDate: d.endDate,
    nextRunDate: d.nextRunDate,
    dueAfterDays: d.dueAfterDays,
    autoGenerate: d.autoGenerate,
    autoSend: d.autoSend,
    reminderDays: d.reminderDays || [],
    lateFeeEnabled: d.lateFeeEnabled,
    lateFeeType: d.lateFeeType,
    lateFeeAmount: d.lateFeeAmount,
    notes: d.notes,
    isActive: d.isActive,
    lastGeneratedAt: d.lastGeneratedAt,
    createdAt: d.createdAt,
  };
}

export async function listRecurring(actor, query) {
  assertCanViewAr(actor);
  const { page, pageSize, sort, order, search, skip } = parseListQuery(query, {
    defaultSort: 'nextRunDate',
  });
  const filter = { isDeleted: { $ne: true }, ...locationScopeFilter(actor, query.locationId) };
  if (query.active === 'true') filter.isActive = true;
  if (search) filter.name = new RegExp(search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');

  const [items, total] = await Promise.all([
    ArRecurringTemplate.find(filter).sort({ [sort]: order }).skip(skip).limit(pageSize).lean(),
    ArRecurringTemplate.countDocuments(filter),
  ]);
  const locs = await Location.find({
    _id: { $in: items.map((i) => i.locationId) },
  }).lean();
  const map = new Map(locs.map((l) => [String(l._id), l.name]));

  return {
    templates: items.map((i) => formatTemplate(i, map.get(String(i.locationId)) || '')),
    total,
    page,
    pageSize,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
  };
}

export async function createRecurring(actor, input, ipAddress = '') {
  assertCanManageAr(actor);
  if (!input.locationId || !input.name || !input.frequency) {
    throw new AppError('name, locationId, and frequency are required', 400);
  }
  if (!AR_FREQUENCIES.includes(input.frequency)) {
    throw new AppError('Invalid frequency', 400);
  }
  const startDate = input.startDate ? new Date(input.startDate) : new Date();
  const doc = await ArRecurringTemplate.create({
    name: String(input.name).trim(),
    locationId: input.locationId,
    items: (input.items || []).map((i) => ({
      ...i,
      unitPrice: money(i.unitPrice),
      quantity: Number(i.quantity) || 1,
    })),
    frequency: input.frequency,
    customIntervalDays: input.customIntervalDays || null,
    startDate,
    endDate: input.endDate ? new Date(input.endDate) : null,
    nextRunDate: input.nextRunDate ? new Date(input.nextRunDate) : startDate,
    dueAfterDays: Number(input.dueAfterDays) || 15,
    autoGenerate: input.autoGenerate !== false,
    autoSend: input.autoSend !== false,
    reminderDays: input.reminderDays || [],
    lateFeeEnabled: Boolean(input.lateFeeEnabled),
    lateFeeType: input.lateFeeType || 'fixed',
    lateFeeAmount: money(input.lateFeeAmount),
    notes: input.notes || '',
    createdBy: actor.id,
  });
  await writeArAudit({
    entityType: 'recurring_template',
    entityId: String(doc._id),
    action: 'recurring_created',
    description: `Recurring template created: ${doc.name}`,
    actor,
    ipAddress,
  });
  return { template: formatTemplate(doc) };
}

export async function updateRecurring(actor, id, patch, ipAddress = '') {
  assertCanManageAr(actor);
  const doc = await ArRecurringTemplate.findOne({ _id: id, isDeleted: { $ne: true } });
  if (!doc) throw new AppError('Template not found', 404);
  const fields = [
    'name',
    'items',
    'frequency',
    'customIntervalDays',
    'startDate',
    'endDate',
    'nextRunDate',
    'dueAfterDays',
    'autoGenerate',
    'autoSend',
    'reminderDays',
    'lateFeeEnabled',
    'lateFeeType',
    'lateFeeAmount',
    'notes',
    'isActive',
  ];
  for (const key of fields) {
    if (patch[key] !== undefined) doc[key] = patch[key];
  }
  await doc.save();
  await writeArAudit({
    entityType: 'recurring_template',
    entityId: String(doc._id),
    action: 'recurring_updated',
    description: `Recurring template updated: ${doc.name}`,
    actor,
    ipAddress,
  });
  return { template: formatTemplate(doc) };
}

export async function deleteRecurring(actor, id, ipAddress = '') {
  assertCanManageAr(actor);
  const doc = await ArRecurringTemplate.findOne({ _id: id, isDeleted: { $ne: true } });
  if (!doc) throw new AppError('Template not found', 404);
  doc.isDeleted = true;
  doc.isActive = false;
  await doc.save();
  await writeArAudit({
    entityType: 'recurring_template',
    entityId: String(doc._id),
    action: 'recurring_deleted',
    description: `Recurring template deleted: ${doc.name}`,
    actor,
    ipAddress,
  });
  return { ok: true };
}

/** Generate invoice from a recurring template (used by cron + manual run). */
export async function generateFromTemplate(template, systemActor = { id: null, name: 'System', role: 'admin' }) {
  const invoiceDate = new Date();
  const dueDate = new Date(invoiceDate);
  dueDate.setDate(dueDate.getDate() + (template.dueAfterDays || 15));

  const totals = recalculateTotals({
    items: template.items || [],
    discountAmount: 0,
    lateFeeAmount: 0,
    creditApplied: 0,
    amountPaid: 0,
  });

  const invoiceNumber = await nextInvoiceNumber();
  const doc = new ArInvoice({
    invoiceNumber,
    locationId: template.locationId,
    recurringTemplateId: template._id,
    status: 'sent',
    invoiceDate,
    dueDate,
    notes: template.notes || '',
    ...totals,
    createdBy: systemActor.id,
  });
  pushTimeline(doc, {
    eventType: 'created',
    title: 'Invoice Generated',
    description: `From recurring template: ${template.name}`,
    userName: systemActor.name || 'System',
  });
  await doc.save();

  template.lastGeneratedAt = new Date();
  template.nextRunDate = addFrequency(
    template.nextRunDate || invoiceDate,
    template.frequency,
    template.customIntervalDays,
  );
  await template.save();

  if (template.autoSend) {
    await sendInvoice(systemActor, String(doc._id));
  }

  return doc;
}

export { addFrequency };
