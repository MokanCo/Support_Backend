import mongoose from 'mongoose';

/**
 * @swagger
 * components:
 *   schemas:
 *     OnboardingConfig:
 *       type: object
 *       properties:
 *         brandName: { type: string }
 *         welcomeTitle: { type: string }
 *         welcomeDescription: { type: string }
 *         wizardTitle: { type: string }
 *         wizardSidebarTitle: { type: string }
 *         wizardSidebarDescription: { type: string }
 *         stepLabels:
 *           type: array
 *           items: { type: string }
 *         welcomeSteps:
 *           type: array
 *           items:
 *             type: object
 *             properties:
 *               num: { type: integer }
 *               label: { type: string }
 *         stepSubtitles:
 *           type: object
 *           additionalProperties: { type: string }
 *         successTitle: { type: string }
 *         successDescription: { type: string }
 *         successEmailNote: { type: string }
 *         enabled: { type: boolean }
 */
const welcomeStepSchema = new mongoose.Schema(
  {
    num: { type: Number, required: true },
    label: { type: String, required: true, trim: true },
  },
  { _id: false },
);

const onboardingConfigSchema = new mongoose.Schema(
  {
    key: { type: String, required: true, unique: true, default: 'default', trim: true },
    brandName: { type: String, default: '', trim: true },
    welcomeTitle: { type: String, default: '', trim: true },
    welcomeDescription: { type: String, default: '', trim: true },
    wizardTitle: { type: String, default: '', trim: true },
    wizardSidebarTitle: { type: String, default: '', trim: true },
    wizardSidebarDescription: { type: String, default: '', trim: true },
    stepLabels: { type: [String], default: [] },
    welcomeSteps: { type: [welcomeStepSchema], default: [] },
    stepSubtitles: { type: Map, of: String, default: () => new Map() },
    successTitle: { type: String, default: '', trim: true },
    successDescription: { type: String, default: '', trim: true },
    successEmailNote: { type: String, default: '', trim: true },
    enabled: { type: Boolean, default: false },
  },
  { timestamps: true },
);

export default mongoose.model('OnboardingConfig', onboardingConfigSchema);
