import mongoose from 'mongoose';

export const PHONE_PROVIDERS = [
  'unknown',
  'existing_carrier',
  'forwarded',
  'sip',
  'bandwidth',
  'twilio',
  'other',
];
export const FORWARD_MODES = ['none', 'forward', 'sip', 'manual'];
export const WEEKDAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
export const TEST_RESULTS = ['not_run', 'unavailable', 'invalid'];

const scheduleRowSchema = new mongoose.Schema(
  {
    day: { type: String, enum: WEEKDAYS, required: true },
    closed: { type: Boolean, default: false },
    open: { type: String, default: '', trim: true },
    close: { type: String, default: '', trim: true },
  },
  { _id: false },
);

/**
 * Receptionist configuration for a branch number.
 * This collection does not update Location.phone and does not control the carrier.
 *
 * @swagger
 * components:
 *   schemas:
 *     PhoneScheduleRow:
 *       type: object
 *       required: [day]
 *       properties:
 *         day:
 *           type: string
 *           enum: [mon, tue, wed, thu, fri, sat, sun]
 *         closed:
 *           type: boolean
 *           default: false
 *         open:
 *           type: string
 *           description: Local opening time, 24-hour HH:mm. Empty when the day is not set.
 *           example: "08:00"
 *         close:
 *           type: string
 *           description: Local closing time, 24-hour HH:mm. Must be after open when both are set.
 *           example: "18:00"
 *     PhoneBusinessHours:
 *       type: object
 *       properties:
 *         timezone:
 *           type: string
 *           maxLength: 80
 *           example: America/New_York
 *         schedule:
 *           type: array
 *           items:
 *             $ref: '#/components/schemas/PhoneScheduleRow'
 *     PhoneForwarding:
 *       type: object
 *       description: Stored forwarding intent. routingLive is always false. This API does not change the carrier.
 *       properties:
 *         mode:
 *           type: string
 *           enum: [none, forward, sip, manual]
 *           example: none
 *         destination:
 *           type: string
 *           description: Required for mode forward (10–15 digits) and mode sip (sip:user@host). Cleared when mode is none.
 *           example: ""
 *         notes:
 *           type: string
 *           maxLength: 500
 *         routingLive:
 *           type: boolean
 *           enum: [false]
 *           description: Must be false. true is rejected.
 *           example: false
 *     BranchPhoneNumber:
 *       type: object
 *       properties:
 *         id: { type: string, example: 507f1f77bcf86cd799439011 }
 *         locationId: { type: string, description: Existing Location id. }
 *         branchName: { type: string, example: Moka & Co. Midtown }
 *         branchPhone:
 *           type: string
 *           description: Phone currently stored on the location record. Read only. Not changed by this API.
 *           example: "+1-555-0100"
 *         branchIsDisabled: { type: boolean, example: false }
 *         existingPhoneNumber:
 *           type: string
 *           description: Incoming number to keep using. Stored only on this configuration.
 *           example: "+1-555-0100"
 *         provider:
 *           type: string
 *           enum: [unknown, existing_carrier, forwarded, sip, bandwidth, twilio, other]
 *         providerLabel:
 *           type: string
 *           description: Required when provider is other. Otherwise empty.
 *         aiEnabled:
 *           type: boolean
 *           description: Desired AI handling. Does not route live calls while telephony is disconnected.
 *           example: false
 *         businessHours:
 *           $ref: '#/components/schemas/PhoneBusinessHours'
 *         humanFallbackNumber: { type: string, example: "+1-555-0199" }
 *         transferNumber: { type: string, example: "+1-555-0198" }
 *         forwarding:
 *           $ref: '#/components/schemas/PhoneForwarding'
 *         connectionStatus:
 *           type: string
 *           enum: [not_connected]
 *           description: Live connectivity is not available until a telephony provider is approved.
 *         lastTestAt: { type: string, format: date-time, nullable: true }
 *         lastTestResult:
 *           type: string
 *           enum: [not_run, unavailable, invalid]
 *         lastTestMessage: { type: string }
 *         createdAt: { type: string, format: date-time }
 *         updatedAt: { type: string, format: date-time }
 *     BranchPhoneNumberWrite:
 *       type: object
 *       properties:
 *         locationId: { type: string, description: Required on create. Existing Location id. }
 *         existingPhoneNumber:
 *           type: string
 *           description: 10–15 digits. On create, defaults to the location phone when omitted.
 *         provider:
 *           type: string
 *           enum: [unknown, existing_carrier, forwarded, sip, bandwidth, twilio, other]
 *         providerLabel: { type: string, maxLength: 80 }
 *         aiEnabled: { type: boolean }
 *         businessHours:
 *           $ref: '#/components/schemas/PhoneBusinessHours'
 *         humanFallbackNumber: { type: string, description: Empty or 10–15 digits. }
 *         transferNumber: { type: string, description: Empty or 10–15 digits. }
 *         forwarding:
 *           $ref: '#/components/schemas/PhoneForwarding'
 *     PhoneNumberListResponse:
 *       type: object
 *       properties:
 *         phoneNumbers:
 *           type: array
 *           items:
 *             $ref: '#/components/schemas/BranchPhoneNumber'
 *         total: { type: integer, example: 0 }
 *         page: { type: integer, example: 1 }
 *         pageSize: { type: integer, example: 10 }
 *         totalPages: { type: integer, example: 1 }
 *     PhoneNumberTestResponse:
 *       type: object
 *       properties:
 *         phoneNumber:
 *           $ref: '#/components/schemas/BranchPhoneNumber'
 *         test:
 *           type: object
 *           properties:
 *             result: { type: string, enum: [unavailable, invalid], example: unavailable }
 *             message: { type: string }
 *             placedCall: { type: boolean, example: false }
 *             routingChanged: { type: boolean, example: false }
 */
const branchPhoneNumberSchema = new mongoose.Schema(
  {
    locationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Location',
      required: true,
      index: true,
    },
    existingPhoneNumber: { type: String, required: true, trim: true },
    normalizedNumber: { type: String, required: true, unique: true },
    provider: { type: String, enum: PHONE_PROVIDERS, default: 'unknown' },
    providerLabel: { type: String, default: '', trim: true, maxlength: 80 },
    aiEnabled: { type: Boolean, default: false },
    businessHours: {
      timezone: { type: String, default: 'America/New_York', trim: true },
      schedule: { type: [scheduleRowSchema], default: undefined },
    },
    humanFallbackNumber: { type: String, default: '', trim: true },
    transferNumber: { type: String, default: '', trim: true },
    forwarding: {
      mode: { type: String, enum: FORWARD_MODES, default: 'none' },
      destination: { type: String, default: '', trim: true },
      notes: { type: String, default: '', maxlength: 500 },
      routingLive: { type: Boolean, default: false },
    },
    connectionStatus: { type: String, enum: ['not_connected'], default: 'not_connected' },
    lastTestAt: { type: Date, default: null },
    lastTestResult: { type: String, enum: TEST_RESULTS, default: 'not_run' },
    lastTestMessage: { type: String, default: '' },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: true },
);

branchPhoneNumberSchema.index({ locationId: 1, createdAt: -1 });

export default mongoose.model('BranchPhoneNumber', branchPhoneNumberSchema, 'branch_phone_numbers');
