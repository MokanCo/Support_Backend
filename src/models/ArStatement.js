import mongoose from 'mongoose';

const statementLineSchema = new mongoose.Schema(
  {
    date: { type: Date, required: true },
    type: {
      type: String,
      enum: ['invoice', 'payment', 'credit', 'late_fee', 'opening', 'closing'],
      required: true,
    },
    reference: { type: String, default: '' },
    description: { type: String, default: '' },
    amount: { type: Number, default: 0 },
    balance: { type: Number, default: 0 },
  },
  { _id: false },
);

const arStatementSchema = new mongoose.Schema(
  {
    locationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Location',
      required: true,
      index: true,
    },
    periodStart: { type: Date, required: true },
    periodEnd: { type: Date, required: true },
    openingBalance: { type: Number, default: 0 },
    closingBalance: { type: Number, default: 0 },
    lines: { type: [statementLineSchema], default: [] },
    pdfUrl: { type: String, default: '' },
    emailedAt: { type: Date, default: null },
    generatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    isDeleted: { type: Boolean, default: false },
  },
  { timestamps: true },
);

arStatementSchema.index({ locationId: 1, periodStart: 1, periodEnd: 1 });

export default mongoose.model('ArStatement', arStatementSchema);
