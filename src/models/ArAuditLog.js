import mongoose from 'mongoose';

const arAuditLogSchema = new mongoose.Schema(
  {
    entityType: { type: String, required: true, index: true },
    entityId: { type: String, default: '', index: true },
    action: { type: String, required: true, index: true },
    description: { type: String, default: '' },
    previousValue: { type: mongoose.Schema.Types.Mixed, default: null },
    newValue: { type: mongoose.Schema.Types.Mixed, default: null },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    userName: { type: String, default: '' },
    ipAddress: { type: String, default: '' },
  },
  { timestamps: true },
);

arAuditLogSchema.index({ createdAt: -1 });

export default mongoose.model('ArAuditLog', arAuditLogSchema);
