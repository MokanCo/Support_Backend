import mongoose from 'mongoose';
import { AR_FREQUENCIES } from '../constants/arConstants.js';

const templateItemSchema = new mongoose.Schema(
  {
    productId: { type: mongoose.Schema.Types.ObjectId, ref: 'ArProduct', default: null },
    name: { type: String, required: true },
    description: { type: String, default: '' },
    quantity: { type: Number, default: 1, min: 0 },
    unitPrice: { type: Number, required: true, min: 0 },
    taxable: { type: Boolean, default: false },
    taxPercentage: { type: Number, default: 0 },
  },
  { _id: true },
);

const arRecurringTemplateSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    locationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Location',
      required: true,
      index: true,
    },
    items: { type: [templateItemSchema], default: [] },
    frequency: { type: String, enum: AR_FREQUENCIES, required: true },
    customIntervalDays: { type: Number, default: null },
    startDate: { type: Date, required: true },
    endDate: { type: Date, default: null },
    nextRunDate: { type: Date, required: true, index: true },
    dueAfterDays: { type: Number, default: 15 },
    autoGenerate: { type: Boolean, default: true },
    autoSend: { type: Boolean, default: true },
    reminderDays: { type: [Number], default: [] },
    lateFeeEnabled: { type: Boolean, default: false },
    lateFeeType: { type: String, enum: ['fixed', 'percent'], default: 'fixed' },
    lateFeeAmount: { type: Number, default: 0 },
    notes: { type: String, default: '' },
    isActive: { type: Boolean, default: true, index: true },
    isDeleted: { type: Boolean, default: false, index: true },
    lastGeneratedAt: { type: Date, default: null },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: true },
);

export default mongoose.model('ArRecurringTemplate', arRecurringTemplateSchema);
