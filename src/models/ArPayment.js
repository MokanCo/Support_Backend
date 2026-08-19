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
    amount: { type: Number, required: true, min: 0.01 },
    paymentMethod: { type: String, enum: AR_PAYMENT_METHODS, default: 'zelle' },
    transactionReference: { type: String, default: '', trim: true },
    notes: { type: String, default: '' },
    attachmentUrl: { type: String, default: '' },
    recordedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    isDeleted: { type: Boolean, default: false, index: true },
  },
  { timestamps: true },
);

export default mongoose.model('ArPayment', arPaymentSchema);
