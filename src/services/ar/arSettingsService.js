import ArSettings from '../../models/ArSettings.js';
import { assertCanManageAr, assertCanViewAr } from './arAccess.js';
import { writeArAudit } from './arAuditService.js';
import { AR_DEFAULT_REMINDER_DAYS } from '../../constants/arConstants.js';

function formatSettings(doc) {
  const d = doc.toObject ? doc.toObject() : doc;
  return {
    id: String(d._id),
    invoiceNumberPrefix: d.invoiceNumberPrefix,
    invoiceNumberIncludeYear: d.invoiceNumberIncludeYear,
    invoiceNumberPadding: d.invoiceNumberPadding,
    defaultCurrency: d.defaultCurrency,
    defaultPaymentTermsDays: d.defaultPaymentTermsDays,
    defaultGracePeriodDays: d.defaultGracePeriodDays,
    defaultReminderDays: d.defaultReminderDays || [...AR_DEFAULT_REMINDER_DAYS],
    lateFeeEnabled: d.lateFeeEnabled,
    lateFeeType: d.lateFeeType,
    lateFeeAmount: d.lateFeeAmount,
    companyName: d.companyName,
    companyAddress: d.companyAddress,
    companyPhone: d.companyPhone,
    billingEmail: d.billingEmail,
    supportEmail: d.supportEmail,
    defaultNotes: d.defaultNotes,
    paymentInstructions: d.paymentInstructions,
    paymentMethods: (d.paymentMethods || []).map((m) => ({
      id: m._id ? String(m._id) : undefined,
      type: m.type,
      label: m.label,
      details: m.details,
      displayName: m.displayName || '',
      recipientEmail: m.recipientEmail || '',
      recipientPhone: m.recipientPhone || '',
      qrCodeUrl: m.qrCodeUrl || '',
      enabled: m.enabled !== false,
    })),
    termsAndConditions: d.termsAndConditions,
    logoUrl: d.logoUrl,
    updatedAt: d.updatedAt,
  };
}

export async function getOrCreateSettings() {
  let doc = await ArSettings.findOne({ key: 'default' });
  if (!doc) {
    doc = await ArSettings.create({ key: 'default' });
  }
  return doc;
}

export async function getSettings(actor) {
  assertCanViewAr(actor);
  const doc = await getOrCreateSettings();
  return { settings: formatSettings(doc) };
}

export async function updateSettings(actor, patch, ipAddress = '') {
  assertCanManageAr(actor);
  const doc = await getOrCreateSettings();
  const prev = formatSettings(doc);
  const fields = [
    'invoiceNumberPrefix',
    'invoiceNumberIncludeYear',
    'invoiceNumberPadding',
    'defaultCurrency',
    'defaultPaymentTermsDays',
    'defaultGracePeriodDays',
    'defaultReminderDays',
    'lateFeeEnabled',
    'lateFeeType',
    'lateFeeAmount',
    'companyName',
    'companyAddress',
    'companyPhone',
    'billingEmail',
    'supportEmail',
    'defaultNotes',
    'paymentInstructions',
    'paymentMethods',
    'termsAndConditions',
    'logoUrl',
  ];
  for (const key of fields) {
    if (patch[key] !== undefined) doc[key] = patch[key];
  }
  await doc.save();
  const next = formatSettings(doc);
  await writeArAudit({
    entityType: 'settings',
    entityId: String(doc._id),
    action: 'settings_updated',
    description: 'AR settings updated',
    previousValue: prev,
    newValue: next,
    actor,
    ipAddress,
  });
  return { settings: next };
}
