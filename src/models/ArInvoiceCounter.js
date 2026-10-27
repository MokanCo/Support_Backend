import mongoose from 'mongoose';

const arInvoiceCounterSchema = new mongoose.Schema(
  {
    year: { type: Number, required: true, unique: true },
    seq: { type: Number, default: 0 },
  },
  { timestamps: true },
);

export default mongoose.model('ArInvoiceCounter', arInvoiceCounterSchema);
