import { Router } from 'express';
import * as onboardingController from '../controllers/onboardingController.js';
import { authMiddleware } from '../middleware/authMiddleware.js';
import { roleMiddleware } from '../middleware/roleMiddleware.js';
import { validateRequest } from '../middleware/validate.js';
import {
  createOnboardingServiceValidators,
  deleteOnboardingServiceValidators,
  draftOnboardingValidators,
  listOnboardingRequestsValidators,
  onboardingRequestIdValidators,
  onboardingTrackingTokenValidators,
  rejectOnboardingValidators,
  reviewOnboardingValidators,
  submitOnboardingValidators,
  updateDraftServicesValidators,
  updateOnboardingConfigValidators,
  updateOnboardingServiceValidators,
  updateOnboardingTaskValidators,
} from '../utils/validators.js';

const router = Router();

/**
 * @swagger
 * /api/onboarding/config:
 *   get:
 *     tags: [Onboarding]
 *     summary: Get onboarding wizard configuration
 *     description: Public endpoint returning welcome copy, step labels, and success messages for the login-page onboarding wizard.
 *     security: []
 *     responses:
 *       200:
 *         description: Onboarding configuration
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 config:
 *                   $ref: '#/components/schemas/OnboardingConfig'
 *       503:
 *         description: Onboarding disabled
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorMessage'
 */
router.get('/config', onboardingController.getConfig);

/**
 * @swagger
 * /api/onboarding/services:
 *   get:
 *     tags: [Onboarding]
 *     summary: List active onboarding service options
 *     description: Returns service options grouped by section for the Services step of the wizard.
 *     security: []
 *     responses:
 *       200:
 *         description: Grouped service options
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 sections:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       title: { type: string, example: 'Business Listing' }
 *                       services:
 *                         type: array
 *                         items:
 *                           $ref: '#/components/schemas/OnboardingServiceOption'
 */
router.get('/services', onboardingController.listServices);

/**
 * @swagger
 * /api/onboarding/requests/draft:
 *   post:
 *     tags: [Onboarding]
 *     summary: Create or update a draft onboarding request
 *     description: Called when the user enters the Services step. Stores personal and location info with status `draft`.
 *     security: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [personal, location]
 *             properties:
 *               trackingToken:
 *                 type: string
 *                 description: Pass to refresh an existing draft
 *               personal:
 *                 type: object
 *               location:
 *                 type: object
 *     responses:
 *       201:
 *         description: Draft created or updated
 */
router.post(
  '/requests/draft',
  draftOnboardingValidators,
  validateRequest,
  onboardingController.createDraft,
);

/**
 * @swagger
 * /api/onboarding/requests/{token}/services:
 *   patch:
 *     tags: [Onboarding]
 *     summary: Save selected services on toggle
 *     description: Persists the full selected service list immediately when the user selects or deselects a service.
 *     security: []
 *     parameters:
 *       - in: path
 *         name: token
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [selectedServices]
 *             properties:
 *               selectedServices:
 *                 type: array
 *                 items:
 *                   type: string
 *                 example: ['google', 'yelp']
 *     responses:
 *       200:
 *         description: Draft updated with selections
 *       404:
 *         description: Draft not found
 */
router.patch(
  '/requests/:token/services',
  updateDraftServicesValidators,
  validateRequest,
  onboardingController.updateDraftServices,
);

/**
 * @swagger
 * /api/onboarding/requests/{token}/submit:
 *   post:
 *     tags: [Onboarding]
 *     summary: Finalize draft and submit for review
 *     description: Moves draft to `pending`, sends tracking email and admin notification.
 *     security: []
 *     parameters:
 *       - in: path
 *         name: token
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Request submitted
 *       400:
 *         description: No services selected
 *       404:
 *         description: Draft not found
 */
router.post(
  '/requests/:token/submit',
  onboardingTrackingTokenValidators,
  validateRequest,
  onboardingController.finalizeRequest,
);

/**
 * @swagger
 * /api/onboarding/requests:
 *   post:
 *     tags: [Onboarding]
 *     summary: Submit a new location onboarding request
 *     description: Public endpoint used by the login-page wizard after the Confirm step. Sends tracking email to applicant and notifies admin.
 *     security: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/SubmitOnboardingRequest'
 *     responses:
 *       201:
 *         description: Request created
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 request:
 *                   $ref: '#/components/schemas/OnboardingRequest'
 *                 trackingUrl:
 *                   type: string
 *                   example: 'https://app.example.com/login?onboarding=abc123'
 *                 message:
 *                   type: string
 *       400:
 *         description: Validation error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorMessage'
 *       503:
 *         description: Onboarding disabled
 */
router.post(
  '/requests',
  submitOnboardingValidators,
  validateRequest,
  onboardingController.submitRequest,
);

/**
 * @swagger
 * /api/onboarding/requests/track/{token}:
 *   get:
 *     tags: [Onboarding]
 *     summary: Track onboarding request status
 *     description: Public endpoint for applicants to check review status using the tracking token from their email.
 *     security: []
 *     parameters:
 *       - in: path
 *         name: token
 *         required: true
 *         schema:
 *           type: string
 *         description: Tracking token from submission email
 *     responses:
 *       200:
 *         description: Request status
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 request:
 *                   $ref: '#/components/schemas/OnboardingRequest'
 *                 trackingUrl:
 *                   type: string
 *       404:
 *         description: Request not found
 */
router.get(
  '/requests/track/:token',
  onboardingTrackingTokenValidators,
  validateRequest,
  onboardingController.trackRequest,
);

// All admin routes require authentication; support can read + update tasks
router.use(authMiddleware);
router.use(roleMiddleware(['admin', 'support']));

/**
 * @swagger
 * /api/onboarding/config:
 *   patch:
 *     tags: [Onboarding]
 *     summary: Update onboarding wizard configuration (admin)
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/OnboardingConfig'
 *     responses:
 *       200:
 *         description: Updated configuration
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 config:
 *                   $ref: '#/components/schemas/OnboardingConfig'
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden
 */
router.patch(
  '/config',
  updateOnboardingConfigValidators,
  validateRequest,
  onboardingController.updateConfig,
);

/**
 * @swagger
 * /api/onboarding/admin/services:
 *   get:
 *     tags: [Onboarding]
 *     summary: List all service options including inactive (admin)
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: All service options
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 services:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/OnboardingServiceOption'
 */
router.get('/admin/services', onboardingController.listAllServices);

/**
 * @swagger
 * /api/onboarding/admin/services:
 *   post:
 *     tags: [Onboarding]
 *     summary: Create a service option (admin)
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/CreateOnboardingServiceRequest'
 *     responses:
 *       201:
 *         description: Service created
 *       409:
 *         description: Slug already exists
 */
router.post(
  '/admin/services',
  createOnboardingServiceValidators,
  validateRequest,
  onboardingController.createService,
);

/**
 * @swagger
 * /api/onboarding/admin/services/{id}:
 *   patch:
 *     tags: [Onboarding]
 *     summary: Update a service option (admin)
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
 *             $ref: '#/components/schemas/CreateOnboardingServiceRequest'
 *     responses:
 *       200:
 *         description: Service updated
 *       404:
 *         description: Not found
 */
router.patch(
  '/admin/services/:id',
  updateOnboardingServiceValidators,
  validateRequest,
  onboardingController.updateService,
);

/**
 * @swagger
 * /api/onboarding/admin/services/{id}:
 *   delete:
 *     tags: [Onboarding]
 *     summary: Delete a service option (admin)
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
 *       404:
 *         description: Not found
 */
router.delete(
  '/admin/services/:id',
  deleteOnboardingServiceValidators,
  validateRequest,
  onboardingController.deleteService,
);

/**
 * @swagger
 * /api/onboarding/admin/requests:
 *   get:
 *     tags: [Onboarding]
 *     summary: List onboarding requests (admin)
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *           enum: [pending, approved, rejected]
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *           minimum: 1
 *       - in: query
 *         name: pageSize
 *         schema:
 *           type: integer
 *           minimum: 1
 *           maximum: 100
 *     responses:
 *       200:
 *         description: Paginated requests
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 requests:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/OnboardingRequest'
 *                 total: { type: integer }
 *                 page: { type: integer }
 *                 pageSize: { type: integer }
 *                 totalPages: { type: integer }
 */
router.get(
  '/admin/requests',
  listOnboardingRequestsValidators,
  validateRequest,
  onboardingController.listRequests,
);

/**
 * @swagger
 * /api/onboarding/admin/requests/{id}:
 *   get:
 *     tags: [Onboarding]
 *     summary: Get onboarding request detail (admin)
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
 *         description: Request detail
 *       404:
 *         description: Not found
 */
router.get(
  '/admin/requests/:id',
  onboardingRequestIdValidators,
  validateRequest,
  onboardingController.getRequest,
);

/**
 * @swagger
 * /api/onboarding/admin/requests/{id}/review:
 *   patch:
 *     tags: [Onboarding]
 *     summary: Approve or reject an onboarding request (admin)
 *     description: On approval, creates a Location and partner User (with portal invite email).
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
 *             $ref: '#/components/schemas/ReviewOnboardingRequest'
 *     responses:
 *       200:
 *         description: Review recorded
 *       409:
 *         description: Already reviewed
 */
router.patch(
  '/admin/requests/:id/review',
  reviewOnboardingValidators,
  validateRequest,
  onboardingController.reviewRequest,
);

// Admin-only: approve, reject, provision, sync
router.post(
  '/admin/requests/:id/approve',
  roleMiddleware(['admin']),
  onboardingRequestIdValidators,
  validateRequest,
  onboardingController.approveRequest,
);

router.post(
  '/admin/requests/:id/reject',
  roleMiddleware(['admin']),
  rejectOnboardingValidators,
  validateRequest,
  onboardingController.rejectRequest,
);

router.post(
  '/admin/requests/:id/provision',
  roleMiddleware(['admin']),
  onboardingRequestIdValidators,
  validateRequest,
  onboardingController.provisionRequest,
);

// Admin + support: update tasks
router.patch(
  '/admin/requests/:id/tasks/:taskId',
  updateOnboardingTaskValidators,
  validateRequest,
  onboardingController.updateTask,
);

router.post('/admin/templates/sync', roleMiddleware(['admin']), onboardingController.syncTemplates);

export default router;
