import mongoose from 'mongoose';

const receptionistSmsMessageSchema = new mongoose.Schema(
  {
    bandwidthMessageId: { type: String, required: true, unique: true, trim: true, maxlength: 128 },
    fromNumber: { type: String, required: true, trim: true },
    toNumber: { type: String, required: true, trim: true },
    messageText: { type: String, default: '', maxlength: 8000 },
    direction: { type: String, enum: ['inbound', 'outbound'], required: true },
    status: { type: String, enum: ['received', 'read'], default: 'received' },
    receivedAt: { type: Date, required: true },
    readAt: { type: Date, default: null },
    mediaUrls: { type: [String], default: [] },
  },
  { timestamps: true },
);

receptionistSmsMessageSchema.index({ fromNumber: 1, receivedAt: -1 });
receptionistSmsMessageSchema.index({ toNumber: 1, receivedAt: -1 });
receptionistSmsMessageSchema.index({ receivedAt: -1 });
receptionistSmsMessageSchema.index({ status: 1, receivedAt: -1 });

export default mongoose.model(
  'ReceptionistSmsMessage',
  receptionistSmsMessageSchema,
  'receptionist_sms_messages',
);
