import Stripe from 'stripe';
import ArPayment from '../../models/ArPayment.js';
import ArInvoice from '../../models/ArInvoice.js';
import { AppError } from '../../utils/AppError.js';
import { money } from './arAccess.js';
import { loadInvoiceByToken, publicInvoicePayUrl } from './arPublicInvoiceService.js';
import { recordPayment } from './arPaymentService.js';
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
  'payment_intent.succeeded',
]);
const FAILED_EVENTS = new Set(['payment_intent.payment_failed']);

export function stripeFeeQuoteForInvoice(invoice) {
  const balanceDue = money(invoice?.balanceDue);
  const currency = invoice?.currency || 'USD';
  return quoteStripePayment(balanceDue, 'stripe', currency);
}

function sessionMetadata(invoice, token, quote) {
  return {
    invoiceId: String(invoice._id),
    invoiceNumber: invoice.invoiceNumber,
    token: String(token || ''),
    invoiceAmountCents: String(quote.invoiceAmountCents),
    stripeFeeCents: String(quote.stripeFeeCents),
    stripeChargeAmountCents: String(quote.stripeChargeAmountCents),
    currency: quote.currency,
    paymentMethod: 'stripe',
  };
}

/**
 * Creates a Stripe Checkout Session for the invoice behind this public
 * payment token and returns its hosted URL plus the server-calculated
 * fee breakdown. The charge amount is always computed here from the
 * invoice in the database — never from a client-supplied total.
 *
 * The invoice is only marked paid once Stripe confirms payment via
 * webhook (see handleStripeWebhookEvent) — never on this call, and never
 * on the client redirect alone.
 */
export async function createPublicCheckoutSession(token) {
  const stripe = getStripeClient();
  const invoice = await loadInvoiceByToken(token);
  const quote = stripeFeeQuoteForInvoice(invoice);
  if (quote.invoiceAmountCents <= 0) {
    throw new AppError('This invoice is already paid', 409);
  }

  const currency = quote.currency.toLowerCase();
  const payUrl = publicInvoicePayUrl(token);
  const metadata = sessionMetadata(invoice, token, quote);

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
  if (quote.stripeFeeCents > 0) {
    lineItems.push({
      price_data: {
        currency,
        product_data: { name: 'Card processing fee' },
        unit_amount: quote.stripeFeeCents,
      },
      quantity: 1,
    });
  }

  const session = await stripe.checkout.sessions.create({
    mode: 'payment',
    line_items: lineItems,
    success_url: `${payUrl}&stripe=success`,
    cancel_url: `${payUrl}&stripe=cancelled`,
    metadata,
    payment_intent_data: { metadata },
  });

  return {
    url: session.url,
    originalAmount: quote.originalAmount,
    stripeProcessingFee: quote.stripeProcessingFee,
    stripeChargeAmount: quote.stripeChargeAmount,
    currency: quote.currency,
    invoiceAmountCents: quote.invoiceAmountCents,
    stripeFeeCents: quote.stripeFeeCents,
    stripeChargeAmountCents: quote.stripeChargeAmountCents,
    paymentMethod: 'stripe',
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

function paymentIdsFromEvent(event) {
  const obj = event.data?.object || {};
  if (event.type === 'checkout.session.completed') {
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
      paid: obj.payment_status === 'paid',
    };
  }
  // payment_intent.succeeded | payment_intent.payment_failed
  return {
    checkoutSessionId: obj.metadata?.stripeCheckoutSessionId || '',
    paymentIntentId: obj.id || '',
    metadata: obj.metadata || {},
    chargeCents: parseCents(obj.amount_received || obj.amount),
    currency: (obj.currency || obj.metadata?.currency || 'usd').toUpperCase(),
    paid: event.type === 'payment_intent.succeeded',
  };
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

  const quote = quoteStripePayment(centsToDollars(originalCents || metaOriginalCents), 'stripe', ids.currency);
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

/**
 * Applies a successful Stripe charge to the invoice. `amount` is the original
 * invoice amount (what the business should net) — never the gross charge.
 */
async function recordSuccessfulStripePayment(ids, amounts) {
  const originalAmount = centsToDollars(amounts.originalCents);
  const stripeProcessingFee = centsToDollars(amounts.feeCents);
  const stripeChargeAmount = centsToDollars(amounts.chargeCents);

  await recordPayment(STRIPE_SYSTEM_ACTOR, {
    invoiceId: amounts.invoiceId,
    amount: originalAmount,
    originalAmount,
    stripeProcessingFee,
    stripeChargeAmount,
    currency: amounts.currency,
    paymentDate: new Date(),
    paymentMethod: 'stripe',
    paymentStatus: 'paid',
    transactionReference: ids.checkoutSessionId || ids.paymentIntentId,
    stripeCheckoutSessionId: ids.checkoutSessionId,
    stripePaymentIntentId: ids.paymentIntentId,
    notes: `Paid via Stripe Checkout (customer charged $${stripeChargeAmount.toFixed(2)} including $${stripeProcessingFee.toFixed(2)} processing fee)`,
  });
}

async function recordFailedStripePayment(ids, amounts) {
  const originalAmount = centsToDollars(amounts.originalCents || dollarsToCents(0.01));
  await recordPayment(STRIPE_SYSTEM_ACTOR, {
    invoiceId: amounts.invoiceId,
    amount: Math.max(originalAmount, 0.01),
    originalAmount,
    stripeProcessingFee: centsToDollars(amounts.feeCents),
    stripeChargeAmount: centsToDollars(amounts.chargeCents),
    currency: amounts.currency,
    paymentDate: new Date(),
    paymentMethod: 'stripe',
    paymentStatus: 'failed',
    transactionReference: ids.checkoutSessionId || ids.paymentIntentId,
    stripeCheckoutSessionId: ids.checkoutSessionId,
    stripePaymentIntentId: ids.paymentIntentId,
    notes: 'Stripe payment failed',
  });
}

const defaultStore = {
  findExisting: findExistingStripePayment,
  loadAmounts: amountsForStripePayment,
  recordPaid: recordSuccessfulStripePayment,
  recordFailed: recordFailedStripePayment,
  saveExisting: (doc) => doc.save(),
  refreshBalances: async (invoiceId) => {
    const { refreshInvoiceBalances } = await import('./arInvoiceService.js');
    return refreshInvoiceBalances(invoiceId);
  },
};

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
      return { handled: false };
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

    if (existing?.paymentStatus === 'failed') {
      existing.paymentStatus = 'paid';
      existing.amount = centsToDollars(amounts.originalCents);
      existing.originalAmount = existing.amount;
      existing.stripeProcessingFee = centsToDollars(amounts.feeCents);
      existing.stripeChargeAmount = centsToDollars(amounts.chargeCents);
      existing.stripeCheckoutSessionId =
        ids.checkoutSessionId || existing.stripeCheckoutSessionId;
      existing.stripePaymentIntentId =
        ids.paymentIntentId || existing.stripePaymentIntentId;
      existing.transactionReference =
        ids.checkoutSessionId || ids.paymentIntentId || existing.transactionReference;
      existing.notes = `Paid via Stripe Checkout (customer charged $${Number(existing.stripeChargeAmount).toFixed(2)} including $${Number(existing.stripeProcessingFee).toFixed(2)} processing fee)`;
      await db.saveExisting(existing);
      await db.refreshBalances(amounts.invoiceId);
      return { handled: true, recovered: true };
    }

    await db.recordPaid(ids, amounts);
    return { handled: true };
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
    if (existing?.paymentStatus === 'failed') {
      return { handled: true, duplicate: true };
    }
    const amounts = await db.loadAmounts(ids);
    if (!amounts) return { handled: false };
    await db.recordFailed(ids, amounts);
    return { handled: true, failed: true };
  }

  return { handled: false };
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
