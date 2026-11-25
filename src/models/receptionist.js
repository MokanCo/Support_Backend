import mongoose from 'mongoose';

export const KNOWLEDGE_CATEGORIES = [
  'Company information',
  'General FAQs',
  'Menu information',
  'Menu prices',
  'Promotions',
  'Opening hours',
  'Branch policies',
  'Delivery information',
  'Pickup information',
  'Customer service policies',
  'Other frequently asked questions',
];

export const AGENT_VOICES = ['alloy', 'ash', 'ballad', 'coral', 'echo', 'sage', 'shimmer', 'verse'];
export const VOICE_SPEEDS = ['slow', 'natural', 'brisk'];
export const SPEAKING_STYLES = ['clear', 'warm', 'concise'];
export const TONES = ['professional', 'friendly', 'formal'];

const scheduleRow = new mongoose.Schema(
  {
    day: { type: String, enum: ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'], required: true },
    closed: { type: Boolean, default: false },
    open: { type: String, default: '' },
    close: { type: String, default: '' },
  },
  { _id: false },
);

const agentSchema = new mongoose.Schema(
  {
    locationId: { type: mongoose.Schema.Types.ObjectId, ref: 'Location', default: null, unique: true },
    agentName: { type: String, default: 'Moka', trim: true, maxlength: 60 },
    voice: { type: String, enum: AGENT_VOICES, default: 'alloy' },
    voiceSpeed: { type: String, enum: VOICE_SPEEDS, default: 'natural' },
    language: { type: String, default: 'en', trim: true, maxlength: 12 },
    speakingStyle: { type: String, enum: SPEAKING_STYLES, default: 'clear' },
    tone: { type: String, enum: TONES, default: 'professional' },
    greeting: {
      type: String,
      default: 'Thank you for calling Moka & Co. How can I help you today?',
      maxlength: 500,
    },
    maxCallDurationSec: { type: Number, default: 600, min: 60, max: 3600 },
    silenceTimeoutSec: { type: Number, default: 8, min: 3, max: 30 },
    repeatHandling: { type: String, default: 'Offer to repeat once, then transfer', maxlength: 300 },
    interruptionHandling: { type: String, default: 'Stop speaking and listen', maxlength: 300 },
    unknownQuestionHandling: {
      type: String,
      default: 'Say the answer cannot be confirmed, then offer a transfer',
      maxlength: 300,
    },
    escalationRules: {
      type: String,
      default:
        'Transfer for a manager, an employee, a complaint, missing information, frustration, or an order request',
      maxlength: 500,
    },
    complaintHandling: { type: String, default: 'Acknowledge and offer branch staff', maxlength: 300 },
    afterHoursBehavior: {
      type: String,
      default: 'Share approved hours and offer a transfer when a fallback number exists',
      maxlength: 500,
    },
    aiEnabled: { type: Boolean, default: false },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: true },
);

const knowledgeSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true, maxlength: 180 },
    body: { type: String, required: true, trim: true, maxlength: 20000 },
    category: { type: String, enum: KNOWLEDGE_CATEGORIES, required: true },
    scope: { type: String, enum: ['global', 'branch'], required: true },
    locationId: { type: mongoose.Schema.Types.ObjectId, ref: 'Location', default: null },
    approved: { type: Boolean, default: true },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: true },
);
knowledgeSchema.index({ scope: 1, locationId: 1, category: 1 });

const profileSchema = new mongoose.Schema(
  {
    locationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Location',
      required: true,
      unique: true,
    },
    openingHours: {
      timezone: { type: String, default: 'America/New_York' },
      schedule: { type: [scheduleRow], default: undefined },
    },
    holidayHours: { type: String, default: '', maxlength: 2000 },
    services: { type: String, default: '', maxlength: 4000 },
    policies: { type: String, default: '', maxlength: 4000 },
    faqs: { type: String, default: '', maxlength: 8000 },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: true },
);

const turnSchema = new mongoose.Schema(
  {
    speaker: { type: String, enum: ['caller', 'ai', 'system'], required: true },
    text: { type: String, default: '', maxlength: 2000 },
    at: { type: Date, default: Date.now },
  },
  { _id: false },
);

const callSchema = new mongoose.Schema(
  {
    callSid: { type: String, default: '', index: true },
    from: { type: String, default: '' },
    to: { type: String, default: '' },
    normalizedTo: { type: String, default: '', index: true },
    locationId: { type: mongoose.Schema.Types.ObjectId, ref: 'Location', default: null, index: true },
    phoneNumberId: { type: mongoose.Schema.Types.ObjectId, ref: 'BranchPhoneNumber', default: null },
    startedAt: { type: Date, default: Date.now, index: true },
    endedAt: { type: Date, default: null },
    durationSeconds: { type: Number, default: 0 },
    handling: { type: String, enum: ['ai', 'human', 'missed'], default: 'ai' },
    outcome: {
      type: String,
      enum: ['in_progress', 'answered', 'transferred', 'missed', 'unresolved'],
      default: 'in_progress',
    },
    transferStatus: {
      type: String,
      enum: ['none', 'requested', 'completed', 'failed'],
      default: 'none',
    },
    resolutionStatus: {
      type: String,
      enum: ['pending', 'resolved', 'unresolved'],
      default: 'pending',
    },
    summary: { type: String, default: '', maxlength: 1000 },
    turns: { type: [turnSchema], default: [] },
    recording: {
      sid: { type: String, default: '' },
      url: { type: String, default: '' },
      contentType: { type: String, default: '' },
      durationSeconds: { type: Number, default: 0 },
      storedAt: { type: Date, default: null },
    },
    recordingDisclosed: { type: Boolean, default: false },
    silenceCount: { type: Number, default: 0 },
    fallbackUsed: { type: Boolean, default: false },
  },
  { timestamps: true },
);
callSchema.index({ locationId: 1, startedAt: -1 });

const settingSchema = new mongoose.Schema(
  {
    key: { type: String, default: 'default', unique: true },
    recordingEnabled: { type: Boolean, default: false },
    retentionDays: { type: Number, default: 30, min: 1, max: 3650 },
    disclosureMessage: {
      type: String,
      default: 'This call may be recorded for quality and training.',
      maxlength: 300,
    },
    notifyEmail: { type: String, default: '', maxlength: 160 },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: true },
);

const auditSchema = new mongoose.Schema(
  {
    actorId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    action: { type: String, required: true },
    entityType: { type: String, required: true },
    entityId: { type: String, default: '' },
    locationId: { type: mongoose.Schema.Types.ObjectId, ref: 'Location', default: null },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

export const AiAgentConfig = mongoose.model('AiAgentConfig', agentSchema, 'ai_agent_configs');
export const KnowledgeEntry = mongoose.model('KnowledgeEntry', knowledgeSchema, 'knowledge_entries');
export const BranchProfile = mongoose.model('BranchProfile', profileSchema, 'branch_profiles');
export const ReceptionistCall = mongoose.model('ReceptionistCall', callSchema, 'receptionist_calls');
export const ReceptionistSetting = mongoose.model(
  'ReceptionistSetting',
  settingSchema,
  'receptionist_settings',
);
export const ReceptionistAudit = mongoose.model('ReceptionistAudit', auditSchema, 'receptionist_audits');

/**
 * @swagger
 * components:
 *   schemas:
 *     AgentSettings:
 *       type: object
 *       properties:
 *         locationId: { type: string, nullable: true }
 *         scope: { type: string, enum: [global, branch] }
 *         inheritsGlobal: { type: boolean }
 *         agentName: { type: string, example: Moka }
 *         voice: { type: string, enum: [alloy, ash, ballad, coral, echo, sage, shimmer, verse] }
 *         voiceSpeed: { type: string, enum: [slow, natural, brisk] }
 *         language: { type: string, example: en }
 *         speakingStyle: { type: string, enum: [clear, warm, concise] }
 *         tone: { type: string, enum: [professional, friendly, formal] }
 *         greeting: { type: string }
 *         maxCallDurationSec: { type: integer, minimum: 60, maximum: 3600 }
 *         silenceTimeoutSec: { type: integer, minimum: 3, maximum: 30 }
 *         repeatHandling: { type: string }
 *         interruptionHandling: { type: string }
 *         unknownQuestionHandling: { type: string }
 *         escalationRules: { type: string }
 *         complaintHandling: { type: string }
 *         afterHoursBehavior: { type: string }
 *         aiEnabled: { type: boolean }
 *         updatedAt: { type: string, format: date-time }
 *     KnowledgeEntry:
 *       type: object
 *       properties:
 *         id: { type: string }
 *         title: { type: string }
 *         body: { type: string }
 *         category:
 *           type: string
 *           enum: ["Company information", "General FAQs", "Menu information", "Menu prices", "Promotions", "Opening hours", "Branch policies", "Delivery information", "Pickup information", "Customer service policies", "Other frequently asked questions"]
 *         scope: { type: string, enum: [global, branch] }
 *         locationId: { type: string, nullable: true }
 *         branchName: { type: string }
 *         approved: { type: boolean, example: true }
 *         updatedAt: { type: string, format: date-time }
 *     KnowledgeImportEntry:
 *       type: object
 *       properties:
 *         index: { type: integer }
 *         title: { type: string }
 *         body: { type: string, description: Approved answer }
 *         category: { type: string }
 *         scope: { type: string, enum: [global, branch, ''] }
 *         valid: { type: boolean }
 *         duplicate: { type: boolean }
 *         duplicateOf: { type: string, nullable: true, enum: [file, database] }
 *         errors:
 *           type: array
 *           items: { type: string }
 *     KnowledgeImportPreview:
 *       type: object
 *       properties:
 *         kind: { type: string, enum: [faq, legacy] }
 *         parseError: { type: string }
 *         total: { type: integer, description: Entries detected }
 *         valid: { type: integer }
 *         invalid: { type: integer }
 *         duplicates: { type: integer }
 *         byCategory:
 *           type: array
 *           items:
 *             type: object
 *             properties:
 *               category: { type: string }
 *               total: { type: integer }
 *               valid: { type: integer }
 *         entries:
 *           type: array
 *           items: { $ref: '#/components/schemas/KnowledgeImportEntry' }
 *     KnowledgeImportResult:
 *       type: object
 *       properties:
 *         imported: { type: integer, description: Same as created. Kept for existing clients. }
 *         created: { type: integer, description: Records created }
 *         skipped:
 *           type: array
 *           items:
 *             type: object
 *             properties:
 *               index: { type: integer }
 *               title: { type: string }
 *               errors:
 *                 type: array
 *                 items: { type: string }
 *         duplicates:
 *           type: array
 *           items:
 *             type: object
 *             properties:
 *               index: { type: integer }
 *               title: { type: string }
 *               reason: { type: string }
 *         failed:
 *           type: array
 *           items:
 *             type: object
 *             properties:
 *               index: { type: integer }
 *               title: { type: string }
 *               error: { type: string }
 *         entries:
 *           type: array
 *           items: { $ref: '#/components/schemas/KnowledgeEntry' }
 *     BranchReceptionistProfile:
 *       type: object
 *       properties:
 *         locationId: { type: string }
 *         name: { type: string }
 *         address: { type: string }
 *         phone: { type: string }
 *         email: { type: string }
 *         isDisabled: { type: boolean }
 *         openingHours: { type: object }
 *         holidayHours: { type: string }
 *         services: { type: string }
 *         policies: { type: string }
 *         faqs: { type: string }
 *         updatedAt: { type: string, format: date-time, nullable: true }
 *     ReceptionistCall:
 *       type: object
 *       description: Recording media URLs are never included.
 *       properties:
 *         id: { type: string }
 *         from: { type: string }
 *         to: { type: string }
 *         locationId: { type: string, nullable: true }
 *         branchName: { type: string }
 *         startedAt: { type: string, format: date-time }
 *         endedAt: { type: string, format: date-time, nullable: true }
 *         durationSeconds: { type: integer }
 *         handling: { type: string, enum: [ai, human, missed] }
 *         outcome: { type: string, enum: [in_progress, answered, transferred, missed, unresolved] }
 *         transferStatus: { type: string, enum: [none, requested, completed, failed] }
 *         resolutionStatus: { type: string, enum: [pending, resolved, unresolved] }
 *         summary: { type: string }
 *         turns:
 *           type: array
 *           items:
 *             type: object
 *             properties:
 *               speaker: { type: string, enum: [caller, ai, system] }
 *               text: { type: string }
 *               at: { type: string, format: date-time }
 *         recordingAvailable: { type: boolean }
 *         recordingDisclosed: { type: boolean }
 *     ReceptionistSettings:
 *       type: object
 *       description: Provider secrets are not accepted or returned.
 *       properties:
 *         recordingEnabled: { type: boolean }
 *         retentionDays: { type: integer, minimum: 1, maximum: 3650 }
 *         disclosureMessage: { type: string }
 *         notifyEmail: { type: string }
 *     ReceptionistHealth:
 *       type: object
 *       properties:
 *         telephony: { type: object }
 *         openai: { type: object }
 *         recording: { type: object }
 *         database: { type: string, example: connected }
 *         routingLive: { type: boolean, example: false }
 */
