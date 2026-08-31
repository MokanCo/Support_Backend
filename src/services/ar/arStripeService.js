import Stripe from 'stripe';
import ArPayment from '../../models/ArPayment.js';
import ArInvoice from '../../models/ArInvoice.js';
import Location from '../../models/Location.js';
import ArBillingProfile from '../../models/ArBillingProfile.js';
import { AppError } from '../../utils/AppError.js';
import { money } from './arAccess.js';
import { loadInvoiceByToken, publicInvoicePayUrl } from './arPublicInvoiceService.js';
import { recordPayment } from './arPaymentService.js';
import { sendInvoiceEmail } from './arMailService.js';
import {
  centsToDollars,
  dollarsToCents,
  quoteStripePayment,
} from '../../config/stripeFees.js';

let stripeClient = null;

function getStripeClient() {
  if (!process.env.STRIPE_SECRET_KEY) {
    throw new AppError('Stripe is not configured', 503);
  }
  if (!stripeClient) {
    stripeClient = new Stripe(process.env.STRIPE_SECRET_KEY);
  }
  return stripeClient;
}

/** System actor used to finalize a payment from a Stripe webhook — there is
 *  no logged-in user, but Stripe's own confirmation is authoritative, so this
 *  goes straight through recordPayment() rather than the manual-review queue
 *  that self-reported Zelle payments use. */
const STRIPE_SYSTEM_ACTOR = { id: null, role: 'admin', name: 'Stripe', email: '' };

const SUCCESS_EVENTS = new Set([
  'checkout.session.completed',
  'checkout.session.async_payment_succeeded',
  'payment_intent.succeeded',
]);
const FAILED_EVENTS = new Set([
  'payment_intent.payment_failed',
  'payment_intent.canceled',
  'checkout.session.async_payment_failed',
]);
const PROCESSING_EVENTS = new Set(['payment_intent.processing']);

export function normalizeCheckoutPaymentMethodType(raw) {
  const v = String(raw || 'card').toLowerCase().trim();
  if (v === 'ach' || v === 'us_bank_account' || v === 'bank') return 'ach';
  return 'card';
}

export function isAchMetadata(metadata = {}) {
  const method = String(metadata.paymentMethod || '').toLowerCase();
  const type = String(metadata.stripePaymentMethodType || '').toLowerCase();
  return method === 'ach' || type === 'ach';
}

export function stripeFeeQuoteForInvoice(invoice, paymentMethod = 'stripe') {
  const balanceDue = money(invoice?.balanceDue);
  const currency = invoice?.currency || 'USD';
  return quoteStripePayment(balanceDue, paymentMethod, currency);
}

function sessionMetadata(invoice, token, quote, stripePaymentMethodType) {
  const isAch = stripePaymentMethodType === 'ach';
  const metadata = {
    invoiceId: String(invoice._id),
    invoiceNumber: invoice.invoiceNumber,
    token: String(token || ''),
    invoiceAmountCents: String(quote.invoiceAmountCents),
    stripeFeeCents: String(quote.stripeFeeCents),
    stripeChargeAmountCents: String(quote.stripeChargeAmountCents),
    currency: quote.currency,
    paymentMethod: isAch ? 'ach' : 'stripe',
  };
  if (isAch) metadata.stripePaymentMethodType = 'ach';
  return metadata;
}

async function findPendingStripePayment(invoiceId) {
  return ArPayment.findOne({
    invoiceId,
    isDeleted: { $ne: true },
    paymentStatus: 'pending',
    $or: [
      { stripePaymentIntentId: { $nin: [null, ''] } },
      { stripeCheckoutSessionId: { $nin: [null, ''] } },
    ],
  });
}

/**
 * Creates a Stripe Checkout Session for the invoice behind this public
 * payment token and returns its hosted URL plus the server-calculated
 * fee breakdown. The charge amount is always computed here from the
 * invoice in the database — never from a client-supplied total.
 *
 * `paymentMethodType` is the only client input that is used:
 *   - omitted / "card" → existing card Checkout (unchanged)
 *   - "ach" → US bank account / ACH Direct Debit Checkout (no card fee)
 *
 * The invoice is only marked paid once Stripe confirms payment via
 * webhook (see handleStripeWebhookEvent) — never on this call, and never
 * on the client redirect alone. ACH typically stays `processing` first.
 */
export async function createPublicCheckoutSession(token, paymentMethodType = 'card') {
  const stripe = getStripeClient();
  const invoice = await loadInvoiceByToken(token);
  const methodType = normalizeCheckoutPaymentMethodType(paymentMethodType);
  const isAch = methodType === 'ach';
  const quote = stripeFeeQuoteForInvoice(invoice, isAch ? 'ach' : 'stripe');
  if (quote.invoiceAmountCents <= 0) {
    throw new AppError('This invoice is already paid', 409);
  }

  if (isAch && String(quote.currency || 'USD').toUpperCase() !== 'USD') {
    throw new AppError('ACH Direct Debit is only available for USD invoices', 400);
  }

  const pending = await findPendingStripePayment(invoice._id);
  if (pending) {
    throw new AppError(
      'A bank payment is already processing for this invoice. Please wait for it to settle before starting another payment.',
      409,
    );
  }

  const currency = quote.currency.toLowerCase();
  const payUrl = publicInvoicePayUrl(token);
  const metadata = sessionMetadata(invoice, token, quote, methodType);

  const lineItems = [
    {
      price_data: {
        currency,
        product_data: { name: `Invoice ${invoice.invoiceNumber}` },
        unit_amount: quote.invoiceAmountCents,
      },
      quantity: 1,
    },
  ];
  if (!isAch && quote.stripeFeeCents > 0) {
    lineItems.push({
      price_data: {
        currency,
        product_data: { name: 'Card processing fee' },
        unit_amount: quote.stripeFeeCents,
      },
      quantity: 1,
    });
  }

  const sessionParams = {
    mode: 'payment',
    line_items: lineItems,
    success_url: isAch ? `${payUrl}&stripe=ach_processing` : `${payUrl}&stripe=success`,
    cancel_url: `${payUrl}&stripe=cancelled`,
    metadata,
    payment_intent_data: { metadata },
  };

  if (isAch) {
    sessionParams.payment_method_types = ['us_bank_account'];
    sessionParams.payment_method_options = {
      us_bank_account: {
        financial_connections: {
          permissions: ['payment_method'],
        },
      },
    };
  }

  const session = isAch
    ? await stripe.checkout.sessions.create(sessionParams, {
        idempotencyKey: `ar-checkout-ach-${String(invoice._id)}`,
      })
    : await stripe.checkout.sessions.create(sessionParams);

  return {
    url: session.url,
    originalAmount: quote.originalAmount,
    stripeProcessingFee: quote.stripeProcessingFee,
    stripeChargeAmount: quote.stripeChargeAmount,
    currency: quote.currency,
    invoiceAmountCents: quote.invoiceAmountCents,
    stripeFeeCents: quote.stripeFeeCents,
    stripeChargeAmountCents: quote.stripeChargeAmountCents,
    paymentMethod: isAch ? 'ach' : 'stripe',
    paymentMethodType: methodType,
  };
}

async function findExistingStripePayment({ checkoutSessionId, paymentIntentId }) {
  const or = [];
  if (checkoutSessionId) {
    or.push({ stripeCheckoutSessionId: checkoutSessionId });
    or.push({ transactionReference: checkoutSessionId });
  }
  if (paymentIntentId) {
    or.push({ stripePaymentIntentId: paymentIntentId });
    or.push({ transactionReference: paymentIntentId });
  }
  if (!or.length) return null;
  return ArPayment.findOne({ isDeleted: { $ne: true }, $or: or });
}

function parseCents(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.round(n) : fallback;
}

function failureReasonFromObject(obj) {
  const msg = obj?.last_payment_error?.message || obj?.last_setup_error?.message || '';
  return String(msg).trim().slice(0, 500);
}

function paymentIdsFromEvent(event) {
  const obj = event.data?.object || {};
  if (
    event.type === 'checkout.session.completed' ||
    event.type === 'checkout.session.async_payment_succeeded' ||
    event.type === 'checkout.session.async_payment_failed'
  ) {
    const pi =
      typeof obj.payment_intent === 'string'
        ? obj.payment_intent
        : obj.payment_intent?.id || '';
    return {
      checkoutSessionId: obj.id || '',
      paymentIntentId: pi,
      metadata: obj.metadata || {},
      chargeCents: parseCents(obj.amount_total),
      currency: (obj.currency || 'usd').toUpperCase(),
      paid: obj.payment_status === 'paid' || event.type === 'checkout.session.async_payment_succeeded',
      failureReason: failureReasonFromObject(obj),
    };
  }
  return {
    checkoutSessionId: obj.metadata?.stripeCheckoutSessionId || '',
    paymentIntentId: obj.id || '',
    metadata: obj.metadata || {},
    chargeCents: parseCents(obj.amount_received || obj.amount),
    currency: (obj.currency || obj.metadata?.currency || 'usd').toUpperCase(),
    paid: event.type === 'payment_intent.succeeded',
    failureReason: failureReasonFromObject(obj),
  };
}

function quoteMethodFromMetadata(metadata) {
  return isAchMetadata(metadata) ? 'ach' : 'stripe';
}

async function amountsForStripePayment(ids) {
  const invoiceId = ids.metadata.invoiceId;
  if (!invoiceId) return null;

  const invoice = await ArInvoice.findById(invoiceId);
  if (!invoice || invoice.isDeleted) return null;

  const remainingCents = dollarsToCents(money(invoice.balanceDue));
  if (remainingCents <= 0) {
    return {
      invoice,
      invoiceId,
      originalCents: 0,
      feeCents: 0,
      chargeCents: ids.chargeCents,
      currency: (ids.currency || invoice.currency || 'USD').toUpperCase(),
    };
  }

  const metaOriginalCents = parseCents(ids.metadata.invoiceAmountCents, 0);
  const originalCents = metaOriginalCents > 0 ? Math.min(metaOriginalCents, remainingCents) : remainingCents;

  const quote = quoteStripePayment(
    centsToDollars(originalCents || metaOriginalCents),
    quoteMethodFromMetadata(ids.metadata),
    ids.currency,
  );
  const chargeCents =
    ids.chargeCents > 0 ? ids.chargeCents : quote.stripeChargeAmountCents;
  const feeCents = Math.max(0, chargeCents - quote.invoiceAmountCents);

  return {
    invoice,
    invoiceId,
    originalCents: quote.invoiceAmountCents,
    feeCents,
    chargeCents,
    currency: quote.currency,
  };
}

function stripePaymentFields(ids, amounts) {
  const isAch = isAchMetadata(ids.metadata);
  return {
    paymentMethod: isAch ? 'ach' : 'stripe',
    stripePaymentMethodType: isAch ? 'ach' : 'card',
    originalAmount: centsToDollars(amounts.originalCents),
    stripeProcessingFee: centsToDollars(amounts.feeCents),
    stripeChargeAmount: centsToDollars(amounts.chargeCents),
    currency: amounts.currency,
    transactionReference: ids.checkoutSessionId || ids.paymentIntentId,
    stripeCheckoutSessionId: ids.checkoutSessionId,
    stripePaymentIntentId: ids.paymentIntentId,
  };
}

function paidNotes(ids, amounts) {
  const charge = centsToDollars(amounts.chargeCents).toFixed(2);
  const fee = centsToDollars(amounts.feeCents).toFixed(2);
  if (isAchMetadata(ids.metadata)) {
    return `Paid via Stripe ACH Direct Debit (customer charged $${charge})`;
  }
  return `Paid via Stripe Checkout (customer charged $${charge} including $${fee} processing fee)`;
}

/**
 * Applies a successful Stripe charge to the invoice. `amount` is the original
 * invoice amount (what the business should net) — never the gross charge.
 */
async function recordSuccessfulStripePayment(ids, amounts) {
  const fields = stripePaymentFields(ids, amounts);
  await recordPayment(STRIPE_SYSTEM_ACTOR, {
    invoiceId: amounts.invoiceId,
    amount: fields.originalAmount,
    originalAmount: fields.originalAmount,
    stripeProcessingFee: fields.stripeProcessingFee,
    stripeChargeAmount: fields.stripeChargeAmount,
    currency: fields.currency,
    paymentDate: new Date(),
    paymentMethod: fields.paymentMethod,
    stripePaymentMethodType: fields.stripePaymentMethodType,
    paymentStatus: 'paid',
    transactionReference: fields.transactionReference,
    stripeCheckoutSessionId: fields.stripeCheckoutSessionId,
    stripePaymentIntentId: fields.stripePaymentIntentId,
    notes: paidNotes(ids, amounts),
  });
}

async function recordFailedStripePayment(ids, amounts, status = 'failed') {
  const fields = stripePaymentFields(ids, amounts);
  const originalAmount = centsToDollars(amounts.originalCents || dollarsToCents(0.01));
  await recordPayment(STRIPE_SYSTEM_ACTOR, {
    invoiceId: amounts.invoiceId,
    amount: Math.max(originalAmount, 0.01),
    originalAmount,
    stripeProcessingFee: fields.stripeProcessingFee,
    stripeChargeAmount: fields.stripeChargeAmount,
    currency: fields.currency,
    paymentDate: new Date(),
    paymentMethod: fields.paymentMethod,
    stripePaymentMethodType: fields.stripePaymentMethodType,
    paymentStatus: status,
    failureReason: ids.failureReason || '',
    transactionReference: fields.transactionReference,
    stripeCheckoutSessionId: fields.stripeCheckoutSessionId,
    stripePaymentIntentId: fields.stripePaymentIntentId,
    notes: status === 'canceled' ? 'Stripe payment canceled' : 'Stripe payment failed',
  });
}

async function recordPendingStripePayment(ids, amounts) {
  const fields = stripePaymentFields(ids, amounts);
  await recordPayment(STRIPE_SYSTEM_ACTOR, {
    invoiceId: amounts.invoiceId,
    amount: Math.max(fields.originalAmount, 0.01),
    originalAmount: fields.originalAmount,
    stripeProcessingFee: fields.stripeProcessingFee,
    stripeChargeAmount: fields.stripeChargeAmount,
    currency: fields.currency,
    paymentDate: new Date(),
    paymentMethod: fields.paymentMethod,
    stripePaymentMethodType: fields.stripePaymentMethodType,
    paymentStatus: 'pending',
    transactionReference: fields.transactionReference,
    stripeCheckoutSessionId: fields.stripeCheckoutSessionId,
    stripePaymentIntentId: fields.stripePaymentIntentId,
    notes: 'Stripe ACH Direct Debit authorized — awaiting bank settlement',
  });
}

async function sendPaidReceipt(invoiceId) {
  const invoice = await ArInvoice.findById(invoiceId);
  if (!invoice) return;
  const location = await Location.findById(invoice.locationId).lean();
  const profile = await ArBillingProfile.findOne({ locationId: invoice.locationId }).lean();
  await sendInvoiceEmail({
    invoice,
    location,
    profile,
    kind: 'receipt',
  });
}

const defaultStore = {
  findExisting: findExistingStripePayment,
  loadAmounts: amountsForStripePayment,
  recordPaid: recordSuccessfulStripePayment,
  recordFailed: recordFailedStripePayment,
  recordPending: recordPendingStripePayment,
  saveExisting: (doc) => doc.save(),
  refreshBalances: async (invoiceId) => {
    const { refreshInvoiceBalances } = await import('./arInvoiceService.js');
    return refreshInvoiceBalances(invoiceId);
  },
  sendReceipt: sendPaidReceipt,
};

function applyIdsToExisting(existing, ids, amounts, paymentStatus, notes) {
  const fields = stripePaymentFields(ids, amounts);
  existing.paymentStatus = paymentStatus;
  existing.amount = centsToDollars(amounts.originalCents);
  existing.originalAmount = existing.amount;
  existing.stripeProcessingFee = centsToDollars(amounts.feeCents);
  existing.stripeChargeAmount = centsToDollars(amounts.chargeCents);
  existing.paymentMethod = fields.paymentMethod;
  existing.stripePaymentMethodType = fields.stripePaymentMethodType;
  existing.stripeCheckoutSessionId =
    ids.checkoutSessionId || existing.stripeCheckoutSessionId;
  existing.stripePaymentIntentId =
    ids.paymentIntentId || existing.stripePaymentIntentId;
  existing.transactionReference =
    ids.checkoutSessionId || ids.paymentIntentId || existing.transactionReference;
  existing.notes = notes;
  if (paymentStatus === 'paid') existing.failureReason = '';
  if (ids.failureReason && paymentStatus !== 'paid') {
    existing.failureReason = ids.failureReason;
  }
}

/**
 * Core webhook processor — signature verification happens in
 * handleStripeWebhookEvent. Exported for unit tests (`store` is injectable).
 */
export async function processStripeEvent(event, store = defaultStore) {
  const db = { ...defaultStore, ...store };
  if (!event?.type) return { handled: false };

  if (SUCCESS_EVENTS.has(event.type)) {
    const ids = paymentIdsFromEvent(event);
    if (event.type === 'checkout.session.completed' && !ids.paid) {
      if (!isAchMetadata(ids.metadata)) {
        return { handled: false };
      }
      return recordProcessing(ids, db);
    }
    if (!ids.metadata?.invoiceId) {
      return { handled: false };
    }

    const existing = await db.findExisting(ids);
    if (existing?.paymentStatus === 'paid') {
      return { handled: true, duplicate: true };
    }

    const amounts = await db.loadAmounts(ids);
    if (!amounts) return { handled: false };
    if (amounts.originalCents <= 0) {
      return { handled: true, duplicate: true };
    }

    if (existing && existing.paymentStatus !== 'paid') {
      const wasPending = existing.paymentStatus === 'pending';
      applyIdsToExisting(existing, ids, amounts, 'paid', paidNotes(ids, amounts));
      await db.saveExisting(existing);
      await db.refreshBalances(amounts.invoiceId);
      if (wasPending && db.sendReceipt) {
        await db.sendReceipt(amounts.invoiceId);
      }
      return { handled: true, recovered: true };
    }

    await db.recordPaid(ids, amounts);
    return { handled: true };
  }

  if (PROCESSING_EVENTS.has(event.type)) {
    const ids = paymentIdsFromEvent(event);
    if (!ids.metadata?.invoiceId) return { handled: false };
    return recordProcessing(ids, db);
  }

  if (FAILED_EVENTS.has(event.type)) {
    const ids = paymentIdsFromEvent(event);
    if (!ids.metadata?.invoiceId) {
      return { handled: false };
    }
    const existing = await db.findExisting(ids);
    if (existing?.paymentStatus === 'paid') {
      return { handled: true, duplicate: true };
    }
    const status = event.type === 'payment_intent.canceled' ? 'canceled' : 'failed';
    if (existing?.paymentStatus === 'failed' || existing?.paymentStatus === 'canceled') {
      return { handled: true, duplicate: true };
    }
    const amounts = await db.loadAmounts(ids);
    if (!amounts) return { handled: false };
    if (existing?.paymentStatus === 'pending') {
      applyIdsToExisting(
        existing,
        ids,
        amounts,
        status,
        status === 'canceled' ? 'Stripe payment canceled' : 'Stripe payment failed',
      );
      await db.saveExisting(existing);
      await db.refreshBalances(amounts.invoiceId);
      return { handled: true, failed: true };
    }
    await db.recordFailed(ids, amounts, status);
    return { handled: true, failed: true };
  }

  return { handled: false };
}

async function recordProcessing(ids, db) {
  if (!ids.metadata?.invoiceId) return { handled: false };
  const existing = await db.findExisting(ids);
  if (existing?.paymentStatus === 'paid') {
    return { handled: true, duplicate: true };
  }
  if (existing?.paymentStatus === 'pending') {
    existing.stripeCheckoutSessionId =
      ids.checkoutSessionId || existing.stripeCheckoutSessionId;
    existing.stripePaymentIntentId =
      ids.paymentIntentId || existing.stripePaymentIntentId;
    await db.saveExisting(existing);
    return { handled: true, duplicate: true, pending: true };
  }
  const amounts = await db.loadAmounts(ids);
  if (!amounts) return { handled: false };
  if (amounts.originalCents <= 0) {
    return { handled: true, duplicate: true };
  }
  await db.recordPending(ids, amounts);
  return { handled: true, pending: true };
}

/**
 * Verifies and processes a Stripe webhook event.
 * Idempotent: a session or PaymentIntent already on file as a paid payment
 * is skipped (Stripe may redeliver webhooks).
 */
export async function handleStripeWebhookEvent(rawBody, signature) {
  const stripe = getStripeClient();
  if (!process.env.STRIPE_WEBHOOK_SECRET) {
    throw new AppError('Stripe webhook secret is not configured', 503);
  }

  const event = stripe.webhooks.constructEvent(
    rawBody,
    signature,
    process.env.STRIPE_WEBHOOK_SECRET,
  );

  return processStripeEvent(event);
}
