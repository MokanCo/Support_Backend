import mongoose from 'mongoose';

export const ONBOARDING_STATUSES = [
  'draft',
  'pending',
  'in_progress',
  'completed',
  'rejected',
];

const personalSchema = new mongoose.Schema(
  {
    firstName: { type: String, required: true, trim: true },
    lastName: { type: String, required: true, trim: true },
    email: { type: String, required: true, lowercase: true, trim: true },
    phone: { type: String, required: true, trim: true },
    address: { type: String, required: true, trim: true },
    city: { type: String, default: '', trim: true },
    state: { type: String, default: '', trim: true },
    zip: { type: String, default: '', trim: true },
  },
  { _id: false },
);

const locationSchema = new mongoose.Schema(
  {
    locationName: { type: String, required: true, trim: true },
    locationEmail: { type: String, required: true, lowercase: true, trim: true },
    locationPhone: { type: String, required: true, trim: true },
    openingDate: { type: String, required: true, trim: true },
    address: { type: String, required: true, trim: true },
    city: { type: String, default: '', trim: true },
    state: { type: String, default: '', trim: true },
    zip: { type: String, default: '', trim: true },
    country: { type: String, default: '', trim: true },
    businessCategory: { type: String, default: '', trim: true },
  },
  { _id: false },
);

const onboardingRequestSchema = new mongoose.Schema(
  {
    trackingId: {
      type: String,
      unique: true,
      sparse: true,
      trim: true,
      index: true,
    },
    trackingToken: { type: String, required: true, unique: true, index: true },
    status: {
      type: String,
      enum: ONBOARDING_STATUSES,
      default: 'pending',
      index: true,
    },
    personal: { type: personalSchema, required: true },
    additionalPartners: { type: [personalSchema], default: [] },
    location: { type: locationSchema, required: true },
    businessName: { type: String, default: '', trim: true },
    website: { type: String, default: '', trim: true },
    notes: { type: String, default: '', trim: true },
    selectedServices: { type: [String], default: [] },
    submittedAt: { type: Date, default: null, index: true },
    reviewNotes: { type: String, default: '', trim: true },
    reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    reviewedByName: { type: String, default: '', trim: true },
    reviewedAt: { type: Date, default: null },
    approvedAt: { type: Date, default: null },
    completedAt: { type: Date, default: null },
    locationId: { type: mongoose.Schema.Types.ObjectId, ref: 'Location', default: null },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    progressPercent: { type: Number, default: 0, min: 0, max: 100 },
  },
  { timestamps: true },
);

export default mongoose.model('OnboardingRequest', onboardingRequestSchema);
