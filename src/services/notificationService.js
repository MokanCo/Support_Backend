import mongoose from 'mongoose';
import Ticket from '../models/Ticket.js';
import User from '../models/User.js';
import UserNotification from '../models/UserNotification.js';
import { AppError } from '../utils/AppError.js';
import { emitUserNotification } from '../realtime/messageHub.js';

const STATUS_CHANNEL = 'status';

/**
 * Idempotent: one active (non-dismissed) ticket_completed per creator per ticket.
 * @param {import('mongoose').Types.ObjectId | string} ticketId
 */
export async function createTicketCompletedStatusNotification(ticketId) {
  const t = await Ticket.findById(ticketId)
    .select('createdBy ticketId title status')
    .lean();
  if (!t || !t.createdBy) return;

  const creatorId =
    typeof t.createdBy === 'object' && t.createdBy !== null
      ? t.createdBy._id ?? t.createdBy
      : t.createdBy;

  const existing = await UserNotification.findOne({
    userId: creatorId,
    ticketId: t._id,
    channel: STATUS_CHANNEL,
    kind: 'ticket_completed',
    dismissedAt: null,
  })
    .select('_id')
    .lean();
  if (existing) return;

  const ref = t.ticketId != null ? String(t.ticketId) : '—';
  const title = 'Ticket completed';
  const body = `Your ticket ${ref} — ${String(t.title ?? '').trim() || '—'} — has been marked completed.`;

  const doc = await UserNotification.create({
    userId: creatorId,
    channel: STATUS_CHANNEL,
    kind: 'ticket_completed',
    ticketId: t._id,
    title,
    body,
  });

  const createdAt =
    doc && doc.createdAt instanceof Date
      ? doc.createdAt.toISOString()
      : new Date().toISOString();

  emitUserNotification(String(creatorId), {
    id: String(doc._id),
    channel: STATUS_CHANNEL,
    kind: 'ticket_completed',
    ticketId: String(t._id),
    title,
    body,
    createdAt,
  });
}

/**
 * Notify every admin when a new ticket is created (in-app + socket).
 * @param {import('mongoose').Types.ObjectId | string} ticketObjectId
 */
export async function createTicketCreatedAdminNotifications(ticketObjectId) {
  const t = await Ticket.findById(ticketObjectId).select('ticketId title').lean();
  if (!t) return;

  const admins = await User.find({ role: 'admin' }).select('_id').lean();
  if (!admins.length) return;

  const ref = t.ticketId != null ? String(t.ticketId) : '—';
  const titleN = 'New ticket';
  const body = `${ref} — ${String(t.title ?? '').trim() || '—'} was created.`;

  for (const a of admins) {
    const adminId = a._id;
    // eslint-disable-next-line no-await-in-loop
    const existing = await UserNotification.findOne({
      userId: adminId,
      ticketId: t._id,
      channel: STATUS_CHANNEL,
      kind: 'ticket_created',
      dismissedAt: null,
    })
      .select('_id')
      .lean();
    if (existing) continue;

    // eslint-disable-next-line no-await-in-loop
    const doc = await UserNotification.create({
      userId: adminId,
      channel: STATUS_CHANNEL,
      kind: 'ticket_created',
      ticketId: t._id,
      title: titleN,
      body,
    });

    const createdAt =
      doc && doc.createdAt instanceof Date
        ? doc.createdAt.toISOString()
        : new Date().toISOString();

    emitUserNotification(String(adminId), {
      id: String(doc._id),
      channel: STATUS_CHANNEL,
      kind: 'ticket_created',
      ticketId: String(t._id),
      title: titleN,
      body,
      createdAt,
    });
  }
}

/**
 * @param {{ id: string }} actor
 * @param {{ channel?: string }} query
 */
export async function listNotificationsForUser(actor, query) {
  const raw = typeof query.channel === 'string' ? query.channel.trim() : 'status';
  const channel = raw === 'sms' ? 'sms' : STATUS_CHANNEL;
  const rows = await UserNotification.find({
    userId: new mongoose.Types.ObjectId(actor.id),
    channel,
    dismissedAt: null,
  })
    .sort({ createdAt: -1 })
    .limit(100)
    .lean();

  return rows.map((r) => ({
    id: String(r._id),
    channel: r.channel,
    kind: r.kind,
    ticketId: r.ticketId ? String(r.ticketId) : null,
    title: r.title,
    body: r.body,
    createdAt: r.createdAt,
  }));
}

/**
 * @param {{ id: string }} actor
 * @param {{ channel: string; notificationId?: string; clearAll?: boolean }} body
 */
export async function dismissNotifications(actor, body) {
  const raw = body.channel != null ? String(body.channel) : 'status';
  if (raw !== 'status' && raw !== 'sms') {
    throw new AppError('channel must be status or sms', 400);
  }
  const channel = raw;

  const userOid = new mongoose.Types.ObjectId(actor.id);
  const now = new Date();

  if (body.clearAll) {
    const res = await UserNotification.updateMany(
      { userId: userOid, channel, dismissedAt: null },
      { $set: { dismissedAt: now } },
    );
    return { ok: true, modified: res.modifiedCount ?? 0 };
  }

  const nid = body.notificationId != null ? String(body.notificationId).trim() : '';
  if (!nid || !mongoose.Types.ObjectId.isValid(nid)) {
    throw new AppError('notificationId is required unless clearAll is true', 400);
  }

  const doc = await UserNotification.findOneAndUpdate(
    { _id: nid, userId: userOid, channel, dismissedAt: null },
    { $set: { dismissedAt: now } },
    { new: true },
  ).lean();

  if (!doc) {
    throw new AppError('Notification not found or already dismissed', 404);
  }
  return { ok: true, modified: 1 };
}
