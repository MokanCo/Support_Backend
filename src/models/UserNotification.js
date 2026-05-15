import mongoose from 'mongoose';

/**
 * In-app notifications persisted per user.
 * `channel`: `status` (ticket lifecycle, etc.) vs `sms` (future SMS alerts) — dismiss APIs scope by channel.
 * Collection: `user_notifications`
 */
const userNotificationSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    channel: {
      type: String,
      enum: ['status', 'sms'],
      required: true,
      index: true,
    },
    kind: { type: String, required: true },
    ticketId: { type: mongoose.Schema.Types.ObjectId, ref: 'Ticket', default: null, index: true },
    title: { type: String, required: true },
    body: { type: String, default: '' },
    dismissedAt: { type: Date, default: null, index: true },
  },
  { timestamps: true },
);

userNotificationSchema.index({ userId: 1, channel: 1, dismissedAt: 1, createdAt: -1 });

export default mongoose.model('UserNotification', userNotificationSchema, 'user_notifications');
