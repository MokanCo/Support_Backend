import mongoose from 'mongoose';

const arImportJobSchema = new mongoose.Schema(
  {
    importType: {
      type: String,
      enum: ['invoices', 'payments', 'partners', 'credits'],
      required: true,
    },
    fileName: { type: String, default: '' },
    status: {
      type: String,
      enum: ['uploaded', 'mapped', 'validated', 'importing', 'completed', 'failed'],
      default: 'uploaded',
    },
    columnMapping: { type: mongoose.Schema.Types.Mixed, default: {} },
    previewRows: { type: [mongoose.Schema.Types.Mixed], default: [] },
    totalRows: { type: Number, default: 0 },
    successCount: { type: Number, default: 0 },
    errorCount: { type: Number, default: 0 },
    errorRows: { type: [mongoose.Schema.Types.Mixed], default: [] },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    completedAt: { type: Date, default: null },
  },
  { timestamps: true },
);

export default mongoose.model('ArImportJob', arImportJobSchema);
