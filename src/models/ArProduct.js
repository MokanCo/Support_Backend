import mongoose from 'mongoose';

const arProductSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    description: { type: String, default: '', trim: true },
    category: { type: String, default: 'General', trim: true, index: true },
    price: { type: Number, required: true, min: 0 },
    taxable: { type: Boolean, default: false },
    taxPercentage: { type: Number, default: 0, min: 0, max: 100 },
    accountingCategory: { type: String, default: '', trim: true },
    isActive: { type: Boolean, default: true, index: true },
    isArchived: { type: Boolean, default: false, index: true },
    isDeleted: { type: Boolean, default: false, index: true },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: true },
);

arProductSchema.index({ name: 'text', description: 'text' });

export default mongoose.model('ArProduct', arProductSchema);
