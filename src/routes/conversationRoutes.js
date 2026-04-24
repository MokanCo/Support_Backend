import { Router } from 'express';
import * as conversationController from '../controllers/conversationController.js';
import { authMiddleware } from '../middleware/authMiddleware.js';
import { roleMiddleware } from '../middleware/roleMiddleware.js';

const router = Router();

router.use(authMiddleware);
router.use(roleMiddleware(['admin']));

router.get('/inbox', conversationController.inbox);

export default router;
