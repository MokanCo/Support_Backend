import ArBillingProfile from '../../models/ArBillingProfile.js';
import Location from '../../models/Location.js';
import { AppError } from '../../utils/AppError.js';
import { getOrCreateSettings } from './arSettingsService.js';
import { getStripeClient } from './arStripeService.js';

async function loadProfileByAchSetupToken(token) {
  const raw = String(token || '').trim();
  if (!raw || raw.length < 32) throw new AppError('Invalid setup link', 404);
  const profile = await ArBillingProfile.findOne({
    achSetupToken: raw,
    isDeleted: { $ne: true },
  });
  if (!profile) throw new AppError('This setup link is invalid', 404);
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
