import { Router } from 'express';
import { asyncHandler } from '../utils/asyncHandler.js';
import { bandwidthRejectionReason } from '../services/bandwidthAuth.js';
import * as telephony from '../services/telephonyService.js';

const router = Router();
const UNAVAILABLE_BXML = '<?xml version="1.0" encoding="UTF-8"?><Response><SpeakSentence voice="julie">This line is not available.</SpeakSentence><Hangup/></Response>';

function requireBandwidth(req, res, next) {
  const reason = bandwidthRejectionReason(req);
  if (reason) {
    console.warn('[voice] webhook rejected', {
      reason,
      path: req.originalUrl,
      hasAuthorization: Boolean(req.get('Authorization')),
    });
    res.status(403).type('text/xml').send(UNAVAILABLE_BXML);
    return;
  }
  next();
}

function voiceHandler(fn) {
  return asyncHandler(async (req, res) => {
    try {
      await fn(req, res);
    } catch (error) {
      console.error('[voice] webhook failed', {
        path: req.originalUrl,
        eventType: req.body?.eventType || '',
        callId: req.body?.callId || '',
        message: error instanceof Error ? error.message : 'unknown error',
      });
      if (!res.headersSent) {
        res.status(200).type('text/xml').send(UNAVAILABLE_BXML);
      }
    }
  });
}

/**
 * @swagger
 * /api/ai-receptionist/voice/inbound:
 *   post:
 *     tags: [Webhooks]
 *     summary: Inbound call webhook
 *     description: >
 *       Bandwidth voice application callback. HTTP Basic auth is required. No portal JWT.
 *       The called Bandwidth number is matched to aiDestinationNumber. When the carrier includes the original franchise number, that public number is matched first so one Bandwidth number can serve several branches.
 *       AI answers only when the branch has AI enabled, an AI destination number saved, and the agent setting enabled.
 *       Otherwise the call is transferred to the saved staff number. The original caller number is kept.
 *       Order and payment requests are refused and offered a transfer. Point the Bandwidth voice application at this URL.
 *     parameters:
 *       - in: header
 *         name: Authorization
 *         required: true
 *         schema: { type: string }
 *       - in: header
 *         name: Content-Type
 *         schema: { type: string, example: application/json }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               callId: { type: string, example: CA1234567890abcdef1234567890abcd }
 *               From: { type: string, example: "+15555550100" }
 *               To: { type: string, example: "+15555550199" }
 *               CallStatus: { type: string, example: ringing }
 *     responses:
 *       200:
 *         description: BXML
 *         content:
 *           text/xml:
 *             schema: { type: string }
 *       403:
 *         description: Missing telephony configuration or invalid signature
 */
router.post('/inbound', requireBandwidth, voiceHandler(async (req, res) => {
  const event = String(req.body?.eventType || 'initiate');
  if (event === 'disconnect') {
    await telephony.handleCallStatus(req.body);
    res.status(200).type('text/plain').send('ok');
    return;
  }
  if (event === 'recordingAvailable') {
    await telephony.handleRecording(req.query.callId, req.body);
    res.status(200).type('text/plain').send('ok');
    return;
  }
  if (event === 'gather') {
    res.type('text/xml').send(await telephony.handleGather(req.query.callId, req.body));
    return;
  }
  if (event === 'transferComplete') {
    res.type('text/xml').send(await telephony.handleDialStatus(req.query.callId, req.body));
    return;
  }
  res.type('text/xml').send(await telephony.handleInbound(req.body));
}));

/**
 * @swagger
 * /api/ai-receptionist/voice/gather:
 *   post:
 *     tags: [Webhooks]
 *     summary: Speech result for the current call
 *     description: Bandwidth basic auth required. Answers from approved knowledge only. Unverified, order, payment, complaint, and human requests are transferred when a branch number is saved.
 *     parameters:
 *       - in: header
 *         name: Authorization
 *         required: true
 *         schema: { type: string }
 *       - in: query
 *         name: callId
 *         required: true
 *         schema: { type: string }
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               text: { type: string, example: What time do you open? }
 *               callId: { type: string }
 *     responses:
 *       200:
 *         description: BXML
 *         content:
 *           text/xml:
 *             schema: { type: string }
 *       403: { description: Invalid credentials }
 */
router.post('/gather', requireBandwidth, asyncHandler(async (req, res) => {
  res.type('text/xml').send(await telephony.handleGather(req.query.callId, req.body));
}));

/**
 * @swagger
 * /api/ai-receptionist/voice/dial-status:
 *   post:
 *     tags: [Telephony]
 *     summary: Transfer result callback
 *     description: Bandwidth basic auth required. Marks the transfer completed when the cause is hangup, or tries the fallback number once.
 *     parameters:
 *       - in: header
 *         name: Authorization
 *         required: true
 *         schema: { type: string }
 *       - in: query
 *         name: callId
 *         required: true
 *         schema: { type: string }
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               cause: { type: string, example: hangup }
 *     responses:
 *       200:
 *         description: BXML
 *       403: { description: Invalid credentials }
 */
router.post('/dial-status', requireBandwidth, asyncHandler(async (req, res) => {
  res.type('text/xml').send(await telephony.handleDialStatus(req.query.callId, req.body));
}));

/**
 * @swagger
 * /api/ai-receptionist/voice/status:
 *   post:
 *     tags: [Telephony]
 *     summary: Call status callback
 *     description: Bandwidth basic auth required. Stores duration and final outcome for a call that already exists. It does not create sample calls.
 *     parameters:
 *       - in: header
 *         name: Authorization
 *         required: true
 *         schema: { type: string }
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               callId: { type: string }
 *               eventType: { type: string, example: disconnect }
 *               cause: { type: string, example: hangup }
 *               duration: { type: string, example: PT42S }
 *     responses:
 *       200: { description: Accepted }
 *       403: { description: Invalid credentials }
 */
router.post('/status', requireBandwidth, asyncHandler(async (req, res) => {
  await telephony.handleCallStatus(req.body);
  res.status(200).type('text/plain').send('ok');
}));

/**
 * @swagger
 * /api/ai-receptionist/voice/recording:
 *   post:
 *     tags: [Webhooks]
 *     summary: Recording status callback
 *     description: Bandwidth basic auth required. Stores recording metadata only when recording is enabled and the caller heard the disclosure. The media URL is kept on the server and is not returned to the browser.
 *     parameters:
 *       - in: header
 *         name: Authorization
 *         required: true
 *         schema: { type: string }
 *       - in: query
 *         name: callId
 *         schema: { type: string }
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               recordingId: { type: string }
 *               mediaUrl: { type: string }
 *               duration: { type: string, example: PT42S }
 *               callId: { type: string }
 *               fileFormat: { type: string, example: mp3 }
 *     responses:
 *       200: { description: Accepted }
 *       403: { description: Invalid credentials }
 */
router.post('/recording', requireBandwidth, asyncHandler(async (req, res) => {
  await telephony.handleRecording(req.query.callId, req.body);
  res.status(200).type('text/plain').send('ok');
}));

export default router;
