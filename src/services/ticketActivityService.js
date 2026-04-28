import mongoose from 'mongoose';
import Ticket from '../models/Ticket.js';
import TicketActivity from '../models/TicketActivity.js';
import { AppError } from '../utils/AppError.js';

/**
 * @param {string} ticketIdOrCode
 * @returns {Promise<import('mongoose').Types.ObjectId | null>}
 */
export async function resolveTicketObjectId(ticketIdOrCode) {
  const s = String(ticketIdOrCode || '').trim();
  if (!s) return null;
  if (mongoose.Types.ObjectId.isValid(s) && s.length === 24) {
    const t = await Ticket.findById(s).select('_id').lean();
    if (t?._id) return t._id;
  }
  const byCode = await Ticket.findOne({ ticketId: s }).select('_id').lean();
  return byCode?._id ?? null;
}

/**
 * @param {{ id: string; role: string }} user
 * @param {{ _id: unknown; assignedTo?: unknown } | null} ticket
 */
export function assertTicketActivityAccess(user, ticket) {
  if (!ticket) {
    throw new AppError('Ticket not found', 404);
  }
  if (user.role === 'partner') {
    throw new AppError('Forbidden', 403);
  }
  if (user.role === 'support') {
    const a = ticket.assignedTo;
    const assignedStr =
      a == null
        ? null
        : typeof a === 'object' && a !== null && '_id' in a && a._id != null
          ? String(a._id)
          : String(a);
    if (!assignedStr || assignedStr !== user.id) {
      throw new AppError('Forbidden', 403);
    }
  }
}

/**
 * @param {string} ticketIdOrCode
 */
async function loadTicketForActivity(ticketIdOrCode) {
  const oid = await resolveTicketObjectId(ticketIdOrCode);
  if (!oid) return null;
  return Ticket.findById(oid).lean();
}

/**
 * @param {{ id: string; role: string }} user
 * @param {string} ticketIdOrCode
 */
export async function listTicketActivitiesForUser(user, ticketIdOrCode) {
  const ticket = await loadTicketForActivity(ticketIdOrCode);
  assertTicketActivityAccess(user, ticket);
  const tid = ticket._id;
  const rows = await TicketActivity.find({ ticket: tid }).sort({ createdAt: 1 }).lean();
  return rows.map((doc) => ({
    id: String(doc._id),
    createdAt: doc.createdAt instanceof Date ? doc.createdAt : new Date(doc.createdAt),
    type: doc.kind,
    kind: doc.kind,
    actorName: doc.actorName,
    summary: doc.summary,
    meta:
      doc.meta && typeof doc.meta === 'object' && !Array.isArray(doc.meta)
        ? doc.meta
        : undefined,
  }));
}

/**
 * @param {{ id: string; role: string }} user
 * @param {string} ticketIdOrCode
 * @param {Array<Record<string, unknown>>} rawActivities
 */
export async function appendTicketActivitiesForUser(user, ticketIdOrCode, rawActivities) {
  const ticket = await loadTicketForActivity(ticketIdOrCode);
  assertTicketActivityAccess(user, ticket);
  if (!Array.isArray(rawActivities) || rawActivities.length === 0) {
    return { inserted: 0 };
  }
  const tid = ticket._id;
  const entries = rawActivities
    .filter((row) => Boolean(row && typeof row === 'object'))
    .map((row) => {
      const kind = String(row.type ?? row.kind ?? 'unknown');
      const summary = String(row.summary ?? '').trim();
      const actorName = String(row.actorName ?? 'Someone').trim().slice(0, 200) || 'Someone';
      const createdAt =
        row.createdAt != null ? new Date(String(row.createdAt)) : undefined;
      const meta =
        row.meta && typeof row.meta === 'object' && !Array.isArray(row.meta) ? row.meta : undefined;
      return {
        kind: kind.slice(0, 64),
        summary: summary.slice(0, 2000) || 'Update',
        actorName,
        createdAt: createdAt && !Number.isNaN(createdAt.getTime()) ? createdAt : undefined,
        meta,
      };
    })
    .filter((e) => e.summary.length > 0);

  if (entries.length === 0) {
    return { inserted: 0 };
  }

  const actorOid =
    mongoose.Types.ObjectId.isValid(user.id) && String(user.id).length === 24
      ? new mongoose.Types.ObjectId(user.id)
      : null;

  const docs = entries.map((e) => ({
    ticket: tid,
    kind: e.kind,
    summary: e.summary,
    actorName: e.actorName,
    actor: actorOid,
    meta: e.meta,
    createdAt: e.createdAt ?? new Date(),
  }));

  await TicketActivity.insertMany(docs);
  return { inserted: docs.length };
}
