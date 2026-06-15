import { Router } from 'express';
import * as ticketController from '../controllers/ticketController.js';
import * as ticketActivityController from '../controllers/ticketActivityController.js';
import * as ticketInternalNoteController from '../controllers/ticketInternalNoteController.js';
import { authMiddleware } from '../middleware/authMiddleware.js';
import { roleMiddleware } from '../middleware/roleMiddleware.js';
import { validateRequest } from '../middleware/validate.js';
import {
  bulkDeleteTicketValidators,
  bulkUpdateTicketValidators,
  createTicketValidators,
  listTicketsQueryValidators,
  ticketIdParamValidators,
  ticketInternalNoteCreateValidators,
  ticketInternalNoteUpdateValidators,
  ticketInternalNoteDeleteValidators,
  updateTicketValidators,
} from '../utils/validators.js';

const router = Router();

router.use(authMiddleware);

/**
 * @swagger
 * /api/tickets/bulk-update:
 *   post:
 *     tags: [Tickets]
 *     summary: Bulk update tickets
 *     description: Applies the same partial update to every ticket id listed. Respects role and location access; completed or cancelled tickets cannot be updated.
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/BulkUpdateTicketsRequest'
 *           example:
 *             ids: ["507f1f77bcf86cd799439011"]
 *             updates:
 *               status: in_progress
 *               priority: p2
 *     responses:
 *       200:
 *         description: Bulk result
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 updated:
 *                   type: integer
 *                   example: 2
 *                 tickets:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/Ticket'
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
 *         description: Forbidden or ticket is completed/cancelled (read-only)
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
router.post(
  '/bulk-update',
  bulkUpdateTicketValidators,
  validateRequest,
  ticketController.bulkUpdateTickets,
);

/**
 * @swagger
 * /api/tickets/bulk-delete:
 *   post:
 *     tags: [Tickets]
 *     summary: Bulk delete tickets
 *     description: Deletes tickets and their messages. Respects role and location access.
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/BulkTicketIdsRequest'
 *           example:
 *             ids: ["507f1f77bcf86cd799439011", "507f1f77bcf86cd799439012"]
 *     responses:
 *       200:
 *         description: Count deleted
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 deleted:
 *                   type: integer
 *                   example: 2
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
 */
router.post(
  '/bulk-delete',
  bulkDeleteTicketValidators,
  validateRequest,
  ticketController.bulkDeleteTickets,
);

/**
 * @swagger
 * /api/tickets:
 *   post:
 *     tags: [Tickets]
 *     summary: Create ticket
 *     description: Creates a ticket with auto-generated ticketId (e.g. MK-0001). Partners may only use their own locationId.
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/CreateTicketRequest'
 *           example:
 *             title: VPN drops every hour
 *             description: Remote staff cannot stay connected.
 *             category: Network
 *             priority: p2
 *             locationId: "64a1b2c3d4e5f6789012345"
 *     responses:
 *       201:
 *         description: Ticket created
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 ticket:
 *                   $ref: '#/components/schemas/Ticket'
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
 *         description: Forbidden (e.g. partner wrong location)
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorMessage'
 *       404:
 *         description: Location or assignee not found
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
 *     tags: [Tickets]
 *     summary: List tickets
 *     description: Partners see only their location; admin/support see all. Optional filters.
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *           enum: [in_queue, in_progress, completed, cancelled]
 *       - in: query
 *         name: locationId
 *         schema:
 *           type: string
 *         description: Admin/support only — filter by location
 *     responses:
 *       200:
 *         description: Ticket list
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 tickets:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/Ticket'
 *       400:
 *         description: Invalid query
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
 *       500:
 *         description: Server error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorMessage'
 */
router.post('/', createTicketValidators, validateRequest, ticketController.createTicket);
router.get('/', listTicketsQueryValidators, validateRequest, ticketController.listTickets);

router.get('/:id/activity', ticketIdParamValidators, validateRequest, ticketActivityController.listTicketActivities);
router.post('/:id/activity', ticketIdParamValidators, validateRequest, ticketActivityController.appendTicketActivities);

/**
 * @swagger
 * /api/tickets/{id}/internal-notes:
 *   get:
 *     tags: [Ticket internal notes]
 *     summary: List internal notes for a ticket
 *     description: Admin and support only. Partners never receive this data.
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Notes oldest-first
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 notes:
 *                   type: array
 *                   items: { $ref: '#/components/schemas/TicketInternalNote' }
 *       401: { description: Unauthorized }
 *       403: { description: Forbidden }
 *       404: { description: Ticket not found }
 *   post:
 *     tags: [Ticket internal notes]
 *     summary: Add internal note
 *     description: Admin and support only. Blocked when ticket is completed or cancelled.
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
 *             required: [body]
 *             properties:
 *               body: { type: string, example: 'Called vendor — awaiting RMA.' }
 *     responses:
 *       201:
 *         description: Created
 *       400: { description: Validation error }
 *       401: { description: Unauthorized }
 *       403: { description: Forbidden or ticket closed }
 *       404: { description: Ticket not found }
 */
router.get(
  '/:id/internal-notes',
  roleMiddleware(['admin', 'support']),
  ticketIdParamValidators,
  validateRequest,
  ticketInternalNoteController.listInternalNotes,
);
router.post(
  '/:id/internal-notes',
  roleMiddleware(['admin', 'support']),
  ticketInternalNoteCreateValidators,
  validateRequest,
  ticketInternalNoteController.createInternalNote,
);

/**
 * @swagger
 * /api/tickets/{id}/internal-notes/{noteId}:
 *   patch:
 *     tags: [Ticket internal notes]
 *     summary: Edit an internal note
 *     description: Author or admin. Blocked when ticket is closed.
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               body: { type: string }
 *     responses:
 *       200: { description: Updated note }
 *       400: { description: Validation error }
 *       403: { description: Forbidden }
 *       404: { description: Not found }
 *   delete:
 *     tags: [Ticket internal notes]
 *     summary: Delete internal note
 *     description: Author or admin. Blocked when ticket is closed.
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Deleted }
 *       403: { description: Forbidden }
 *       404: { description: Not found }
 */
router.patch(
  '/:id/internal-notes/:noteId',
  roleMiddleware(['admin', 'support']),
  ticketInternalNoteUpdateValidators,
  validateRequest,
  ticketInternalNoteController.updateInternalNote,
);
router.delete(
  '/:id/internal-notes/:noteId',
  roleMiddleware(['admin', 'support']),
  ticketInternalNoteDeleteValidators,
  validateRequest,
  ticketInternalNoteController.deleteInternalNote,
);

/**
 * @swagger
 * /api/tickets/{id}:
 *   get:
 *     tags: [Tickets]
 *     summary: Get ticket by id
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Ticket
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 ticket:
 *                   $ref: '#/components/schemas/Ticket'
 *       400:
 *         description: Invalid id
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
 *         description: Not found
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
 *   patch:
 *     tags: [Tickets]
 *     summary: Update ticket
 *     description: Cannot modify a ticket that is completed or cancelled. To complete, progress must be 100% and `resolution` is required when setting status to completed.
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/UpdateTicketRequest'
 *     responses:
 *       200:
 *         description: Updated ticket
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 ticket:
 *                   $ref: '#/components/schemas/Ticket'
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
 *         description: Forbidden or ticket read-only (completed/cancelled)
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorMessage'
 *       404:
 *         description: Not found
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
 *   delete:
 *     tags: [Tickets]
 *     summary: Delete ticket
 *     description: Deletes the ticket and related messages.
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Deleted
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 ok:
 *                   type: boolean
 *                   example: true
 *       400:
 *         description: Invalid id
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
 *         description: Not found
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
router.get('/:id', ticketIdParamValidators, validateRequest, ticketController.getTicket);
router.patch('/:id', updateTicketValidators, validateRequest, ticketController.updateTicket);
router.delete('/:id', ticketIdParamValidators, validateRequest, ticketController.deleteTicket);

export default router;
