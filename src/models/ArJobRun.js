import mongoose from 'mongoose';

const arJobRunSchema = new mongoose.Schema(
  {
    jobName: { type: String, required: true, index: true },
    status: {
      type: String,
      enum: ['running', 'success', 'failed'],
      default: 'running',
      index: true,
    },
    startedAt: { type: Date, default: Date.now },
    finishedAt: { type: Date, default: null },
    processedCount: { type: Number, default: 0 },
    successCount: { type: Number, default: 0 },
    failureCount: { type: Number, default: 0 },
    details: { type: String, default: '' },
    errorMessage: { type: String, default: '' },
  },
  { timestamps: true },
);

export default mongoose.model('ArJobRun', arJobRunSchema);
