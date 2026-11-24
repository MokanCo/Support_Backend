import { Router } from 'express';
import { authMiddleware } from '../middleware/authMiddleware.js';
import { roleMiddleware } from '../middleware/roleMiddleware.js';
import { validateRequest } from '../middleware/validate.js';
import { body, param, query } from 'express-validator';
import { asyncHandler } from '../utils/asyncHandler.js';
import { KNOWLEDGE_CATEGORIES, AGENT_VOICES } from '../models/receptionist.js';
import * as agentSettings from '../services/agentSettingsService.js';
import * as knowledge from '../services/knowledgeService.js';
import * as branches from '../services/branchProfileService.js';
import * as calls from '../services/callService.js';
import * as analytics from '../services/receptionistAnalyticsService.js';
import * as settings from '../services/systemSettingsService.js';
import { listAudit } from '../services/receptionistAuditService.js';

const router = Router();
const admin = [authMiddleware, roleMiddleware(['admin'])];
const idParam = param('id').isMongoId().withMessage('Invalid id');
const locationParam = param('locationId').isMongoId().withMessage('Invalid location id');

/**
 * @swagger
 * /api/ai-receptionist/overview:
 *   get:
 *     tags: [AI Receptionist – Overview]
 *     summary: Dashboard metrics from stored calls
 *     description: Admin only. Counts, charts, and recent calls are calculated from receptionist call records. Empty totals are real zeros. No order or payment metrics are included.
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: header
 *         name: Authorization
 *         required: true
 *         schema: { type: string }
 *       - in: query
 *         name: from
 *         schema: { type: string, format: date }
 *       - in: query
 *         name: to
 *         schema: { type: string, format: date }
 *       - in: query
 *         name: locationId
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Dashboard payload
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 kpis: { type: object }
 *                 charts: { type: object }
 *                 recentCalls: { type: array, items: { $ref: '#/components/schemas/ReceptionistCall' } }
 *                 service: { $ref: '#/components/schemas/ReceptionistHealth' }
 *       401:
 *         description: Unauthorized
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorMessage' }
 *       403:
 *         description: Admin role required
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorMessage' }
 */
router.get('/overview', ...admin, asyncHandler(async (req, res) => {
  res.json(await analytics.buildAnalytics(req.query));
}));

/**
 * @swagger
 * /api/ai-receptionist/agent-settings:
 *   get:
 *     tags: [AI Agent]
 *     summary: Read global or branch agent settings
 *     description: Admin only. Omit locationId for the global default. A branch id returns the override, or the global default with inheritsGlobal true when no override exists. Provider credentials are not included.
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: query
 *         name: locationId
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Effective settings
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 settings: { $ref: '#/components/schemas/AgentSettings' }
 *       401: { description: Unauthorized }
 *       403: { description: Forbidden }
 *       404: { description: Branch not found }
 *   put:
 *     tags: [AI Agent]
 *     summary: Save global or branch agent settings
 *     description: Admin only. locationId null saves the global default. A branch id saves an override used instead of the global default for that branch. This does not place a call.
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema: { $ref: '#/components/schemas/AgentSettings' }
 *           example:
 *             locationId: null
 *             agentName: Moka
 *             voice: alloy
 *             voiceSpeed: natural
 *             language: en
 *             speakingStyle: clear
 *             tone: professional
 *             greeting: Thank you for calling Moka & Co. How can I help you today?
 *             maxCallDurationSec: 600
 *             silenceTimeoutSec: 8
 *             aiEnabled: false
 *     responses:
 *       200:
 *         description: Saved settings
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 settings: { $ref: '#/components/schemas/AgentSettings' }
 *       400: { description: Validation error }
 *       401: { description: Unauthorized }
 *       403: { description: Forbidden }
 *       404: { description: Branch not found }
 *   delete:
 *     tags: [AI Agent]
 *     summary: Remove a branch agent override
 *     description: Admin only. The branch then inherits the global default. The global record cannot be deleted.
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: query
 *         name: locationId
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Override removed
 *       400: { description: locationId missing }
 *       401: { description: Unauthorized }
 *       403: { description: Forbidden }
 *       404: { description: Override not found }
 */
router.get(
  '/agent-settings',
  ...admin,
  query('locationId').optional().isMongoId(),
  validateRequest,
  asyncHandler(async (req, res) => {
    res.json({ settings: await agentSettings.getAgentSettings(req.query.locationId) });
  }),
);
router.put(
  '/agent-settings',
  ...admin,
  body('locationId').optional({ nullable: true }).isMongoId(),
  body('agentName').optional().isString().isLength({ min: 1, max: 60 }),
  body('voice').optional().isIn(AGENT_VOICES),
  body('voiceSpeed').optional().isIn(['slow', 'natural', 'brisk']),
  body('speakingStyle').optional().isIn(['clear', 'warm', 'concise']),
  body('tone').optional().isIn(['professional', 'friendly', 'formal']),
  body('greeting').optional().isString().isLength({ min: 1, max: 500 }),
  body('maxCallDurationSec').optional().isInt({ min: 60, max: 3600 }),
  body('silenceTimeoutSec').optional().isInt({ min: 3, max: 30 }),
  body('aiEnabled').optional().custom((value) => value === true || value === false),
  validateRequest,
  asyncHandler(async (req, res) => {
    res.json({ settings: await agentSettings.saveAgentSettings(req.body, req.user) });
  }),
);
router.delete(
  '/agent-settings',
  ...admin,
  query('locationId').isMongoId(),
  validateRequest,
  asyncHandler(async (req, res) => {
    res.json(await agentSettings.deleteBranchAgentSettings(req.query.locationId, req.user));
  }),
);

/**
 * @swagger
 * /api/ai-receptionist/knowledge:
 *   get:
 *     tags: [Knowledge Base]
 *     summary: List approved knowledge entries
 *     description: Admin only. Search matches title and body. Filter by category, scope, and branch. Only approved entries are returned, and these are the only entries the receptionist can use.
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: query
 *         name: page
 *         schema: { type: integer, minimum: 1, default: 1 }
 *       - in: query
 *         name: pageSize
 *         schema: { type: integer, minimum: 1, maximum: 200, default: 10 }
 *       - in: query
 *         name: search
 *         schema: { type: string }
 *       - in: query
 *         name: category
 *         schema: { type: string }
 *       - in: query
 *         name: scope
 *         schema: { type: string, enum: [global, branch, all] }
 *       - in: query
 *         name: locationId
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Page of entries
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 entries:
 *                   type: array
 *                   items: { $ref: '#/components/schemas/KnowledgeEntry' }
 *                 total: { type: integer }
 *                 page: { type: integer }
 *                 pageSize: { type: integer }
 *                 totalPages: { type: integer }
 *       401: { description: Unauthorized }
 *       403: { description: Forbidden }
 *   post:
 *     tags: [Knowledge Base]
 *     summary: Add an approved knowledge entry
 *     description: Admin only. Branch scope requires locationId. The entry is marked approved. The receptionist must not answer outside these entries.
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema: { $ref: '#/components/schemas/KnowledgeEntry' }
 *           example:
 *             title: Weekday hours
 *             body: The Midtown branch is open from 8:00 to 18:00 on weekdays.
 *             category: Opening hours
 *             scope: branch
 *             locationId: 507f1f77bcf86cd799439011
 *     responses:
 *       201:
 *         description: Created
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 entry: { $ref: '#/components/schemas/KnowledgeEntry' }
 *       400: { description: Validation error }
 *       401: { description: Unauthorized }
 *       403: { description: Forbidden }
 *       404: { description: Branch not found }
 */
router.get('/knowledge', ...admin, asyncHandler(async (req, res) => {
  res.json(await knowledge.listKnowledge(req.query));
}));
router.post(
  '/knowledge',
  ...admin,
  body('title').isString().isLength({ min: 1, max: 180 }),
  body('body').isString().isLength({ min: 1, max: 20000 }),
  body('category').isIn(KNOWLEDGE_CATEGORIES),
  body('scope').isIn(['global', 'branch']),
  body('locationId').optional({ nullable: true }).isMongoId(),
  validateRequest,
  asyncHandler(async (req, res) => {
    res.status(201).json({ entry: await knowledge.createKnowledge(req.body, req.user) });
  }),
);

/**
 * @swagger
 * /api/ai-receptionist/knowledge/import:
 *   post:
 *     tags: [Knowledge Base]
 *     summary: Import text or markdown knowledge
 *     description: Admin only. Accepts plain text. Blocks that start with "Q:" or "Question:" become separate approved entries. PDF import is not supported. Up to 50 entries per request.
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [text, category, scope]
 *             properties:
 *               filename: { type: string, example: hours.txt }
 *               text: { type: string }
 *               category: { type: string }
 *               scope: { type: string, enum: [global, branch] }
 *               locationId: { type: string }
 *     responses:
 *       201:
 *         description: Entries created
 *       400: { description: Empty text, unsupported file, or invalid category }
 *       401: { description: Unauthorized }
 *       403: { description: Forbidden }
 */
router.post(
  '/knowledge/import',
  ...admin,
  body('text').isString().isLength({ min: 1, max: 200000 }),
  body('category').isIn(KNOWLEDGE_CATEGORIES),
  body('scope').isIn(['global', 'branch']),
  body('filename').optional().isString().isLength({ max: 180 }),
  body('locationId').optional({ nullable: true }).isMongoId(),
  validateRequest,
  asyncHandler(async (req, res) => {
    const name = String(req.body.filename || '');
    if (name && !/\.(txt|md)$/i.test(name)) {
      res.status(400).json({ success: false, error: 'Only .txt and .md files can be imported', message: 'Only .txt and .md files can be imported' });
      return;
    }
    res.status(201).json(await knowledge.importKnowledge(req.body, req.user));
  }),
);

/**
 * @swagger
 * /api/ai-receptionist/knowledge/{id}:
 *   get:
 *     tags: [Knowledge Base]
 *     summary: Read one knowledge entry
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Entry
 *       401: { description: Unauthorized }
 *       403: { description: Forbidden }
 *       404: { description: Not found }
 *   patch:
 *     tags: [Knowledge Base]
 *     summary: Update a knowledge entry
 *     description: Admin only. Partial update. Branch entries stay limited to the selected location.
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema: { $ref: '#/components/schemas/KnowledgeEntry' }
 *     responses:
 *       200: { description: Updated }
 *       400: { description: Validation error }
 *       401: { description: Unauthorized }
 *       403: { description: Forbidden }
 *       404: { description: Not found }
 *   delete:
 *     tags: [Knowledge Base]
 *     summary: Delete a knowledge entry
 *     description: Admin only. The receptionist can no longer use the deleted text.
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: Deleted }
 *       401: { description: Unauthorized }
 *       403: { description: Forbidden }
 *       404: { description: Not found }
 */
router.get('/knowledge/:id', ...admin, idParam, validateRequest, asyncHandler(async (req, res) => {
  res.json({ entry: await knowledge.getKnowledge(req.params.id) });
}));
router.patch('/knowledge/:id', ...admin, idParam, validateRequest, asyncHandler(async (req, res) => {
  res.json({ entry: await knowledge.updateKnowledge(req.params.id, req.body, req.user) });
}));
router.delete('/knowledge/:id', ...admin, idParam, validateRequest, asyncHandler(async (req, res) => {
  res.json(await knowledge.deleteKnowledge(req.params.id, req.user));
}));

/**
 * @swagger
 * /api/ai-receptionist/branches:
 *   get:
 *     tags: [Branches]
 *     summary: List branches with receptionist details
 *     description: Admin only. Branch name, address, and phone come from the existing location records. Hours, services, policies, and FAQs come from the receptionist profile and are empty until saved.
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: query
 *         name: search
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Branch list
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 branches:
 *                   type: array
 *                   items: { $ref: '#/components/schemas/BranchReceptionistProfile' }
 *       401: { description: Unauthorized }
 *       403: { description: Forbidden }
 */
router.get('/branches', ...admin, asyncHandler(async (req, res) => {
  res.json(await branches.listBranchInfo(req.query));
}));

/**
 * @swagger
 * /api/ai-receptionist/branches/{locationId}:
 *   get:
 *     tags: [Branches]
 *     summary: Read one branch receptionist profile
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: locationId
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Profile joined to the location record
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 branch: { $ref: '#/components/schemas/BranchReceptionistProfile' }
 *       401: { description: Unauthorized }
 *       403: { description: Forbidden }
 *       404: { description: Branch not found }
 *   put:
 *     tags: [Branches]
 *     summary: Save receptionist-only branch details
 *     description: Admin only. Updates holiday hours, services, policies, FAQs, and opening hours. It does not rename the branch or change the location phone.
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: locationId
 *         required: true
 *         schema: { type: string }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema: { $ref: '#/components/schemas/BranchReceptionistProfile' }
 *     responses:
 *       200: { description: Saved }
 *       400: { description: Validation error }
 *       401: { description: Unauthorized }
 *       403: { description: Forbidden }
 *       404: { description: Branch not found }
 */
router.get('/branches/:locationId', ...admin, locationParam, validateRequest, asyncHandler(async (req, res) => {
  res.json({ branch: await branches.getBranchInfo(req.params.locationId) });
}));
router.put('/branches/:locationId', ...admin, locationParam, validateRequest, asyncHandler(async (req, res) => {
  res.json({ branch: await branches.saveBranchInfo(req.params.locationId, req.body, req.user) });
}));

/**
 * @swagger
 * /api/ai-receptionist/calls:
 *   get:
 *     tags: [Call History]
 *     summary: List stored calls
 *     description: Admin only. Supports search by caller number, branch, outcome, and date range. Results are paginated. Recording media URLs are not included.
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: query
 *         name: page
 *         schema: { type: integer, default: 1 }
 *       - in: query
 *         name: pageSize
 *         schema: { type: integer, default: 10, maximum: 200 }
 *       - in: query
 *         name: search
 *         schema: { type: string }
 *       - in: query
 *         name: locationId
 *         schema: { type: string }
 *       - in: query
 *         name: outcome
 *         schema: { type: string, enum: [all, in_progress, answered, transferred, missed, unresolved] }
 *       - in: query
 *         name: from
 *         schema: { type: string, format: date }
 *       - in: query
 *         name: to
 *         schema: { type: string, format: date }
 *     responses:
 *       200:
 *         description: Call page
 *       400: { description: Invalid filter }
 *       401: { description: Unauthorized }
 *       403: { description: Forbidden }
 */
router.get('/calls', ...admin, asyncHandler(async (req, res) => {
  res.json(await calls.listCalls(req.query));
}));

/**
 * @swagger
 * /api/ai-receptionist/calls/{id}:
 *   get:
 *     tags: [Call History]
 *     summary: Call detail with transcript and summary
 *     description: Admin only. Includes speaker turns and transfer details. The recording file URL is omitted; use the recordings audio route.
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Call detail
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 call: { $ref: '#/components/schemas/ReceptionistCall' }
 *       401: { description: Unauthorized }
 *       403: { description: Forbidden }
 *       404: { description: Call not found }
 *   patch:
 *     tags: [Call History]
 *     summary: Update resolution status
 *     description: Admin only. Sets pending, resolved, or unresolved. It does not create a call.
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [resolutionStatus]
 *             properties:
 *               resolutionStatus: { type: string, enum: [pending, resolved, unresolved] }
 *     responses:
 *       200: { description: Updated call }
 *       400: { description: Invalid status }
 *       401: { description: Unauthorized }
 *       403: { description: Forbidden }
 *       404: { description: Call not found }
 */
router.get('/calls/:id', ...admin, idParam, validateRequest, asyncHandler(async (req, res) => {
  res.json({ call: await calls.getCall(req.params.id) });
}));
router.patch(
  '/calls/:id',
  ...admin,
  idParam,
  body('resolutionStatus').isIn(['pending', 'resolved', 'unresolved']),
  validateRequest,
  asyncHandler(async (req, res) => {
    res.json({ call: await calls.updateCallResolution(req.params.id, req.body.resolutionStatus) });
  }),
);

/**
 * @swagger
 * /api/ai-receptionist/recordings:
 *   get:
 *     tags: [Recordings & Transcripts]
 *     summary: List calls that have a stored recording
 *     description: Admin only. Recordings are private. Media URLs are not returned.
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: query
 *         name: page
 *         schema: { type: integer }
 *       - in: query
 *         name: pageSize
 *         schema: { type: integer }
 *       - in: query
 *         name: locationId
 *         schema: { type: string }
 *     responses:
 *       200: { description: Recording list }
 *       401: { description: Unauthorized }
 *       403: { description: Forbidden }
 */
router.get('/recordings', ...admin, asyncHandler(async (req, res) => {
  res.json(await calls.listCalls({ ...req.query, hasRecording: 'true' }));
}));

/**
 * @swagger
 * /api/ai-receptionist/recordings/{callId}:
 *   get:
 *     tags: [Recordings & Transcripts]
 *     summary: Recording metadata and transcript context
 *     description: Admin only. Returns caller, branch, duration, outcome, summary, and whether disclosure was played. Does not return the media URL.
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: callId
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: Metadata }
 *       401: { description: Unauthorized }
 *       403: { description: Forbidden }
 *       404: { description: No recording }
 */
router.get('/recordings/:callId', ...admin, param('callId').isMongoId(), validateRequest, asyncHandler(async (req, res) => {
  const [meta, call] = await Promise.all([
    calls.getRecordingMeta(req.params.callId),
    calls.getCall(req.params.callId),
  ]);
  res.json({ recording: meta, call });
}));

/**
 * @swagger
 * /api/ai-receptionist/recordings/{callId}/audio:
 *   get:
 *     tags: [Recordings & Transcripts]
 *     summary: Stream a private recording
 *     description: Admin only. Audio is proxied from the telephony provider with server credentials. The response is not cacheable and is not a public URL.
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: callId
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Audio stream
 *         content:
 *           audio/mpeg:
 *             schema: { type: string, format: binary }
 *       401: { description: Unauthorized }
 *       403: { description: Forbidden }
 *       404: { description: No recording }
 *       502: { description: Provider retrieval failed }
 *       503: { description: Telephony credentials are not configured }
 */
router.get('/recordings/:callId/audio', ...admin, param('callId').isMongoId(), validateRequest, asyncHandler(async (req, res) => {
  const { stream, contentType } = await calls.openRecordingStream(req.params.callId);
  res.setHeader('Content-Type', contentType);
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('Content-Disposition', 'inline; filename="call.mp3"');
  stream.pipe(res);
}));

/**
 * @swagger
 * /api/ai-receptionist/analytics:
 *   get:
 *     tags: [Analytics]
 *     summary: Call analytics calculated from stored calls
 *     description: Admin only. Rates, branch totals, peak hours in America/New_York, common caller questions, and complaints. Questions are grouped from stored transcripts, not from sample data.
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: query
 *         name: from
 *         schema: { type: string, format: date }
 *       - in: query
 *         name: to
 *         schema: { type: string, format: date }
 *       - in: query
 *         name: locationId
 *         schema: { type: string }
 *     responses:
 *       200: { description: Analytics payload }
 *       400: { description: Invalid filter }
 *       401: { description: Unauthorized }
 *       403: { description: Forbidden }
 */
router.get('/analytics', ...admin, asyncHandler(async (req, res) => {
  res.json(await analytics.buildAnalytics(req.query));
}));

/**
 * @swagger
 * /api/ai-receptionist/analytics/export:
 *   get:
 *     tags: [Analytics]
 *     summary: Export stored calls as CSV
 *     description: Admin only. Up to 5000 calls for the selected dates and branch. The file contains call metadata and summaries, not recording URLs or card data.
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: query
 *         name: from
 *         schema: { type: string, format: date }
 *       - in: query
 *         name: to
 *         schema: { type: string, format: date }
 *       - in: query
 *         name: locationId
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: CSV file
 *         content:
 *           text/csv:
 *             schema: { type: string }
 *       401: { description: Unauthorized }
 *       403: { description: Forbidden }
 */
router.get('/analytics/export', ...admin, asyncHandler(async (req, res) => {
  const csv = await analytics.exportAnalyticsCsv(req.query);
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="receptionist-calls.csv"');
  res.send(csv);
}));

/**
 * @swagger
 * /api/ai-receptionist/settings:
 *   get:
 *     tags: [System Settings]
 *     summary: Read non-secret receptionist settings
 *     description: Admin only. Recording, retention, disclosure, and notification email. API keys and telephony tokens are never returned.
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200:
 *         description: Settings
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 settings: { $ref: '#/components/schemas/ReceptionistSettings' }
 *       401: { description: Unauthorized }
 *       403: { description: Forbidden }
 *   patch:
 *     tags: [System Settings]
 *     summary: Update non-secret receptionist settings
 *     description: Admin only. Requests that include an API key, account SID, auth token, or password are rejected.
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema: { $ref: '#/components/schemas/ReceptionistSettings' }
 *           example:
 *             recordingEnabled: false
 *             retentionDays: 30
 *             disclosureMessage: This call may be recorded for quality and training.
 *             notifyEmail: ""
 *     responses:
 *       200: { description: Saved }
 *       400: { description: Validation error or a secret field was sent }
 *       401: { description: Unauthorized }
 *       403: { description: Forbidden }
 */
router.get('/settings', ...admin, asyncHandler(async (req, res) => {
  res.json({ settings: settings.formatSettings(await settings.getSettings()) });
}));
router.patch('/settings', ...admin, asyncHandler(async (req, res) => {
  res.json({ settings: await settings.updateSettings(req.body, req.user) });
}));

/**
 * @swagger
 * /api/ai-receptionist/health:
 *   get:
 *     tags: [System Settings]
 *     summary: Service health without secrets
 *     description: Admin only. Reports whether Bandwidth and OpenAI environment variables are present. It does not return those values. routingLive is always false because this API does not change carrier routing.
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200:
 *         description: Health
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ReceptionistHealth' }
 *       401: { description: Unauthorized }
 *       403: { description: Forbidden }
 */
router.get('/health', ...admin, asyncHandler(async (req, res) => {
  res.json(settings.getHealth(await settings.getSettings()));
}));

/**
 * @swagger
 * /api/ai-receptionist/audit:
 *   get:
 *     tags: [System Settings]
 *     summary: Recent receptionist configuration changes
 *     description: Admin only. Lists who changed settings, knowledge, profiles, and agent configuration. Secret values are not stored in the audit row.
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: query
 *         name: limit
 *         schema: { type: integer, maximum: 50, default: 20 }
 *     responses:
 *       200: { description: Audit rows }
 *       401: { description: Unauthorized }
 *       403: { description: Forbidden }
 */
router.get('/audit', ...admin, asyncHandler(async (req, res) => {
  res.json({ events: await listAudit(Number(req.query.limit) || 20) });
}));

export default router;
