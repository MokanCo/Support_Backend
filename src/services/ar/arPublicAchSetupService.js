import ArBillingProfile from '../../models/ArBillingProfile.js';
import Location from '../../models/Location.js';
import { AppError } from '../../utils/AppError.js';
import { getOrCreateSettings } from './arSettingsService.js';
import { getStripeClient } from './arStripeService.js';

/** How long a "link your bank" email stays valid before an admin has to send
 *  a fresh one. Kept short since it authorizes future automatic debits. */
const ACH_SETUP_LINK_TTL_DAYS = Number(process.env.ACH_SETUP_LINK_TTL_DAYS) || 7;

function isSetupTokenExpired(profile) {
  if (!profile.achSetupTokenCreatedAt) return false;
  const ageMs = Date.now() - new Date(profile.achSetupTokenCreatedAt).getTime();
  return ageMs > ACH_SETUP_LINK_TTL_DAYS * 24 * 60 * 60 * 1000;
}

async function loadProfileByAchSetupToken(token) {
  const raw = String(token || '').trim();
  if (!raw || raw.length < 32) throw new AppError('Invalid setup link', 404);
  const profile = await ArBillingProfile.findOne({
    achSetupToken: raw,
    isDeleted: { $ne: true },
  });
  if (!profile) throw new AppError('This setup link is invalid', 404);
  // Already-linked links never "expire" — revisiting a completed link should
  // always show the "you're all set" state, not a confusing expiry error.
  if (profile.achStatus !== 'active' && isSetupTokenExpired(profile)) {
    throw new AppError(
      'This setup link has expired — ask the business to send you a new one',
      410,
    );
  }
  return profile;
}

/**
 * Public payload for the one-time ACH bank-linking page — company branding
 * and whether this customer already has a linked, verified bank account.
 */
export async function getPublicAchSetup(token) {
  const profile = await loadProfileByAchSetupToken(token);
  const [location, settings] = await Promise.all([
    Location.findById(profile.locationId).lean(),
    getOrCreateSettings(),
  ]);

  return {
    company: {
      name: settings.companyName || 'Mokanco',
      logoUrl: settings.logoUrl || '',
    },
    customerName: location?.name || '',
    alreadyLinked: profile.achStatus === 'active',
    cardAlreadyLinked: profile.cardStatus === 'active',
  };
}

/**
 * Creates a Stripe SetupIntent to link + authorize a bank account for future
 * off-session ACH debits — no charge attached. `ipAddress`/`userAgent` back
 * the mandate's required customer_acceptance record.
 */
export async function createAchSetupIntent(token, { ipAddress = '', userAgent = '' } = {}) {
  const profile = await loadProfileByAchSetupToken(token);
  if (profile.achStatus === 'active') {
    throw new AppError('This bank account is already linked and verified', 409);
  }
  if (!process.env.STRIPE_PUBLISHABLE_KEY) {
    throw new AppError('Stripe is not configured', 503);
  }

  const stripe = getStripeClient();

  let customerId = profile.stripeCustomerId;
  if (!customerId) {
    const location = await Location.findById(profile.locationId).lean();
    const customer = await stripe.customers.create({
      name: location?.name || undefined,
      email: profile.billingEmail || location?.email || undefined,
      metadata: { locationId: String(profile.locationId) },
    });
    customerId = customer.id;
    profile.stripeCustomerId = customerId;
    await profile.save();
  }

  // `mandate_data` can only be sent when confirming immediately (confirm: true).
  // This SetupIntent is deliberately created unconfirmed — the client confirms
  // it after the customer fills in their bank details via Stripe's
  // PaymentElement, which displays the required ACH authorization notice and
  // attaches the mandate itself at confirmation time. ipAddress/userAgent are
  // accepted here for parity with the request and future audit use, but
  // aren't needed for the mandate itself with this confirmation flow.
  const setupIntent = await stripe.setupIntents.create({
    customer: customerId,
    payment_method_types: ['us_bank_account'],
    payment_method_options: {
      us_bank_account: {
        financial_connections: { permissions: ['payment_method'] },
      },
    },
    metadata: {
      locationId: String(profile.locationId),
      achSetupToken: token,
    },
  });

  return {
    clientSecret: setupIntent.client_secret,
    publishableKey: process.env.STRIPE_PUBLISHABLE_KEY,
  };
}

/**
 * Creates a Stripe SetupIntent to save a backup credit card on the same
 * customer — a second, optional step offered after (or instead of) linking a
 * bank account. Used only as a manual fallback the admin explicitly chooses
 * per invoice when an ACH debit bounces; never auto-charged.
 */
export async function createCardSetupIntent(token) {
  const profile = await loadProfileByAchSetupToken(token);
  if (profile.cardStatus === 'active') {
    throw new AppError('This customer already has a linked card — unlink it first to add a different one', 409);
  }
  if (!process.env.STRIPE_PUBLISHABLE_KEY) {
    throw new AppError('Stripe is not configured', 503);
  }

  const stripe = getStripeClient();

  let customerId = profile.stripeCustomerId;
  if (!customerId) {
    const location = await Location.findById(profile.locationId).lean();
    const customer = await stripe.customers.create({
      name: location?.name || undefined,
      email: profile.billingEmail || location?.email || undefined,
      metadata: { locationId: String(profile.locationId) },
    });
    customerId = customer.id;
    profile.stripeCustomerId = customerId;
    await profile.save();
  }

  const setupIntent = await stripe.setupIntents.create({
    customer: customerId,
    payment_method_types: ['card'],
    metadata: {
      locationId: String(profile.locationId),
      achSetupToken: token,
    },
  });

  return {
    clientSecret: setupIntent.client_secret,
    publishableKey: process.env.STRIPE_PUBLISHABLE_KEY,
  };
}
