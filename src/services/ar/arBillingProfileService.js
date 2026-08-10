import ArBillingProfile from '../../models/ArBillingProfile.js';
import Location from '../../models/Location.js';
import { AppError } from '../../utils/AppError.js';
import {
  assertCanManageAr,
  assertCanViewAr,
  assertCanAccessLocation,
  locationScopeFilter,
  parseListQuery,
} from './arAccess.js';
import { writeArAudit } from './arAuditService.js';
import { getOrCreateSettings } from './arSettingsService.js';

function formatProfile(doc, location = null) {
  const d = doc.toObject ? doc.toObject() : doc;
  return {
    id: String(d._id),
    locationId: String(d.locationId),
    locationName: location?.name || d.locationName || '',
    billingEmail: d.billingEmail,
    secondaryBillingEmail: d.secondaryBillingEmail,
    phone: d.phone,
    billingAddress: d.billingAddress || {},
    paymentTermsDays: d.paymentTermsDays,
    billingFrequency: d.billingFrequency,
    currency: d.currency,
    paymentMethod: d.paymentMethod,
    gracePeriodDays: d.gracePeriodDays,
    reminderDays: d.reminderDays || [],
    autoGenerateInvoice: d.autoGenerateInvoice,
    autoSendInvoice: d.autoSendInvoice,
    lateFeeEnabled: d.lateFeeEnabled,
    lateFeeType: d.lateFeeType,
    lateFeeAmount: d.lateFeeAmount,
    internalNotes: d.internalNotes,
    createdAt: d.createdAt,
    updatedAt: d.updatedAt,
  };
}

export async function listBillingProfiles(actor, query) {
  assertCanViewAr(actor);
  const { page, pageSize, search, skip } = parseListQuery(query);

  const locFilter = { isDisabled: { $ne: true } };
  if (actor.role === 'partner') {
    if (!actor.locationId) throw new AppError('Partner has no location assigned', 403);
    locFilter._id = actor.locationId;
  }
  if (search) {
    locFilter.name = new RegExp(search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
  }

  const [locations, total] = await Promise.all([
    Location.find(locFilter).sort({ name: 1 }).skip(skip).limit(pageSize).lean(),
    Location.countDocuments(locFilter),
  ]);

  const profiles = await ArBillingProfile.find({
    locationId: { $in: locations.map((l) => l._id) },
    isDeleted: { $ne: true },
  }).lean();
  const profileMap = new Map(profiles.map((p) => [String(p.locationId), p]));
  const settings = await getOrCreateSettings();

  return {
    profiles: locations.map((location) => {
      const doc = profileMap.get(String(location._id));
      if (doc) return formatProfile(doc, location);
      return {
        id: null,
        locationId: String(location._id),
        locationName: location.name,
        billingEmail: location.email || '',
        secondaryBillingEmail: '',
        phone: location.phone || '',
        billingAddress: {
          line1: location.address || '',
          city: location.city || '',
          state: location.state || '',
          zip: location.zip || '',
          country: 'US',
        },
        paymentTermsDays: settings.defaultPaymentTermsDays,
        billingFrequency: 'monthly',
        currency: settings.defaultCurrency || 'USD',
        paymentMethod: 'zelle',
        gracePeriodDays: settings.defaultGracePeriodDays,
        reminderDays: settings.defaultReminderDays || [],
        autoGenerateInvoice: false,
        autoSendInvoice: false,
        lateFeeEnabled: settings.lateFeeEnabled,
        lateFeeType: settings.lateFeeType,
        lateFeeAmount: settings.lateFeeAmount,
        internalNotes: '',
        createdAt: null,
        updatedAt: null,
      };
    }),
    total,
    page: Math.max(1, Number(query.page) || 1),
    pageSize,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
  };
}

export async function getBillingProfileByLocation(actor, locationId) {
  assertCanViewAr(actor);
  assertCanAccessLocation(actor, locationId);
  let doc = await ArBillingProfile.findOne({
    locationId,
    isDeleted: { $ne: true },
  });
  const location = await Location.findById(locationId).lean();
  if (!location) throw new AppError('Location not found', 404);

  if (!doc) {
    const settings = await getOrCreateSettings();
    doc = await ArBillingProfile.create({
      locationId,
      billingEmail: location.email || '',
      phone: location.phone || '',
      billingAddress: {
        line1: location.address || '',
        city: location.city || '',
        state: location.state || '',
        zip: location.zip || '',
        country: 'US',
      },
      paymentTermsDays: settings.defaultPaymentTermsDays,
      gracePeriodDays: settings.defaultGracePeriodDays,
      reminderDays: settings.defaultReminderDays,
      lateFeeEnabled: settings.lateFeeEnabled,
      lateFeeType: settings.lateFeeType,
      lateFeeAmount: settings.lateFeeAmount,
    });
  }

  return { profile: formatProfile(doc, location) };
}

export async function upsertBillingProfile(actor, locationId, patch, ipAddress = '') {
  assertCanManageAr(actor);
  const location = await Location.findById(locationId).lean();
  if (!location) throw new AppError('Location not found', 404);

  let doc = await ArBillingProfile.findOne({ locationId, isDeleted: { $ne: true } });
  const isNew = !doc;
  if (!doc) {
    doc = new ArBillingProfile({ locationId });
  }
  const prev = isNew ? null : formatProfile(doc, location);

  const fields = [
    'billingEmail',
    'secondaryBillingEmail',
    'phone',
    'billingAddress',
    'paymentTermsDays',
    'billingFrequency',
    'currency',
    'paymentMethod',
    'gracePeriodDays',
    'reminderDays',
    'autoGenerateInvoice',
    'autoSendInvoice',
    'lateFeeEnabled',
    'lateFeeType',
    'lateFeeAmount',
    'internalNotes',
  ];
  for (const key of fields) {
    if (patch[key] !== undefined) doc[key] = patch[key];
  }
  await doc.save();

  await writeArAudit({
    entityType: 'billing_profile',
    entityId: String(doc._id),
    action: isNew ? 'billing_profile_created' : 'billing_profile_updated',
    description: `Billing profile ${isNew ? 'created' : 'updated'} for ${location.name}`,
    previousValue: prev,
    newValue: formatProfile(doc, location),
    actor,
    ipAddress,
  });

  return { profile: formatProfile(doc, location) };
}
