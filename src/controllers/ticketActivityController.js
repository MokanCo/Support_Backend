import { asyncHandler } from '../utils/asyncHandler.js';
import { AppError } from '../utils/AppError.js';
import * as ticketActivityService from '../services/ticketActivityService.js';

export const listTicketActivities = asyncHandler(async (req, res) => {
  const activities = await ticketActivityService.listTicketActivitiesForUser(req.user, req.params.id);
  res.status(200).json({ activities });
});

export const appendTicketActivities = asyncHandler(async (req, res) => {
  const body = req.body ?? {};
  const raw = body.activities;
  if (!Array.isArray(raw)) {
    throw new AppError('Expected { activities: [...] }', 400);
  }
  const { inserted } = await ticketActivityService.appendTicketActivitiesForUser(
    req.user,
    req.params.id,
    raw,
  );
  res.status(201).json({ ok: true, inserted });
});
