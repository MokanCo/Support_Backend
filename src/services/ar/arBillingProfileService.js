import crypto from 'crypto';
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
import { sendAchSetupEmail } from './arMailService.js';
import { getStripeClient } from './arStripeService.js';

function formatAchPaymentMethod(d) {
  if (!d.achStatus || d.achStatus === 'none') return null;
  return {
    status: d.achStatus,
    bankName: d.achBankName || '',
    last4: d.achBankLast4 || '',
    mandateId: d.achMandateId || '',
    authorizedAt: d.achAuthorizedAt || null,
  };
}

function formatCardPaymentMethod(d) {
  if (!d.cardStatus || d.cardStatus === 'none') return null;
  return {
    status: d.cardStatus,
    brand: d.cardBrand || '',
    last4: d.cardLast4 || '',
    authorizedAt: d.cardAuthorizedAt || null,
  };
}

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
    achPaymentMethod: formatAchPaymentMethod(d),
    cardPaymentMethod: formatCardPaymentMethod(d),
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
        achPaymentMethod: null,
        cardPaymentMethod: null,
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

function generateAchSetupToken() {
  return crypto.randomBytes(32).toString('hex');
}

function achSetupUrl(token) {
  const base = (process.env.APP_URL || process.env.FRONTEND_URL || '').replace(/\/$/, '');
  return base ? `${base}/ach-setup?token=${encodeURIComponent(token)}` : '';
}

/**
 * Creates (or reuses) a one-time link for the customer to link/authorize a
 * bank account for automatic ACH billing — independent of any invoice. Does
 * not touch Stripe itself; that happens when the customer opens the link
 * (see arPublicAchSetupService.js).
 */
export async function createAchSetupLink(actor, locationId, ipAddress = '') {
  assertCanManageAr(actor);
  const location = await Location.findById(locationId).lean();
  if (!location) throw new AppError('Location not found', 404);

  let doc = await ArBillingProfile.findOne({ locationId, isDeleted: { $ne: true } });
  if (!doc) doc = new ArBillingProfile({ locationId });

  if (doc.achStatus === 'active') {
    throw new AppError(
      'This customer already has a linked, verified bank account — unlink it first if you need to link a different one',
      409,
    );
  }

  const recipientEmail = String(
    doc.billingEmail || doc.secondaryBillingEmail || location.email || '',
  ).trim();
  if (!recipientEmail) {
    throw new AppError(
      'This customer has no billing email on file — add one before sending an ACH setup link',
      400,
    );
  }

  doc.achSetupToken = generateAchSetupToken();
  doc.achSetupTokenCreatedAt = new Date();
  await doc.save();

  const url = achSetupUrl(doc.achSetupToken);
  if (!url) {
    throw new AppError('APP_URL / FRONTEND_URL is not configured on the server', 500);
  }

  const sent = await sendAchSetupEmail({ location, profile: doc, url });
  if (!sent) {
    throw new AppError(
      "The setup link was created but the email could not be sent — check the server's mail configuration",
      502,
    );
  }

  await writeArAudit({
    entityType: 'billing_profile',
    entityId: String(doc._id),
    action: 'ach_setup_link_sent',
    description: `ACH setup link emailed to ${recipientEmail} for ${location.name}`,
    actor,
    ipAddress,
  });

  return { emailedTo: recipientEmail };
}

/**
 * Revokes a customer's saved ACH bank account — detaches the payment method
 * on Stripe (best-effort; already-gone is fine) and clears it locally so no
 * further off-session charges can be made against it. This is the only way
 * back to a linkable state once achStatus is 'active', since a fresh setup
 * link is refused while one is already linked.
 */
export async function unlinkAchAccount(actor, locationId, ipAddress = '') {
  assertCanManageAr(actor);
  const location = await Location.findById(locationId).lean();
  if (!location) throw new AppError('Location not found', 404);

  const doc = await ArBillingProfile.findOne({ locationId, isDeleted: { $ne: true } });
  if (!doc || doc.achStatus === 'none') {
    throw new AppError('No linked bank account to unlink', 409);
  }

  if (doc.achPaymentMethodId) {
    try {
      const stripe = getStripeClient();
      await stripe.paymentMethods.detach(doc.achPaymentMethodId);
    } catch (e) {
      // Already detached, or the customer/PM no longer exists on Stripe's
      // side — proceed with local cleanup regardless, since the goal is
      // "stop being able to charge this" and that's guaranteed either way.
    }
  }

  const prev = formatProfile(doc, location);
  doc.achStatus = 'revoked';
  doc.achPaymentMethodId = '';
  doc.achMandateId = '';
  doc.achBankName = '';
  doc.achBankLast4 = '';
  doc.achAuthorizedAt = null;
  await doc.save();

  await writeArAudit({
    entityType: 'billing_profile',
    entityId: String(doc._id),
    action: 'ach_unlinked',
    description: `ACH bank account unlinked for ${location.name}`,
    previousValue: prev,
    newValue: formatProfile(doc, location),
    actor,
    ipAddress,
  });

  return { profile: formatProfile(doc, location) };
}

/**
 * Revokes a customer's saved backup credit card — same pattern as
 * unlinkAchAccount. The bank account (if any) is untouched.
 */
export async function unlinkCardAccount(actor, locationId, ipAddress = '') {
  assertCanManageAr(actor);
  const location = await Location.findById(locationId).lean();
  if (!location) throw new AppError('Location not found', 404);

  const doc = await ArBillingProfile.findOne({ locationId, isDeleted: { $ne: true } });
  if (!doc || doc.cardStatus === 'none') {
    throw new AppError('No linked card to unlink', 409);
  }

  if (doc.cardPaymentMethodId) {
    try {
      const stripe = getStripeClient();
      await stripe.paymentMethods.detach(doc.cardPaymentMethodId);
    } catch (e) {
      // Already detached, or the customer/PM no longer exists on Stripe's
      // side — proceed with local cleanup regardless.
    }
  }

  const prev = formatProfile(doc, location);
  doc.cardStatus = 'revoked';
  doc.cardPaymentMethodId = '';
  doc.cardBrand = '';
  doc.cardLast4 = '';
  doc.cardAuthorizedAt = null;
  await doc.save();

  await writeArAudit({
    entityType: 'billing_profile',
    entityId: String(doc._id),
    action: 'card_unlinked',
    description: `Backup card unlinked for ${location.name}`,
    previousValue: prev,
    newValue: formatProfile(doc, location),
    actor,
    ipAddress,
  });

  return { profile: formatProfile(doc, location) };
}
