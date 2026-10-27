import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  calculateAchFee,
  calculateStripeGrossUp,
  centsToDollars,
  dollarsToCents,
  estimatedStripeDeductionCents,
  getAchFeeConfig,
  getStripeFeeConfig,
  quoteStripePayment,
} from '../src/config/stripeFees.js';

const CONFIG = getStripeFeeConfig({
  STRIPE_FEE_PERCENT: '2.9',
  STRIPE_FEE_FIXED_CENTS: '30',
});

const ACH_CONFIG = getAchFeeConfig({
  STRIPE_ACH_FEE_PERCENT: '0.8',
  STRIPE_ACH_FEE_CAP_CENTS: '500',
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

describe('manual payment methods (no Stripe involvement)', () => {
  for (const method of ['zelle', 'wire', 'check']) {
    it(`${method} does not add a fee`, () => {
      const q = quoteStripePayment(100, method, 'USD');
      assert.equal(q.stripeFeeCents, 0);
      assert.equal(q.stripeChargeAmountCents, 10000);
      assert.equal(q.stripeProcessingFee, 0);
      assert.equal(q.stripeChargeAmount, 100);
      assert.equal(q.paymentMethod, method);
    });
  }
});

describe('ACH fee (Stripe\'s capped-percentage pricing, 0.8% capped at $5)', () => {
  it('reads percent and cap cents from env', () => {
    const cfg = getAchFeeConfig({
      STRIPE_ACH_FEE_PERCENT: '1.2',
      STRIPE_ACH_FEE_CAP_CENTS: '750',
    });
    assert.equal(cfg.percent, 1.2);
    assert.equal(cfg.percentRate, 0.012);
    assert.equal(cfg.capCents, 750);
  });

  it('defaults to 0.8% capped at $5', () => {
    const cfg = getAchFeeConfig({});
    assert.equal(cfg.percent, 0.8);
    assert.equal(cfg.capCents, 500);
  });

  it('$100 invoice → 0.8% fee, well under the cap', () => {
    const q = quoteStripePayment(100, 'ach', 'USD', ACH_CONFIG);
    assert.equal(q.invoiceAmountCents, 10000);
    assert.equal(q.stripeFeeCents, 80);
    assert.equal(q.stripeChargeAmountCents, 10080);
    assert.equal(q.originalAmount, 100);
    assert.equal(q.stripeProcessingFee, 0.8);
    assert.equal(q.stripeChargeAmount, 100.8);
    assert.equal(q.paymentMethod, 'ach');
  });

  it('$10,000 invoice → fee capped at $5, not 0.8% ($80)', () => {
    const q = quoteStripePayment(10000, 'ach', 'USD', ACH_CONFIG);
    assert.equal(q.stripeFeeCents, 500);
    assert.equal(q.stripeChargeAmountCents, 1000500);
    assert.equal(q.stripeChargeAmount, 10005);
  });

  it('$0.00 yields a zero quote', () => {
    const q = quoteStripePayment(0, 'ach', 'USD', ACH_CONFIG);
    assert.equal(q.stripeChargeAmountCents, 0);
    assert.equal(q.stripeFeeCents, 0);
  });

  it('calculateAchFee never exceeds the cap regardless of amount', () => {
    const huge = calculateAchFee(dollarsToCents(1_000_000), ACH_CONFIG);
    assert.equal(huge.stripeFeeCents, ACH_CONFIG.capCents);
  });
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
