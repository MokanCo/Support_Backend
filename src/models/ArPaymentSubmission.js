import mongoose from 'mongoose';
import { AR_PAYMENT_METHODS } from '../constants/arConstants.js';

/**
 * A partner's self-reported "I sent payment" claim — deliberately separate
 * from ArPayment (the real, balance-affecting payment ledger). Nothing here
 * touches an invoice's balance/status; only an admin approving it (which
 * calls the existing recordPayment()) does that. Keeps the untrusted partner
 * input from ever being treated as a verified payment.
 */
const arPaymentSubmissionSchema = new mongoose.Schema(
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
    submittedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    amount: { type: Number, required: true, min: 0.01 },
    paymentMethod: { type: String, enum: AR_PAYMENT_METHODS, default: 'zelle' },
    paymentDate: { type: Date, default: () => new Date() },
    transactionReference: { type: String, default: '', trim: true },
    notes: { type: String, default: '' },
    status: {
      type: String,
      enum: ['pending', 'approved', 'rejected'],
      default: 'pending',
      index: true,
    },
    reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    reviewedAt: { type: Date, default: null },
    reviewNote: { type: String, default: '' },
    /** Set once approved — the real ArPayment record this submission became. */
    resultingPaymentId: { type: mongoose.Schema.Types.ObjectId, ref: 'ArPayment', default: null },
  },
  { timestamps: true },
);

arPaymentSubmissionSchema.index({ status: 1, createdAt: -1 });

export default mongoose.model('ArPaymentSubmission', arPaymentSubmissionSchema);
