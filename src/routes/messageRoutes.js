import { Router } from 'express';
import * as messageController from '../controllers/messageController.js';
import { authMiddleware } from '../middleware/authMiddleware.js';
import { validateRequest } from '../middleware/validate.js';
import {
  createMessageValidators,
  listMessagesValidators,
  markThreadReadValidators,
} from '../utils/validators.js';

const router = Router();

router.use(authMiddleware);

/**
 * @swagger
 * /api/messages:
 *   post:
 *     tags: [Messages]
 *     summary: Send message on ticket
 *     description: Appends a message to the ticket thread. Caller must have access to the ticket.
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/CreateMessageRequest'
 *           example:
 *             ticketId: "507f1f77bcf86cd799439011"
 *             text: Thanks — we escalated to the network team.
 *     responses:
 *       201:
 *         description: Message created
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   $ref: '#/components/schemas/Message'
 *       400:
 *         description: Validation error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorMessage'
 *       401:
 *         description: Unauthorized
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorMessage'
 *       403:
 *         description: Forbidden
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorMessage'
 *       404:
 *         description: Ticket not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorMessage'
 *       500:
 *         description: Server error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorMessage'
 *   get:
 *     tags: [Messages]
 *     summary: List messages for ticket
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: ticketId
 *         required: true
 *         schema:
 *           type: string
 *         description: Ticket MongoDB id
 *     responses:
 *       200:
 *         description: Messages (oldest first)
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 messages:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/Message'
 *       400:
 *         description: Missing or invalid ticketId
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorMessage'
 *       401:
 *         description: Unauthorized
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorMessage'
 *       403:
 *         description: Forbidden
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorMessage'
 *       404:
 *         description: Ticket not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorMessage'
 *       500:
 *         description: Server error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorMessage'
 */
router.post('/', createMessageValidators, validateRequest, messageController.createMessage);
router.get('/summary', listMessagesValidators, validateRequest, messageController.getMessageSummary);
router.post('/mark-read', markThreadReadValidators, validateRequest, messageController.markThreadRead);
router.get('/', listMessagesValidators, validateRequest, messageController.listMessages);

export default router;
