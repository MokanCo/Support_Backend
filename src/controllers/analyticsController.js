import { asyncHandler } from '../utils/asyncHandler.js';
import * as analyticsService from '../services/analyticsService.js';
import { AppError } from '../utils/AppError.js';

export const dashboard = asyncHandler(async (req, res) => {
  if (req.user.role === 'partner') {
    throw new AppError('Forbidden', 403);
  }
  const data = await analyticsService.getDashboardAnalytics(req.user);
  res.status(200).json(data);
});
