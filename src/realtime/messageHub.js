import Ticket from '../models/Ticket.js';
import User from '../models/User.js';

/** @type {import('socket.io').Server | null} */
let io = null;

export function setSocketIo(server) {
  io = server;
}

/**
 * Push a single message row to ticket room and to each interested user's inbox room.
 * @param {string|import('mongoose').Types.ObjectId} ticketId
 * @param {Record<string, unknown>} message Client-shaped message object
 */
/**
 * Push a persisted user notification (e.g. ticket status) to one user's inbox room.
 * @param {string} userId
 * @param {Record<string, unknown>} notification Client-shaped notification (id, channel, kind, ticketId, title, body, createdAt)
 */
export function emitUserNotification(userId, notification) {
  if (!io || !userId) return;
  io.to(`user:${String(userId)}`).emit('notification:new', { notification });
}

export async function emitTicketMessage(ticketId, message) {
  if (!io) return;
  const id = String(ticketId);

  const senderId =
    message && typeof message.senderId === 'string' ? message.senderId : '';

  try {
    const ticket = await Ticket.findById(id)
      .select('title ticketId createdBy assignedTo locationId')
      .lean();
    if (!ticket) return;

    const ticketMeta = {
      title: ticket.title != null ? String(ticket.title).trim() : 'Ticket',
      ticketCode: ticket.ticketId != null ? String(ticket.ticketId) : null,
    };
    const envelope = { ticketId: id, message, ticket: ticketMeta };

    io.to(`ticket:${id}`).emit('message:new', envelope);

    const targets = new Set();
    if (ticket.createdBy) targets.add(String(ticket.createdBy));
    if (ticket.assignedTo) targets.add(String(ticket.assignedTo));
    const admins = await User.find({ role: 'admin' }).select('_id').lean();
    for (const a of admins) targets.add(String(a._id));

    const locOid = ticket.locationId;
    const supportFilter =
      locOid != null
        ? {
            role: 'support',
            $or: [{ locationId: null }, { locationId: locOid }],
          }
        : { role: 'support', locationId: null };
    const supportUsers = await User.find(supportFilter).select('_id').lean();
    for (const s of supportUsers) targets.add(String(s._id));
    targets.delete(senderId);
    for (const uid of targets) {
      io.to(`user:${uid}`).emit('message:new', envelope);
    }
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error('[messageHub] emit failed', e);
  }
}
