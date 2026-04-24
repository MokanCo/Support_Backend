import { asyncHandler } from '../utils/asyncHandler.js';
import * as conversationService from '../services/conversationService.js';

export const inbox = asyncHandler(async (req, res) => {
  const payload = await conversationService.listAdminInbox(req.user);
  res.status(200).json(payload);
});
