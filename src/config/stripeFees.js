/**
 * Stripe processing-fee configuration and gross-up math.
 *
 * Defaults match typical US domestic card pricing (2.9% + $0.30). Stripe
 * pricing varies by account, country, card brand, currency, and method —
 * override via env rather than editing callers.
 *
 *   STRIPE_FEE_PERCENT      percent points, e.g. 2.9 for 2.9%
 *   STRIPE_FEE_FIXED_CENTS  fixed fee in the smallest currency unit (30 = $0.30)
 */

function parseNumber(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

export function getStripeFeeConfig(env = process.env) {
  const percent = parseNumber(env.STRIPE_FEE_PERCENT, 2.9);
  const fixedFeeCents = Math.round(parseNumber(env.STRIPE_FEE_FIXED_CENTS, 30));
  const percentRate = percent / 100;
  if (percentRate < 0 || percentRate >= 1) {
    throw new Error(
      `STRIPE_FEE_PERCENT must be between 0 and 100 (got ${percent})`,
    );
  }
  if (fixedFeeCents < 0) {
    throw new Error('STRIPE_FEE_FIXED_CENTS must be >= 0');
  }
  return { percent, percentRate, fixedFeeCents };
}

/**
 * ACH Direct Debit uses Stripe's own pricing model (a small percentage
 * capped per transaction), not the card gross-up formula — 0.8% capped at $5
 * by default, matching Stripe's standard ACH debit pricing.
 *
 *   STRIPE_ACH_FEE_PERCENT     percent points, e.g. 0.8 for 0.8%
 *   STRIPE_ACH_FEE_CAP_CENTS   cap in the smallest currency unit (500 = $5.00)
 */
export function getAchFeeConfig(env = process.env) {
  const percent = parseNumber(env.STRIPE_ACH_FEE_PERCENT, 0.8);
  const capCents = Math.round(parseNumber(env.STRIPE_ACH_FEE_CAP_CENTS, 500));
  const percentRate = percent / 100;
  if (percentRate < 0 || percentRate >= 1) {
    throw new Error(`STRIPE_ACH_FEE_PERCENT must be between 0 and 100 (got ${percent})`);
  }
  if (capCents < 0) {
    throw new Error('STRIPE_ACH_FEE_CAP_CENTS must be >= 0');
  }
  return { percent, percentRate, capCents };
}

export function dollarsToCents(amount) {
  return Math.round((Number(amount) || 0) * 100);
}

export function centsToDollars(cents) {
  return Math.round(Number(cents) || 0) / 100;
}

/**
 * Gross-up so that after Stripe takes `percentRate` + `fixedFeeCents`,
 * the net equals the original invoice amount (within one cent).
 *
 *   gross = round((invoice + fixed) / (1 - percentRate))
 */
export function calculateStripeGrossUp(invoiceAmountCents, config = getStripeFeeConfig()) {
  const original = Math.max(0, Math.round(Number(invoiceAmountCents) || 0));
  if (original <= 0) {
    return {
      invoiceAmountCents: 0,
      stripeFeeCents: 0,
      stripeChargeAmountCents: 0,
      percent: config.percent,
      fixedFeeCents: config.fixedFeeCents,
    };
  }

  const gross = Math.round((original + config.fixedFeeCents) / (1 - config.percentRate));
  const charge = Math.max(gross, original);
  return {
    invoiceAmountCents: original,
    stripeFeeCents: charge - original,
    stripeChargeAmountCents: charge,
    percent: config.percent,
    fixedFeeCents: config.fixedFeeCents,
  };
}

/** Stripe's own take on a charge: round(gross * rate) + fixed. */
export function estimatedStripeDeductionCents(chargeCents, config = getStripeFeeConfig()) {
  const charge = Math.round(Number(chargeCents) || 0);
  return Math.round(charge * config.percentRate) + config.fixedFeeCents;
}

/** ACH's capped-percentage fee, simply added on top (never a gross-up —
 *  the cap means the card formula's inverse-solve doesn't apply). */
export function calculateAchFee(invoiceAmountCents, config = getAchFeeConfig()) {
  const original = Math.max(0, Math.round(Number(invoiceAmountCents) || 0));
  if (original <= 0) {
    return {
      invoiceAmountCents: 0,
      stripeFeeCents: 0,
      stripeChargeAmountCents: 0,
      percent: config.percent,
      capCents: config.capCents,
    };
  }
  const fee = Math.min(Math.round(original * config.percentRate), config.capCents);
  return {
    invoiceAmountCents: original,
    stripeFeeCents: fee,
    stripeChargeAmountCents: original + fee,
    percent: config.percent,
    capCents: config.capCents,
  };
}

export function quoteStripePayment(
  invoiceAmount,
  paymentMethod = 'stripe',
  currency = 'USD',
  config = null,
) {
  const invoiceAmountCents = dollarsToCents(invoiceAmount);
  const method = String(paymentMethod || '').toLowerCase();
  const isStripe = method === 'stripe';
  const isAch = method === 'ach';
  const calc = isStripe
    ? calculateStripeGrossUp(invoiceAmountCents, config || getStripeFeeConfig())
    : isAch
      ? calculateAchFee(invoiceAmountCents, config || getAchFeeConfig())
      : {
          invoiceAmountCents,
          stripeFeeCents: 0,
          stripeChargeAmountCents: invoiceAmountCents,
          percent: 0,
          fixedFeeCents: 0,
        };

  return {
    invoiceAmountCents: calc.invoiceAmountCents,
    stripeFeeCents: calc.stripeFeeCents,
    stripeChargeAmountCents: calc.stripeChargeAmountCents,
    originalAmount: centsToDollars(calc.invoiceAmountCents),
    stripeProcessingFee: centsToDollars(calc.stripeFeeCents),
    stripeChargeAmount: centsToDollars(calc.stripeChargeAmountCents),
    currency: String(currency || 'USD').toUpperCase(),
    paymentMethod: isStripe ? 'stripe' : isAch ? 'ach' : method || 'other',
    percent: calc.percent,
    fixedFeeCents: calc.fixedFeeCents ?? 0,
    capCents: calc.capCents,
  };
}
