import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  calculateStripeGrossUp,
  centsToDollars,
  dollarsToCents,
  estimatedStripeDeductionCents,
  getStripeFeeConfig,
  quoteStripePayment,
} from '../src/config/stripeFees.js';

const CONFIG = getStripeFeeConfig({
  STRIPE_FEE_PERCENT: '2.9',
  STRIPE_FEE_FIXED_CENTS: '30',
});

function assertNetEqualsOriginal(invoiceDollars) {
  const cents = dollarsToCents(invoiceDollars);
  const { stripeChargeAmountCents, stripeFeeCents, invoiceAmountCents } =
    calculateStripeGrossUp(cents, CONFIG);
  assert.equal(invoiceAmountCents, cents);
  assert.equal(stripeChargeAmountCents - stripeFeeCents, cents);

  const deducted = estimatedStripeDeductionCents(stripeChargeAmountCents, CONFIG);
  const net = stripeChargeAmountCents - deducted;
  assert.ok(
    Math.abs(net - cents) <= 1,
    `expected net ${net} within 1¢ of original ${cents} (charge ${stripeChargeAmountCents}, stripe take ${deducted})`,
  );
}

describe('Stripe fee configuration', () => {
  it('reads percent and fixed cents from env without scattering literals', () => {
    const cfg = getStripeFeeConfig({
      STRIPE_FEE_PERCENT: '3.5',
      STRIPE_FEE_FIXED_CENTS: '25',
    });
    assert.equal(cfg.percent, 3.5);
    assert.equal(cfg.percentRate, 0.035);
    assert.equal(cfg.fixedFeeCents, 25);
  });

  it('defaults to 2.9% + $0.30', () => {
    const cfg = getStripeFeeConfig({});
    assert.equal(cfg.percent, 2.9);
    assert.equal(cfg.fixedFeeCents, 30);
  });
});

describe('currency rounding', () => {
  it('converts dollars to integer cents without float drift', () => {
    assert.equal(dollarsToCents(100), 10000);
    assert.equal(dollarsToCents(19.99), 1999);
    assert.equal(dollarsToCents(0.1 + 0.2), 30);
    assert.equal(centsToDollars(10330), 103.3);
    assert.equal(centsToDollars(51524), 515.24);
  });
});

describe('gross-up formula (Stripe selected)', () => {
  it('$100 invoice → customer charged so net is $100', () => {
    const q = quoteStripePayment(100, 'stripe', 'USD', CONFIG);
    // (100 + 0.30) / (1 - 0.029) = 103.295... → $103.30
    assert.equal(q.invoiceAmountCents, 10000);
    assert.equal(q.stripeChargeAmountCents, 10330);
    assert.equal(q.stripeFeeCents, 330);
    assert.equal(q.originalAmount, 100);
    assert.equal(q.stripeChargeAmount, 103.3);
    assert.equal(q.stripeProcessingFee, 3.3);
    assertNetEqualsOriginal(100);
  });

  it('$500 invoice matches the customer-facing example', () => {
    const q = quoteStripePayment(500, 'stripe', 'USD', CONFIG);
    // (500 + 0.30) / 0.971 ≈ 515.24
    assert.equal(q.originalAmount, 500);
    assert.equal(q.stripeChargeAmount, 515.24);
    assert.equal(q.stripeProcessingFee, 15.24);
    assertNetEqualsOriginal(500);
  });

  it('$1,000 invoice', () => {
    assertNetEqualsOriginal(1000);
    const q = quoteStripePayment(1000, 'stripe', 'USD', CONFIG);
    assert.equal(q.invoiceAmountCents, 100000);
    assert.equal(q.stripeChargeAmountCents - q.stripeFeeCents, 100000);
  });

  it('$20,000 invoice', () => {
    assertNetEqualsOriginal(20000);
    const q = quoteStripePayment(20000, 'stripe', 'USD', CONFIG);
    assert.equal(q.originalAmount, 20000);
    assert.equal(
      q.stripeChargeAmountCents - q.stripeFeeCents,
      q.invoiceAmountCents,
    );
  });

  it('does not simply add 2.9% (that would under-collect)', () => {
    const naive = Math.round((100 * 1.029 + 0.3) * 100);
    const q = quoteStripePayment(100, 'stripe', 'USD', CONFIG);
    assert.notEqual(q.stripeChargeAmountCents, naive);
    assert.ok(q.stripeChargeAmountCents > naive);
  });
});

describe('non-Stripe payment selected', () => {
  for (const method of ['zelle', 'ach', 'wire', 'check']) {
    it(`${method} does not add a Stripe fee`, () => {
      const q = quoteStripePayment(100, method, 'USD', CONFIG);
      assert.equal(q.stripeFeeCents, 0);
      assert.equal(q.stripeChargeAmountCents, 10000);
      assert.equal(q.stripeProcessingFee, 0);
      assert.equal(q.stripeChargeAmount, 100);
      assert.equal(q.paymentMethod, method);
    });
  }
});

describe('very small invoice amounts', () => {
  it('$1.00 still nets the original after Stripe\'s take', () => {
    assertNetEqualsOriginal(1);
  });

  it('$0.50 still nets the original after Stripe\'s take', () => {
    assertNetEqualsOriginal(0.5);
  });

  it('$0.00 yields a zero quote', () => {
    const q = quoteStripePayment(0, 'stripe', 'USD', CONFIG);
    assert.equal(q.stripeChargeAmountCents, 0);
    assert.equal(q.stripeFeeCents, 0);
  });
});
