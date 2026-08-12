import mongoose from 'mongoose';
import { AR_DEFAULT_REMINDER_DAYS, AR_PAYMENT_METHODS } from '../constants/arConstants.js';

const arSettingsSchema = new mongoose.Schema(
  {
    key: { type: String, default: 'default', unique: true },
    invoiceNumberPrefix: { type: String, default: 'INV' },
    invoiceNumberIncludeYear: { type: Boolean, default: true },
    invoiceNumberPadding: { type: Number, default: 6 },
    defaultCurrency: { type: String, default: 'USD' },
    defaultPaymentTermsDays: { type: Number, default: 15 },
    defaultGracePeriodDays: { type: Number, default: 3 },
    defaultReminderDays: { type: [Number], default: () => [...AR_DEFAULT_REMINDER_DAYS] },
    lateFeeEnabled: { type: Boolean, default: false },
    lateFeeType: { type: String, enum: ['fixed', 'percent'], default: 'fixed' },
    lateFeeAmount: { type: Number, default: 0 },
    companyName: { type: String, default: 'Mokanco' },
    companyAddress: { type: String, default: '' },
    companyPhone: { type: String, default: '' },
    billingEmail: { type: String, default: '' },
    supportEmail: { type: String, default: '' },
    defaultNotes: { type: String, default: '' },
    paymentInstructions: {
      type: String,
      default: 'Please pay via Zelle using the instructions on your invoice.',
    },
    /**
     * Structured payment options shown on invoice emails (sent/reminder/overdue)
     * and on the secure payment page. `type` reuses AR_PAYMENT_METHODS — the
     * same enum ArPayment/ArPaymentSubmission use — so a method configured
     * here lines up with the value recorded against an actual payment.
     * recipientEmail/recipientPhone/qrCodeUrl are Zelle-oriented but left
     * generic (harmless if unused for other method types).
     */
    paymentMethods: {
      type: [
        {
          type: {
            type: String,
            enum: AR_PAYMENT_METHODS,
            required: true,
          },
          label: { type: String, required: true },
          details: { type: String, default: '' },
          recipientEmail: { type: String, default: '' },
          recipientPhone: { type: String, default: '' },
          qrCodeUrl: { type: String, default: '' },
          enabled: { type: Boolean, default: true },
        },
      ],
      default: [],
    },
    termsAndConditions: { type: String, default: '' },
    logoUrl: { type: String, default: '' },
  },
  { timestamps: true },
);

export default mongoose.model('ArSettings', arSettingsSchema);
