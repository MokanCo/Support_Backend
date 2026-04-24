import mongoose from 'mongoose';
import Message from '../models/Message.js';
import Ticket from '../models/Ticket.js';
import TicketThreadRead from '../models/TicketThreadRead.js';
import { AppError } from '../utils/AppError.js';

/**
 * Admin inbox: one row per ticket that has messages, latest activity first.
 * @param {{ id: string; role: string }} actor
 */
export async function listAdminInbox(actor) {
  if (actor.role !== 'admin') {
    throw new AppError('Forbidden', 403);
  }

  const grouped = await Message.aggregate([
    { $sort: { createdAt: -1 } },
    {
      $group: {
        _id: '$ticketId',
        lastCreatedAt: { $first: '$createdAt' },
        lastText: { $first: '$text' },
        lastSenderId: { $first: '$senderId' },
      },
    },
    { $sort: { lastCreatedAt: -1 } },
  ]);

  if (grouped.length === 0) {
    return { conversations: [] };
  }

  const ticketIds = grouped.map((g) => g._id);
  const tickets = await Ticket.find({ _id: { $in: ticketIds } })
    .select('title ticketId locationId')
    .populate('locationId', 'name')
    .lean();

  const ticketMap = new Map(tickets.map((t) => [String(t._id), t]));
  const userOid = new mongoose.Types.ObjectId(actor.id);

  const reads = await TicketThreadRead.find({
    userId: userOid,
    ticketId: { $in: ticketIds },
  }).lean();
  const readMap = new Map(reads.map((r) => [String(r.ticketId), new Date(r.lastReadAt)]));

  const conversations = [];
  for (const g of grouped) {
    const tid = String(g._id);
    const ticket = ticketMap.get(tid);
    if (!ticket) continue;

    const lastRead = readMap.get(tid) ?? new Date(0);
    const unreadCount = await Message.countDocuments({
      ticketId: g._id,
      senderId: { $ne: userOid },
      createdAt: { $gt: lastRead },
    });

    const loc = ticket.locationId;
    const locationName =
      loc && typeof loc === 'object' && loc != null && 'name' in loc && loc.name != null
        ? String(loc.name)
        : null;

    const rawText = g.lastText != null ? String(g.lastText) : '';
    const lastAt = g.lastCreatedAt instanceof Date ? g.lastCreatedAt : new Date(g.lastCreatedAt);

    conversations.push({
      ticketId: tid,
      title: ticket.title != null ? String(ticket.title) : '',
      ticketCode: ticket.ticketId != null ? String(ticket.ticketId) : null,
      locationName,
      lastMessageAt: lastAt.toISOString(),
      lastMessagePreview: rawText.slice(0, 200),
      lastSenderId: String(g.lastSenderId),
      unreadCount,
    });
  }

  return { conversations };
}
