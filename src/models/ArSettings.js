import mongoose from 'mongoose';
import { AR_DEFAULT_REMINDER_DAYS } from '../constants/arConstants.js';

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
    termsAndConditions: { type: String, default: '' },
    logoUrl: { type: String, default: '' },
  },
  { timestamps: true },
);

export default mongoose.model('ArSettings', arSettingsSchema);
