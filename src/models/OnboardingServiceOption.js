import mongoose from 'mongoose';

/**
 * @swagger
 * components:
 *   schemas:
 *     OnboardingServiceOption:
 *       type: object
 *       properties:
 *         id: { type: string }
 *         slug: { type: string, example: 'google' }
 *         title: { type: string, example: 'Google' }
 *         section: { type: string, example: 'Business Listing' }
 *         iconKey: { type: string, example: 'globe' }
 *         iconClass: { type: string, example: 'bg-blue-100 text-blue-600' }
 *         sortOrder: { type: integer, example: 0 }
 *         isActive: { type: boolean, example: true }
 */
const onboardingServiceOptionSchema = new mongoose.Schema(
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

export default mongoose.model('OnboardingServiceOption', onboardingServiceOptionSchema);
