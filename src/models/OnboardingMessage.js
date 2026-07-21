import mongoose from 'mongoose';

const onboardingMessageSchema = new mongoose.Schema(
  {
    requestId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'OnboardingRequest',
      required: true,
      index: true,
    },
    senderType: {
      type: String,
      enum: ['customer', 'admin'],
      required: true,
      index: true,
    },
    senderId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    senderName: { type: String, required: true, trim: true, maxlength: 200 },
    text: { type: String, required: true, trim: true, maxlength: 10000 },
  },
  { timestamps: true },
);

onboardingMessageSchema.index({ requestId: 1, createdAt: 1 });

export default mongoose.model('OnboardingMessage', onboardingMessageSchema);
