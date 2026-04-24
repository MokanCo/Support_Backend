import { Router } from 'express';
import * as analyticsController from '../controllers/analyticsController.js';
import { authMiddleware } from '../middleware/authMiddleware.js';

const router = Router();

/**
 * @swagger
 * /api/analytics/dashboard:
 *   get:
 *     tags: [Analytics]
 *     summary: Staff dashboard metrics
 *     security:
 *       - bearerAuth: []
 */
router.get('/dashboard', authMiddleware, analyticsController.dashboard);

export default router;
