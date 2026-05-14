import mongoose from 'mongoose';
import User from '../models/User.js';
import { sendBoardMentionEmail } from './boardMailService.js';

const MENTION_RE = /<@([a-f0-9]{24})>/gi;

/**
 * @param {string} comment
 * @returns {string[]}
 */
export function extractMentionedUserIds(comment) {
  if (!comment || typeof comment !== 'string') return [];
  const ids = new Set();
  let m;
  const re = new RegExp(MENTION_RE.source, 'gi');
  while ((m = re.exec(comment)) !== null) {
    if (mongoose.Types.ObjectId.isValid(m[1])) ids.add(m[1]);
  }
  return [...ids];
}

/**
 * @param {{
 *   comment: string;
 *   taskTitle: string;
 *   taskUrl: string;
 *   authorId: string;
 *   authorName: string;
 * }} opts
 */
export async function notifyMentionedUsersInComment(opts) {
  const ids = extractMentionedUserIds(opts.comment);
  const authorId = String(opts.authorId || '');
  for (const uid of ids) {
    if (uid === authorId) continue;
    // eslint-disable-next-line no-await-in-loop
    const u = await User.findById(uid).select('email name').lean();
    if (!u?.email) continue;
    // eslint-disable-next-line no-await-in-loop
    await sendBoardMentionEmail({
      to: String(u.email).trim(),
      mentionedName: u.name != null ? String(u.name) : 'there',
      authorName: opts.authorName || 'Teammate',
      taskTitle: opts.taskTitle || 'Board task',
      commentText: opts.comment,
      taskUrl: opts.taskUrl,
    });
  }
}

/**
 * Single mention (API /notifications/mention).
 */
export async function notifyOneMention(payload) {
  const uid = String(payload.mentionedUserId || '').trim();
  if (!mongoose.Types.ObjectId.isValid(uid)) {
    return { ok: false, error: 'Invalid mentionedUserId' };
  }
  const u = await User.findById(uid).select('email name').lean();
  if (!u?.email) return { ok: false, error: 'User not found' };
  await sendBoardMentionEmail({
    to: String(u.email).trim(),
    mentionedName: u.name != null ? String(u.name) : 'there',
    authorName: String(payload.authorName || 'Teammate'),
    taskTitle: String(payload.taskTitle || 'Board task'),
    commentText: String(payload.commentText || ''),
    taskUrl: String(payload.taskUrl || ''),
  });
  return { ok: true };
}
