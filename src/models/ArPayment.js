import mongoose from 'mongoose';
import { AR_PAYMENT_METHODS } from '../constants/arConstants.js';

const arPaymentSchema = new mongoose.Schema(
  {
    invoiceId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'ArInvoice',
      required: true,
      index: true,
    },
    locationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Location',
      required: true,
      index: true,
    },
    paymentDate: { type: Date, required: true, index: true },
    // Amount applied to the invoice (original invoice / balance due). Never
    // overwritten by a Stripe gross-up — that lives on stripeChargeAmount.
    amount: { type: Number, required: true, min: 0.01 },
    originalAmount: { type: Number, default: null },
    stripeProcessingFee: { type: Number, default: 0 },
    stripeChargeAmount: { type: Number, default: null },
    currency: { type: String, default: 'USD', uppercase: true, trim: true },
    paymentMethod: { type: String, enum: AR_PAYMENT_METHODS, default: 'zelle' },
    paymentStatus: {
      type: String,
      enum: ['pending', 'paid', 'failed'],
      default: 'paid',
      index: true,
    },
    transactionReference: { type: String, default: '', trim: true },
    stripePaymentIntentId: { type: String, default: '', trim: true, index: true },
    stripeCheckoutSessionId: { type: String, default: '', trim: true, index: true },
    notes: { type: String, default: '' },
    attachmentUrl: { type: String, default: '' },
    recordedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    isDeleted: { type: Boolean, default: false, index: true },
  },
  { timestamps: true },
);

export default mongoose.model('ArPayment', arPaymentSchema);
