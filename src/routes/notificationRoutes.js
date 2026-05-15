import express from 'express';
import { authMiddleware } from '../middleware/authMiddleware.js';
import * as notificationController from '../controllers/notificationController.js';

const router = express.Router();

router.use(authMiddleware);

router.get('/', notificationController.listNotifications);
router.post('/dismiss', notificationController.dismissNotifications);
router.post('/mention', notificationController.postMentionEmail);

export default router;
