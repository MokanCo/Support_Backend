import mongoose from 'mongoose';

const onboardingRequestTaskSchema = new mongoose.Schema(
  {
    requestId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'OnboardingRequest',
      required: true,
      index: true,
    },
    serviceSlug: { type: String, required: true, trim: true, lowercase: true, index: true },
    serviceTitle: { type: String, required: true, trim: true },
    taskTemplateId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'OnboardingTaskTemplate',
      default: null,
    },
    title: { type: String, required: true, trim: true },
    sortOrder: { type: Number, default: 0 },
    completed: { type: Boolean, default: false, index: true },
    completedAt: { type: Date, default: null },
    completedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    completedByName: { type: String, default: '', trim: true },
    publicComment: { type: String, default: '', trim: true },
    internalNote: { type: String, default: '', trim: true },
    issueDescription: { type: String, default: '', trim: true },
    resolution: { type: String, default: '', trim: true },
    attachmentUrl: { type: String, default: '', trim: true },
  },
  { timestamps: true },
);

export default mongoose.model('OnboardingRequestTask', onboardingRequestTaskSchema);
