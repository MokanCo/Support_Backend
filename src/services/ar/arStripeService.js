import Stripe from 'stripe';
import ArPayment from '../../models/ArPayment.js';
import { AppError } from '../../utils/AppError.js';
import { money } from './arAccess.js';
import { loadInvoiceByToken, publicInvoicePayUrl } from './arPublicInvoiceService.js';
import { recordPayment } from './arPaymentService.js';

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

/**
 * Creates a Stripe Checkout Session for the invoice behind this public
 * payment token and returns its hosted URL. The invoice is only marked paid
 * once Stripe confirms payment via webhook (see handleStripeWebhookEvent) —
 * never on this call, and never on the client redirect alone.
 */
export async function createPublicCheckoutSession(token) {
  const stripe = getStripeClient();
  const invoice = await loadInvoiceByToken(token);
  const balanceDue = money(invoice.balanceDue);
  if (balanceDue <= 0) {
    throw new AppError('This invoice is already paid', 409);
  }

  const payUrl = publicInvoicePayUrl(token);
  const session = await stripe.checkout.sessions.create({
    mode: 'payment',
    line_items: [
      {
        price_data: {
          currency: (invoice.currency || 'usd').toLowerCase(),
          product_data: { name: `Invoice ${invoice.invoiceNumber}` },
          unit_amount: Math.round(balanceDue * 100),
        },
        quantity: 1,
      },
    ],
    success_url: `${payUrl}&stripe=success`,
    cancel_url: `${payUrl}&stripe=cancelled`,
    metadata: {
      invoiceId: String(invoice._id),
      invoiceNumber: invoice.invoiceNumber,
      token,
    },
  });

  return { url: session.url };
}

/**
 * Verifies and processes a Stripe webhook event. On a completed checkout
 * session, records the payment through the same recordPayment() used
 * everywhere else — the single source of truth for invoice balance/status.
 * Idempotent: a session whose id is already on file as a payment's
 * transaction reference is skipped (Stripe may redeliver webhooks).
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

  if (event.type !== 'checkout.session.completed') {
    return { handled: false };
  }

  const session = event.data.object;
  if (session.payment_status !== 'paid') {
    return { handled: false };
  }

  const invoiceId = session.metadata?.invoiceId;
  if (!invoiceId) {
    return { handled: false };
  }

  const alreadyRecorded = await ArPayment.findOne({
    transactionReference: session.id,
    isDeleted: { $ne: true },
  }).lean();
  if (alreadyRecorded) {
    return { handled: true, duplicate: true };
  }

  await recordPayment(STRIPE_SYSTEM_ACTOR, {
    invoiceId,
    amount: (session.amount_total || 0) / 100,
    paymentDate: new Date(),
    paymentMethod: 'stripe',
    transactionReference: session.id,
    notes: 'Paid via Stripe Checkout',
  });

  return { handled: true };
}
