import { asyncHandler } from '../utils/asyncHandler.js';
import { AppError } from '../utils/AppError.js';
import * as notificationService from '../services/notificationService.js';
import { notifyOneMention } from '../services/boardMentionNotifyService.js';

export const listNotifications = asyncHandler(async (req, res) => {
  const items = await notificationService.listNotificationsForUser(req.user, req.query);
  res.status(200).json({ notifications: items });
});

export const dismissNotifications = asyncHandler(async (req, res) => {
  const result = await notificationService.dismissNotifications(req.user, req.body ?? {});
  res.status(200).json(result);
});

/** @see boardMentionNotifyService — used when mention is triggered outside task comments. */
export const postMentionEmail = asyncHandler(async (req, res) => {
  const { mentionedUserId, taskTitle, commentText, taskUrl } = req.body ?? {};
  if (!mentionedUserId || !taskUrl) {
    throw new AppError('mentionedUserId and taskUrl required', 400);
  }
  const r = await notifyOneMention({
    mentionedUserId,
    taskTitle: taskTitle ?? 'Board task',
    commentText: commentText ?? '',
    taskUrl,
    authorName: req.user.name || req.user.email || 'Teammate',
  });
  if (!r.ok) throw new AppError(r.error || 'Failed to send', 400);
  res.status(200).json({ ok: true });
});
