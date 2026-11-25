import { Router } from 'express';
import { authMiddleware } from '../middleware/authMiddleware.js';
import { roleMiddleware } from '../middleware/roleMiddleware.js';
import { validateRequest } from '../middleware/validate.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { AppError } from '../utils/AppError.js';
import { messagingRejectionReason } from '../services/smsAuth.js';
import {
  getSmsConversation,
  getSmsOverview,
  ingestInbound,
  listSmsMessages,
  markSmsRead,
} from '../services/smsService.js';
import { listSmsValidators, smsIdValidators, smsPhoneValidators } from '../utils/smsValidators.js';

/**
 * @param {{ env?: NodeJS.ProcessEnv, repo?: object, notify?: Function, now?: Date }} [deps]
 */
export function createSmsRouter(deps = {}) {
  const router = Router();

  /**
   * @swagger
   * /api/ai-receptionist/sms/inbound:
   *   post:
   *     tags: [SMS]
   *     summary: Bandwidth inbound SMS webhook
   *     description: >
   *       Bandwidth messaging application callback. The body is a JSON array of events.
   *       HTTP Basic auth uses BANDWIDTH_MESSAGING_USERNAME and BANDWIDTH_MESSAGING_PASSWORD.
   *       Voice webhook credentials are not accepted. No portal JWT. No SMS reply is sent.
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
   *             type: array
   *             items:
   *               type: object
   *               properties:
   *                 type: { type: string, example: message-received }
   *                 time: { type: string, format: date-time }
   *                 to: { type: string, example: "+13376040529" }
   *                 message:
   *                   type: object
   *                   properties:
   *                     id: { type: string }
   *                     from: { type: string, example: "+15556667777" }
   *                     to:
   *                       type: array
   *                       items: { type: string }
   *                     text: { type: string }
   *                     time: { type: string, format: date-time }
   *                     applicationId: { type: string }
   *                     direction: { type: string, example: in }
   *                     media:
   *                       type: array
   *                       items: { type: string }
   *     responses:
   *       200:
   *         description: Accepted. Duplicate message ids are ignored.
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 received: { type: boolean, example: true }
   *                 saved: { type: integer, example: 1 }
   *                 duplicates: { type: integer, example: 0 }
   *       400:
   *         description: Payload is not a Bandwidth messaging callback
   *       401:
   *         description: Messaging callback credentials were rejected
   */
  router.post('/inbound', asyncHandler(async (req, res) => {
    const reason = messagingRejectionReason(req, deps.env);
    if (reason) {
      console.warn('[sms] webhook rejected', { reason });
      res.status(401).json({ error: 'Unauthorized', message: 'Unauthorized' });
      return;
    }
    try {
      const result = await ingestInbound(req.body, deps);
      res.status(200).json(result);
    } catch (error) {
      if (error instanceof AppError) throw error;
      console.error('[sms] webhook failed', {
        message: error instanceof Error ? error.message : 'unknown error',
      });
      throw error;
    }
  }));

  router.use(authMiddleware);
  router.use(roleMiddleware(['admin']));

  /**
   * @swagger
   * /api/ai-receptionist/sms/messages:
   *   get:
   *     tags: [SMS]
   *     summary: List stored SMS messages
   *     description: Admin only. Paginated. Search matches the sender or recipient number. Dates are America/New_York calendar days.
   *     security:
   *       - bearerAuth: []
   *     parameters:
   *       - in: query
   *         name: page
   *         schema: { type: integer, minimum: 1, default: 1 }
   *       - in: query
   *         name: pageSize
   *         schema: { type: integer, minimum: 1, maximum: 200, default: 20 }
   *       - in: query
   *         name: search
   *         schema: { type: string }
   *         description: Phone number digits.
   *       - in: query
   *         name: status
   *         schema: { type: string, enum: [all, received, read] }
   *       - in: query
   *         name: from
   *         schema: { type: string, example: "2026-11-25" }
   *       - in: query
   *         name: to
   *         schema: { type: string, example: "2026-11-25" }
   *     responses:
   *       200:
   *         description: Message page
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 messages:
   *                   type: array
   *                   items:
   *                     $ref: '#/components/schemas/ReceptionistSmsMessage'
   *                 total: { type: integer }
   *                 page: { type: integer }
   *                 pageSize: { type: integer }
   *                 totalPages: { type: integer }
   *       401: { description: Unauthorized }
   *       403: { description: Forbidden }
   */
  router.get('/messages', listSmsValidators, validateRequest, asyncHandler(async (req, res) => {
    res.status(200).json(await listSmsMessages(req.query, deps));
  }));

  /**
   * @swagger
   * /api/ai-receptionist/sms/conversations/{phoneNumber}:
   *   get:
   *     tags: [SMS]
   *     summary: SMS conversation for one phone number
   *     description: Admin only. Returns inbound and stored outbound messages for the E.164 number, oldest first. Encode the leading plus sign.
   *     security:
   *       - bearerAuth: []
   *     parameters:
   *       - in: path
   *         name: phoneNumber
   *         required: true
   *         schema: { type: string, example: "+15556667777" }
   *     responses:
   *       200:
   *         description: Conversation
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 phoneNumber: { type: string }
   *                 messages:
   *                   type: array
   *                   items:
   *                     $ref: '#/components/schemas/ReceptionistSmsMessage'
   *       400: { description: Invalid phone number }
   *       401: { description: Unauthorized }
   *       403: { description: Forbidden }
   */
  router.get('/conversations/:phoneNumber', smsPhoneValidators, validateRequest, asyncHandler(async (req, res) => {
    res.status(200).json(await getSmsConversation(req.params.phoneNumber, deps));
  }));

  /**
   * @swagger
   * /api/ai-receptionist/sms/overview:
   *   get:
   *     tags: [SMS]
   *     summary: Inbound SMS counts
   *     description: Admin only. Total inbound messages, unread messages, and messages received today in America/New_York.
   *     security:
   *       - bearerAuth: []
   *     responses:
   *       200:
   *         description: Counts
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 totalInbound: { type: integer, example: 0 }
   *                 unread: { type: integer, example: 0 }
   *                 today: { type: integer, example: 0 }
   *       401: { description: Unauthorized }
   *       403: { description: Forbidden }
   */
  router.get('/overview', asyncHandler(async (req, res) => {
    res.status(200).json(await getSmsOverview(deps));
  }));

  /**
   * @swagger
   * /api/ai-receptionist/sms/messages/{id}/read:
   *   patch:
   *     tags: [SMS]
   *     summary: Mark an SMS as read
   *     description: Admin only. Sets status to read. Calling it again leaves the message read.
   *     security:
   *       - bearerAuth: []
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema: { type: string }
   *     responses:
   *       200:
   *         description: Updated message
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 message:
   *                   $ref: '#/components/schemas/ReceptionistSmsMessage'
   *       404: { description: Message not found }
   *       401: { description: Unauthorized }
   *       403: { description: Forbidden }
   */
  router.patch('/messages/:id/read', smsIdValidators, validateRequest, asyncHandler(async (req, res) => {
    const message = await markSmsRead(req.params.id, deps);
    res.status(200).json({ message });
  }));

  return router;
}

const router = createSmsRouter();

/**
 * @swagger
 * components:
 *   schemas:
 *     ReceptionistSmsMessage:
 *       type: object
 *       properties:
 *         id: { type: string }
 *         bandwidthMessageId: { type: string }
 *         fromNumber: { type: string, example: "+15556667777" }
 *         toNumber: { type: string, example: "+13376040529" }
 *         messageText: { type: string }
 *         direction: { type: string, enum: [inbound, outbound] }
 *         status: { type: string, enum: [received, read] }
 *         receivedAt: { type: string, format: date-time }
 *         mediaUrls:
 *           type: array
 *           items: { type: string }
 *         createdAt: { type: string, format: date-time }
 *         updatedAt: { type: string, format: date-time }
 */

export default router;
