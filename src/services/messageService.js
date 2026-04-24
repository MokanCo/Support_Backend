import mongoose from 'mongoose';
import Message from '../models/Message.js';
import Ticket from '../models/Ticket.js';
import TicketThreadRead from '../models/TicketThreadRead.js';
import { AppError } from '../utils/AppError.js';
import { assertCanAccessTicket } from './accessService.js';
import { getSystemSenderUserId } from './systemUserService.js';
import { emitTicketMessage } from '../realtime/messageHub.js';

export const AUTO_MESSAGE_TICKET_CREATED =
  'Your ticket has been generated. The related support person will be in contact with you soon.';

export const AUTO_MESSAGE_TICKET_CLOSED =
  'Your ticket has been closed. Please feel free to open a new ticket if needed.';

function idString(ref) {
  if (ref && typeof ref === 'object' && ref._id != null) return String(ref._id);
  return String(ref ?? '');
}

function formatMessage(m) {
  const x = typeof m.toObject === 'function' ? m.toObject() : m;
  return {
    id: String(x._id),
    ticketId: idString(x.ticketId),
    senderId: idString(x.senderId),
    text: x.text,
    createdAt: x.createdAt,
    updatedAt: x.updatedAt,
    isSystem: Boolean(x.isSystem),
    systemEvent: x.systemEvent ?? undefined,
  };
}

/**
 * One message row as returned by GET /api/messages (Mongoose doc or plain with populated senderId).
 * @param {import('mongoose').Document | Record<string, unknown>} m
 */
export function mapMessageDocumentToClientRow(m) {
  const base = formatMessage(m);
  const plain = typeof m.toObject === 'function' ? m.toObject() : m;
  if (plain.isSystem) {
    return {
      ...base,
      senderName: 'Support',
      sender: { id: idString(plain.senderId), name: 'Support', role: 'system' },
    };
  }
  const s = m.senderId;
  if (s && typeof s === 'object' && s._id) {
    const name = s.name != null ? String(s.name).trim() : '';
    const email = s.email != null ? String(s.email).trim() : '';
    const senderName = name || email || 'Unknown';
    return {
      ...base,
      senderName,
      sender: { id: String(s._id), name: s.name, email: s.email, role: s.role },
    };
  }
  return { ...base, senderName: 'Unknown' };
}

/**
 * Idempotent automated thread line (unique per ticketId + systemEvent in DB).
 * @param {string|import('mongoose').Types.ObjectId} ticketId
 * @param {string} text
 * @param {'ticket_created'|'ticket_closed'} systemEvent
 */
export async function sendSystemMessage(ticketId, text, systemEvent) {
  const tid = new mongoose.Types.ObjectId(String(ticketId));
  const senderId = await getSystemSenderUserId();
  try {
    const doc = await Message.create({
      ticketId: tid,
      senderId,
      text,
      isSystem: true,
      systemEvent,
    });
    const populated = await Message.findById(doc._id).populate('senderId', 'name email role');
    if (populated) {
      const row = mapMessageDocumentToClientRow(populated);
      await emitTicketMessage(tid, row);
    }
  } catch (e) {
    if (e && typeof e === 'object' && 'code' in e && e.code === 11000) {
      return;
    }
    throw e;
  }
}

/**
 * @param {{ id: string; role: string; locationId: string | null }} actor
 * @param {{ ticketId: string; text: string }} input
 */
export async function createMessage(actor, input) {
  const ticket = await Ticket.findById(input.ticketId);
  assertCanAccessTicket(actor, ticket);

  const msg = await Message.create({
    ticketId: new mongoose.Types.ObjectId(input.ticketId),
    senderId: new mongoose.Types.ObjectId(actor.id),
    text: input.text.trim(),
    isSystem: false,
  });

  const populated = await Message.findById(msg._id).populate('senderId', 'name email role');
  if (!populated) {
    throw new AppError('Failed to load created message', 500);
  }

  const row = mapMessageDocumentToClientRow(populated);
  await emitTicketMessage(input.ticketId, row);
  return row;
}

/**
 * @param {{ id: string; role: string; locationId: string | null }} actor
 * @param {string} ticketId
 */
export async function listMessagesForTicket(actor, ticketId) {
  if (!ticketId) {
    throw new AppError('ticketId query parameter is required', 400);
  }
  const ticket = await Ticket.findById(ticketId);
  assertCanAccessTicket(actor, ticket);

  const messages = await Message.find({ ticketId })
    .sort({ createdAt: 1 })
    .populate('senderId', 'name email role');
  return messages.map((m) => mapMessageDocumentToClientRow(m));
}

/**
 * @param {{ id: string; role: string; locationId: string | null }} actor
 * @param {string} ticketId
 * @returns {Promise<{ unreadCount: number; preview: string; hasUnread: boolean }>}
 */
export async function getMessageSummaryForTicket(actor, ticketId) {
  if (!ticketId) {
    throw new AppError('ticketId query parameter is required', 400);
  }
  const ticket = await Ticket.findById(ticketId);
  assertCanAccessTicket(actor, ticket);

  const ticketOid = new mongoose.Types.ObjectId(ticketId);
  const userOid = new mongoose.Types.ObjectId(actor.id);

  const receipt = await TicketThreadRead.findOne({ userId: userOid, ticketId: ticketOid }).lean();
  const lastReadAt = receipt?.lastReadAt ? new Date(receipt.lastReadAt) : new Date(0);

  const fromOthers = {
    ticketId: ticketOid,
    senderId: { $ne: userOid },
    createdAt: { $gt: lastReadAt },
  };

  const unreadCount = await Message.countDocuments(fromOthers);

  const latestUnread = await Message.findOne(fromOthers).sort({ createdAt: -1 }).select('text').lean();

  const raw = latestUnread?.text != null ? String(latestUnread.text) : '';
  const preview = raw.length > 200 ? `${raw.slice(0, 200)}…` : raw;

  return {
    unreadCount,
    preview,
    hasUnread: unreadCount > 0,
  };
}

/**
 * @param {{ id: string; role: string; locationId: string | null }} actor
 * @param {string} ticketId
 */
export async function markTicketThreadRead(actor, ticketId) {
  if (!ticketId) {
    throw new AppError('ticketId is required', 400);
  }
  const ticket = await Ticket.findById(ticketId);
  assertCanAccessTicket(actor, ticket);

  const ticketOid = new mongoose.Types.ObjectId(ticketId);
  const userOid = new mongoose.Types.ObjectId(actor.id);
  const now = new Date();

  await TicketThreadRead.findOneAndUpdate(
    { userId: userOid, ticketId: ticketOid },
    { $set: { lastReadAt: now } },
    { upsert: true, new: true },
  );

  return { ok: true };
}
