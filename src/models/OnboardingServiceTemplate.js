import mongoose from 'mongoose';

const onboardingServiceTemplateSchema = new mongoose.Schema(
  {
    slug: { type: String, required: true, unique: true, trim: true, lowercase: true },
    title: { type: String, required: true, trim: true },
    section: { type: String, required: true, trim: true },
    iconKey: { type: String, required: true, trim: true },
    iconClass: { type: String, required: true, trim: true },
    sortOrder: { type: Number, default: 0 },
    isActive: { type: Boolean, default: true, index: true },
  },
  { timestamps: true },
);

export default mongoose.model('OnboardingServiceTemplate', onboardingServiceTemplateSchema);
