import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { processStripeEvent } from '../src/services/ar/arStripeService.js';
import { quoteStripePayment } from '../src/config/stripeFees.js';

function memoryStore() {
  const payments = [];
  return {
    payments,
    findExisting: async ({ checkoutSessionId, paymentIntentId }) =>
      payments.find(
        (p) =>
          (checkoutSessionId &&
            (p.stripeCheckoutSessionId === checkoutSessionId ||
              p.transactionReference === checkoutSessionId)) ||
          (paymentIntentId &&
            (p.stripePaymentIntentId === paymentIntentId ||
              p.transactionReference === paymentIntentId)),
      ) || null,
    loadAmounts: async (ids) => {
      const quote = quoteStripePayment(100, 'stripe', 'USD');
      return {
        invoiceId: ids.metadata.invoiceId,
        originalCents: quote.invoiceAmountCents,
        feeCents: quote.stripeFeeCents,
        chargeCents: ids.chargeCents || quote.stripeChargeAmountCents,
        currency: 'USD',
      };
    },
    recordPaid: async (ids, amounts) => {
      payments.push({
        paymentStatus: 'paid',
        amount: amounts.originalCents / 100,
        originalAmount: amounts.originalCents / 100,
        stripeProcessingFee: amounts.feeCents / 100,
        stripeChargeAmount: amounts.chargeCents / 100,
        currency: amounts.currency,
        paymentMethod: 'stripe',
        stripeCheckoutSessionId: ids.checkoutSessionId,
        stripePaymentIntentId: ids.paymentIntentId,
        transactionReference: ids.checkoutSessionId || ids.paymentIntentId,
      });
    },
    recordFailed: async (ids, amounts) => {
      payments.push({
        paymentStatus: 'failed',
        amount: amounts.originalCents / 100,
        originalAmount: amounts.originalCents / 100,
        stripeProcessingFee: amounts.feeCents / 100,
        stripeChargeAmount: amounts.chargeCents / 100,
        currency: amounts.currency,
        paymentMethod: 'stripe',
        stripeCheckoutSessionId: ids.checkoutSessionId,
        stripePaymentIntentId: ids.paymentIntentId,
        transactionReference: ids.checkoutSessionId || ids.paymentIntentId,
      });
    },
    saveExisting: async () => {},
    refreshBalances: async () => {},
  };
}

function checkoutCompleted({
  sessionId = 'cs_test_1',
  paymentIntentId = 'pi_test_1',
  invoiceId = 'inv_1',
  amountTotal = 10330,
} = {}) {
  const quote = quoteStripePayment(100, 'stripe', 'USD');
  return {
    type: 'checkout.session.completed',
    data: {
      object: {
        id: sessionId,
        payment_intent: paymentIntentId,
        payment_status: 'paid',
        amount_total: amountTotal,
        currency: 'usd',
        metadata: {
          invoiceId,
          invoiceAmountCents: String(quote.invoiceAmountCents),
          stripeFeeCents: String(quote.stripeFeeCents),
          stripeChargeAmountCents: String(quote.stripeChargeAmountCents),
        },
      },
    },
  };
}

function paymentIntentSucceeded({
  paymentIntentId = 'pi_test_1',
  invoiceId = 'inv_1',
  amount = 10330,
} = {}) {
  const quote = quoteStripePayment(100, 'stripe', 'USD');
  return {
    type: 'payment_intent.succeeded',
    data: {
      object: {
        id: paymentIntentId,
        amount,
        amount_received: amount,
        currency: 'usd',
        metadata: {
          invoiceId,
          invoiceAmountCents: String(quote.invoiceAmountCents),
        },
      },
    },
  };
}

function paymentIntentFailed({
  paymentIntentId = 'pi_test_fail',
  invoiceId = 'inv_1',
  amount = 10330,
} = {}) {
  return {
    type: 'payment_intent.payment_failed',
    data: {
      object: {
        id: paymentIntentId,
        amount,
        currency: 'usd',
        metadata: { invoiceId, invoiceAmountCents: '10000' },
      },
    },
  };
}

describe('successful Stripe payment', () => {
  it('records original amount, fee, and gross charge separately', async () => {
    const store = memoryStore();
    const result = await processStripeEvent(checkoutCompleted(), store);
    assert.equal(result.handled, true);
    assert.equal(store.payments.length, 1);
    const p = store.payments[0];
    assert.equal(p.paymentStatus, 'paid');
    assert.equal(p.paymentMethod, 'stripe');
    assert.equal(p.originalAmount, 100);
    assert.equal(p.amount, 100);
    assert.equal(p.stripeChargeAmount, 103.3);
    assert.equal(p.stripeProcessingFee, 3.3);
    assert.equal(p.stripeCheckoutSessionId, 'cs_test_1');
    assert.equal(p.stripePaymentIntentId, 'pi_test_1');
  });

  it('handles payment_intent.succeeded the same way', async () => {
    const store = memoryStore();
    const result = await processStripeEvent(paymentIntentSucceeded(), store);
    assert.equal(result.handled, true);
    assert.equal(store.payments[0].paymentStatus, 'paid');
    assert.equal(store.payments[0].amount, 100);
  });
});

describe('failed Stripe payment', () => {
  it('stores a failed record without treating it as paid', async () => {
    const store = memoryStore();
    const result = await processStripeEvent(paymentIntentFailed(), store);
    assert.equal(result.handled, true);
    assert.equal(result.failed, true);
    assert.equal(store.payments.length, 1);
    assert.equal(store.payments[0].paymentStatus, 'failed');
    assert.equal(store.payments[0].amount, 100);
  });
});

describe('duplicate webhook', () => {
  it('does not record checkout.session.completed twice', async () => {
    const store = memoryStore();
    const event = checkoutCompleted();
    const first = await processStripeEvent(event, store);
    const second = await processStripeEvent(event, store);
    assert.equal(first.handled, true);
    assert.equal(second.duplicate, true);
    assert.equal(store.payments.length, 1);
  });

  it('ignores payment_intent.succeeded after checkout.session.completed', async () => {
    const store = memoryStore();
    await processStripeEvent(checkoutCompleted(), store);
    const second = await processStripeEvent(paymentIntentSucceeded(), store);
    assert.equal(second.duplicate, true);
    assert.equal(store.payments.length, 1);
  });

  it('does not record a failed PaymentIntent twice', async () => {
    const store = memoryStore();
    const event = paymentIntentFailed();
    await processStripeEvent(event, store);
    const second = await processStripeEvent(event, store);
    assert.equal(second.duplicate, true);
    assert.equal(store.payments.length, 1);
  });
});
