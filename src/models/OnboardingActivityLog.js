import mongoose from 'mongoose';

const onboardingActivityLogSchema = new mongoose.Schema(
  {
    requestId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'OnboardingRequest',
      required: true,
      index: true,
    },
    eventType: { type: String, required: true, trim: true, index: true },
    title: { type: String, required: true, trim: true },
    description: { type: String, default: '', trim: true },
    isPublic: { type: Boolean, default: true, index: true },
    serviceSlug: { type: String, default: '', trim: true },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    createdByName: { type: String, default: '', trim: true },
  },
  { timestamps: true },
);

export default mongoose.model('OnboardingActivityLog', onboardingActivityLogSchema);
