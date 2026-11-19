import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { isPaymentMethodTypeAllowed } from '../src/services/ar/arStripeService.js';

describe('isPaymentMethodTypeAllowed — cross-checks the resolved payment method against what this SetupIntent was created to accept', () => {
  it('allows a card when the SetupIntent was created for card only', () => {
    assert.equal(
      isPaymentMethodTypeAllowed({ payment_method_types: ['card'] }, 'card'),
      true,
    );
  });

  it('allows a bank account when the SetupIntent was created for us_bank_account only', () => {
    assert.equal(
      isPaymentMethodTypeAllowed({ payment_method_types: ['us_bank_account'] }, 'us_bank_account'),
      true,
    );
  });

  it('rejects a bank account resolving against a card-only SetupIntent (the case this guards against)', () => {
    assert.equal(
      isPaymentMethodTypeAllowed({ payment_method_types: ['card'] }, 'us_bank_account'),
      false,
    );
  });

  it('rejects a card resolving against a bank-only SetupIntent', () => {
    assert.equal(
      isPaymentMethodTypeAllowed({ payment_method_types: ['us_bank_account'] }, 'card'),
      false,
    );
  });

  it('rejects an unexpected payment method type entirely', () => {
    assert.equal(
      isPaymentMethodTypeAllowed({ payment_method_types: ['card'] }, 'sepa_debit'),
      false,
    );
  });

  it('fails open when the SetupIntent carries no payment_method_types at all', () => {
    assert.equal(isPaymentMethodTypeAllowed({}, 'card'), true);
    assert.equal(isPaymentMethodTypeAllowed(undefined, 'card'), true);
  });
});
