import { Router } from 'express';
import * as locationController from '../controllers/locationController.js';
import { authMiddleware } from '../middleware/authMiddleware.js';
import { roleMiddleware } from '../middleware/roleMiddleware.js';
import { validateRequest } from '../middleware/validate.js';
import {
  createLocationValidators,
  locationIdParamValidators,
  listLocationsQueryValidators,
  updateLocationValidators,
  bulkLocationIdsValidators,
} from '../utils/validators.js';

const router = Router();

router.use(authMiddleware);

/**
 * @swagger
 * /api/locations:
 *   post:
 *     tags: [Locations]
 *     summary: Create location
 *     description: Admin only. Creates a new location (organization).
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/CreateLocationRequest'
 *           example:
 *             name: Mokanco HQ
 *             email: hq@example.com
 *             phone: +1-555-0100
 *             address: 100 Support Way
 *     responses:
 *       201:
 *         description: Created
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 location:
 *                   $ref: '#/components/schemas/Location'
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
 *         description: Forbidden (not admin)
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
 *     tags: [Locations]
 *     summary: List locations
 *     description: Admin and support see all locations; partners only their own.
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: List of locations
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 total:
 *                   type: integer
 *                 page:
 *                   type: integer
 *                 pageSize:
 *                   type: integer
 *                 totalPages:
 *                   type: integer
 *       401:
 *         description: Unauthorized
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorMessage'
 *       403:
 *         description: Partner missing location
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
  '/',
  roleMiddleware(['admin']),
  createLocationValidators,
  validateRequest,
  locationController.createLocation,
);

router.get(
  '/',
  listLocationsQueryValidators,
  validateRequest,
  locationController.listLocations,
);

/**
 * @swagger
 * /api/locations/bulk:
 *   post:
 *     tags: [Locations]
 *     summary: Bulk delete locations
 *     description: Admin only. Deletes each id if no users or tickets reference the location.
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [ids]
 *             properties:
 *               ids:
 *                 type: array
 *                 items: { type: string }
 *     responses:
 *       200:
 *         description: Count deleted
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 deleted: { type: integer }
 *       400: { description: Validation error }
 *       401: { description: Unauthorized }
 *       403: { description: Forbidden }
 *       409: { description: Location has users or tickets }
 *       500: { description: Server error }
 */
router.post(
  '/bulk',
  roleMiddleware(['admin']),
  bulkLocationIdsValidators,
  validateRequest,
  locationController.bulkDeleteLocations,
);

/**
 * @swagger
 * /api/locations/{id}:
 *   patch:
 *     tags: [Locations]
 *     summary: Update location
 *     description: Admin only. Partial update including soft-disable via isDisabled.
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               name: { type: string }
 *               email: { type: string }
 *               phone: { type: string }
 *               address: { type: string }
 *               isDisabled: { type: boolean }
 *     responses:
 *       200:
 *         description: Updated location
 *       400: { description: Validation error }
 *       401: { description: Unauthorized }
 *       403: { description: Forbidden }
 *       404: { description: Not found }
 *       500: { description: Server error }
 *   delete:
 *     tags: [Locations]
 *     summary: Delete location
 *     description: Admin only. Fails if users or tickets still reference the location.
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Deleted
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 ok: { type: boolean }
 *       401: { description: Unauthorized }
 *       403: { description: Forbidden }
 *       404: { description: Not found }
 *       409: { description: Conflict }
 *       500: { description: Server error }
 *   get:
 *     tags: [Locations]
 *     summary: Get location by ID
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Location MongoDB id
 *     responses:
 *       200:
 *         description: Location and users assigned to it
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 location:
 *                   $ref: '#/components/schemas/Location'
 *                 users:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/User'
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
router.get(
  '/:id/delete-impact',
  roleMiddleware(['admin']),
  locationIdParamValidators,
  validateRequest,
  locationController.getDeleteImpact,
);
router.patch(
  '/:id',
  roleMiddleware(['admin']),
  updateLocationValidators,
  validateRequest,
  locationController.updateLocation,
);
router.delete(
  '/:id',
  roleMiddleware(['admin']),
  locationIdParamValidators,
  validateRequest,
  locationController.deleteLocation,
);
router.get(
  '/:id',
  locationIdParamValidators,
  validateRequest,
  locationController.getLocation,
);

export default router;
