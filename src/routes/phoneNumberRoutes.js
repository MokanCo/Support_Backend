import { Router } from 'express';
import * as phoneNumberController from '../controllers/phoneNumberController.js';
import { authMiddleware } from '../middleware/authMiddleware.js';
import { roleMiddleware } from '../middleware/roleMiddleware.js';
import { validateRequest } from '../middleware/validate.js';
import {
  createPhoneNumberValidators,
  listPhoneNumberValidators,
  phoneNumberIdValidators,
  updatePhoneNumberValidators,
} from '../utils/phoneNumberValidators.js';

const router = Router();

router.use(authMiddleware);
router.use(roleMiddleware(['admin']));

/**
 * @swagger
 * /api/ai-receptionist/phone-numbers:
 *   get:
 *     tags: [Phone Numbers]
 *     summary: List branch phone configurations
 *     description: >
 *       Admin only. Returns receptionist phone configuration records.
 *       These records do not change Location.phone and do not change carrier routing.
 *       Results are paginated. Search matches the configured number, fallback, transfer number,
 *       provider label, and branch name. Sort fields are createdAt, updatedAt, existingPhoneNumber, and aiEnabled.
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: header
 *         name: Authorization
 *         required: true
 *         schema: { type: string, example: "Bearer token" }
 *         description: Portal JWT. No other credential is accepted.
 *       - in: query
 *         name: page
 *         schema: { type: integer, minimum: 1, default: 1 }
 *       - in: query
 *         name: pageSize
 *         schema: { type: integer, minimum: 1, maximum: 200, default: 10 }
 *       - in: query
 *         name: search
 *         schema: { type: string, maxLength: 120 }
 *       - in: query
 *         name: locationId
 *         schema: { type: string }
 *         description: Filter to one existing branch.
 *       - in: query
 *         name: aiEnabled
 *         schema: { type: string, enum: ["true", "false"] }
 *       - in: query
 *         name: sort
 *         schema: { type: string, enum: [createdAt, updatedAt, existingPhoneNumber, aiEnabled], default: createdAt }
 *       - in: query
 *         name: order
 *         schema: { type: string, enum: [asc, desc], default: desc }
 *     responses:
 *       200:
 *         description: Page of phone configurations
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/PhoneNumberListResponse'
 *             example:
 *               phoneNumbers: []
 *               total: 0
 *               page: 1
 *               pageSize: 10
 *               totalPages: 1
 *       400:
 *         description: Invalid query
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorMessage'
 *       401:
 *         description: Missing or invalid bearer token
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorMessage'
 *       403:
 *         description: Authenticated user is not an admin
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
 *   post:
 *     tags: [Phone Numbers]
 *     summary: Add a branch phone configuration
 *     description: >
 *       Admin only. Stores how an existing branch number should be handled later.
 *       If existingPhoneNumber is omitted, the location's current phone is copied into this record.
 *       Location.phone is not updated. routingLive true is rejected. No carrier change is made.
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: header
 *         name: Authorization
 *         required: true
 *         schema: { type: string }
 *       - in: header
 *         name: Content-Type
 *         required: true
 *         schema: { type: string, example: application/json }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/BranchPhoneNumberWrite'
 *           example:
 *             locationId: 507f1f77bcf86cd799439011
 *             existingPhoneNumber: "+1-555-0100"
 *             provider: existing_carrier
 *             aiEnabled: false
 *             businessHours:
 *               timezone: America/New_York
 *               schedule:
 *                 - { day: mon, closed: false, open: "08:00", close: "18:00" }
 *             humanFallbackNumber: "+1-555-0199"
 *             transferNumber: "+1-555-0198"
 *             forwarding:
 *               mode: none
 *               destination: ""
 *               notes: ""
 *               routingLive: false
 *     responses:
 *       201:
 *         description: Configuration stored. Carrier routing was not changed.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 phoneNumber:
 *                   $ref: '#/components/schemas/BranchPhoneNumber'
 *       400:
 *         description: Validation error, including an attempt to enable live routing
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
 *         description: Branch not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorMessage'
 *       409:
 *         description: The same number is already configured
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
router.get('/', listPhoneNumberValidators, validateRequest, phoneNumberController.listPhoneNumbers);
router.post(
  '/',
  createPhoneNumberValidators,
  validateRequest,
  phoneNumberController.createPhoneNumber,
);

/**
 * @swagger
 * /api/ai-receptionist/phone-numbers/{id}:
 *   get:
 *     tags: [Phone Numbers]
 *     summary: Get one phone configuration
 *     description: Admin only. Returns the stored configuration and the branch name from the existing location.
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: header
 *         name: Authorization
 *         required: true
 *         schema: { type: string }
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *         description: Phone configuration id.
 *     responses:
 *       200:
 *         description: Phone configuration
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 phoneNumber:
 *                   $ref: '#/components/schemas/BranchPhoneNumber'
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
 *         description: Phone number not found
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
 *     tags: [Phone Numbers]
 *     summary: Update a phone configuration
 *     description: >
 *       Admin only. Partial update of assignment, number, provider, AI flag, hours, fallback, transfer, and forwarding intent.
 *       Does not update the location record. Rejects routingLive true. connectionStatus stays not_connected.
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: header
 *         name: Authorization
 *         required: true
 *         schema: { type: string }
 *       - in: header
 *         name: Content-Type
 *         required: true
 *         schema: { type: string, example: application/json }
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/BranchPhoneNumberWrite'
 *           example:
 *             aiEnabled: false
 *             provider: existing_carrier
 *             forwarding:
 *               mode: none
 *               routingLive: false
 *     responses:
 *       200:
 *         description: Updated configuration
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 phoneNumber:
 *                   $ref: '#/components/schemas/BranchPhoneNumber'
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
 *         description: Phone number or branch not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorMessage'
 *       409:
 *         description: Number already configured on another record
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
 *     tags: [Phone Numbers]
 *     summary: Delete a phone configuration
 *     description: >
 *       Admin only. Deletes this receptionist configuration record.
 *       Does not delete the branch and does not disconnect or port the carrier number.
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: header
 *         name: Authorization
 *         required: true
 *         schema: { type: string }
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Configuration removed. routingChanged is always false.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               required: [ok, deletedId, routingChanged]
 *               properties:
 *                 ok: { type: boolean, example: true }
 *                 deletedId: { type: string }
 *                 routingChanged: { type: boolean, example: false }
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
 *         description: Phone number not found
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
router.get('/:id', phoneNumberIdValidators, validateRequest, phoneNumberController.getPhoneNumber);
router.patch(
  '/:id',
  updatePhoneNumberValidators,
  validateRequest,
  phoneNumberController.updatePhoneNumber,
);
router.delete(
  '/:id',
  phoneNumberIdValidators,
  validateRequest,
  phoneNumberController.deletePhoneNumber,
);

/**
 * @swagger
 * /api/ai-receptionist/phone-numbers/{id}/test:
 *   post:
 *     tags: [Phone Numbers]
 *     summary: Check phone configuration without dialing
 *     description: >
 *       Admin only. Records a non-destructive check. No call is placed.
 *       No forward, SIP registration, or carrier change is attempted.
 *       placedCall and routingChanged are always false.
 *       The result is unavailable when no telephony provider is connected,
 *       or invalid when the assigned branch is missing or disabled.
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: header
 *         name: Authorization
 *         required: true
 *         schema: { type: string }
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Check stored. No live call was made.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/PhoneNumberTestResponse'
 *             example:
 *               test:
 *                 result: unavailable
 *                 message: No telephony provider is connected, so this number was not dialed.
 *                 placedCall: false
 *                 routingChanged: false
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
 *         description: Phone number not found
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
  '/:id/test',
  phoneNumberIdValidators,
  validateRequest,
  phoneNumberController.testPhoneNumber,
);

export default router;
