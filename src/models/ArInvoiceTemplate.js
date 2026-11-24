import mongoose from 'mongoose';
import { AR_INVOICE_BLOCK_TYPES } from '../constants/arConstants.js';

const blockSchema = new mongoose.Schema(
  {
    id: { type: String, required: true },
    type: { type: String, required: true, enum: AR_INVOICE_BLOCK_TYPES },
    enabled: { type: Boolean, default: true },
    label: { type: String, default: '' },
    /** Free text for custom_text blocks (and optional override titles). */
    content: { type: String, default: '' },
    align: { type: String, enum: ['left', 'center', 'right'], default: 'left' },
    fontSize: { type: Number, default: 10, min: 8, max: 24 },
  },
  { _id: false },
);

const arInvoiceTemplateSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    description: { type: String, default: '', trim: true },
    isDefault: { type: Boolean, default: false, index: true },
    isActive: { type: Boolean, default: true, index: true },
    blocks: { type: [blockSchema], default: [] },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    isDeleted: { type: Boolean, default: false, index: true },
  },
  { timestamps: true },
);

arInvoiceTemplateSchema.index({ name: 1 });

export default mongoose.model('ArInvoiceTemplate', arInvoiceTemplateSchema);
