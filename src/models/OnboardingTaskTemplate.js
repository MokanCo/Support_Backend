import mongoose from 'mongoose';

const onboardingTaskTemplateSchema = new mongoose.Schema(
  {
    serviceTemplateId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'OnboardingServiceTemplate',
      required: true,
      index: true,
    },
    serviceSlug: { type: String, required: true, trim: true, lowercase: true, index: true },
    title: { type: String, required: true, trim: true },
    sortOrder: { type: Number, default: 0 },
  },
  { timestamps: true },
);

export default mongoose.model('OnboardingTaskTemplate', onboardingTaskTemplateSchema);
