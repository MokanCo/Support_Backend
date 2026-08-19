import mongoose from 'mongoose';
import { AR_FREQUENCIES, AR_DEFAULT_REMINDER_DAYS } from '../constants/arConstants.js';

const arBillingProfileSchema = new mongoose.Schema(
  {
    locationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Location',
      required: true,
      unique: true,
      index: true,
    },
    billingEmail: { type: String, default: '', lowercase: true, trim: true },
    secondaryBillingEmail: { type: String, default: '', lowercase: true, trim: true },
    phone: { type: String, default: '', trim: true },
    billingAddress: {
      line1: { type: String, default: '' },
      line2: { type: String, default: '' },
      city: { type: String, default: '' },
      state: { type: String, default: '' },
      zip: { type: String, default: '' },
      country: { type: String, default: 'US' },
    },
    paymentTermsDays: { type: Number, default: 15 },
    billingFrequency: { type: String, enum: AR_FREQUENCIES, default: 'monthly' },
    currency: { type: String, default: 'USD' },
    paymentMethod: { type: String, default: 'zelle' },
    gracePeriodDays: { type: Number, default: 3 },
    reminderDays: { type: [Number], default: () => [...AR_DEFAULT_REMINDER_DAYS] },
    autoGenerateInvoice: { type: Boolean, default: true },
    autoSendInvoice: { type: Boolean, default: true },
    lateFeeEnabled: { type: Boolean, default: false },
    lateFeeType: { type: String, enum: ['fixed', 'percent'], default: 'fixed' },
    lateFeeAmount: { type: Number, default: 0 },
    internalNotes: { type: String, default: '' },
    isDeleted: { type: Boolean, default: false },
  },
  { timestamps: true },
);

export default mongoose.model('ArBillingProfile', arBillingProfileSchema);
