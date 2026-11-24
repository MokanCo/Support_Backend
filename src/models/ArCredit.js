import mongoose from 'mongoose';
import { AR_CREDIT_TYPES } from '../constants/arConstants.js';

const arCreditSchema = new mongoose.Schema(
  {
    locationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Location',
      required: true,
      index: true,
    },
    invoiceId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'ArInvoice',
      default: null,
    },
    type: { type: String, enum: AR_CREDIT_TYPES, required: true },
    amount: { type: Number, required: true, min: 0.01 },
    remainingAmount: { type: Number, required: true, min: 0 },
    reason: { type: String, default: '', trim: true },
    creditDate: { type: Date, required: true },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    isDeleted: { type: Boolean, default: false, index: true },
  },
  { timestamps: true },
);

export default mongoose.model('ArCredit', arCreditSchema);
