import mongoose from 'mongoose';
import Ticket from '../models/Ticket.js';
import Location from '../models/Location.js';
import User from '../models/User.js';
import { AppError } from '../utils/AppError.js';
import { assertCanAccessTicket } from './accessService.js';
import { isUserOnline } from '../realtime/presence.js';

async function resolvePrimaryLocationId(fallbackLocationId) {
  const primary = await Location.findOne({
    isPrimary: true,
    isDisabled: { $ne: true },
  })
    .select('_id')
    .lean();
  if (primary?._id) return primary._id;
  if (fallbackLocationId && mongoose.Types.ObjectId.isValid(String(fallbackLocationId))) {
    return new mongoose.Types.ObjectId(String(fallbackLocationId));
  }
  return null;
}

async function listPrimarySupportUsers(fallbackLocationId) {
  const locId = await resolvePrimaryLocationId(fallbackLocationId);
  if (!locId) return [];
  const users = await User.find({
    locationId: locId,
    role: 'support',
    isDisabled: { $ne: true },
  })
    .select('name email')
    .sort({ name: 1 })
    .lean();
  return users.map((u) => ({
    id: String(u._id),
    name: String(u.name ?? '').trim() || String(u.email ?? '').trim() || 'Support',
  }));
}

function terminalStatus(status) {
  return status === 'completed' || status === 'cancelled';
}

/**
 * Partner chat header: stacked primary-location support when unassigned;
 * single assignee (with live online) when assigned.
 * @param {{ id: string; role: string; locationId: string | null }} actor
 * @param {string} ticketId
 */
export async function buildTicketChatHeaderState(actor, ticketId) {
  const ticket = await Ticket.findById(ticketId)
    .populate('assignedTo', 'name email role')
    .lean();
  assertCanAccessTicket(actor, ticket);
  if (!ticket) {
    throw new AppError('Ticket not found', 404);
  }

  const status = String(ticket.status ?? 'open');
  const closed = terminalStatus(status);
  const locId = ticket.locationId ? String(ticket.locationId) : null;

  const assignedPop =
    ticket.assignedTo && typeof ticket.assignedTo === 'object' && ticket.assignedTo._id != null
      ? ticket.assignedTo
      : null;
  const assignedId = assignedPop
    ? String(assignedPop._id)
    : ticket.assignedTo != null
      ? String(ticket.assignedTo)
      : null;

  if (assignedId) {
    const name =
      assignedPop?.name != null
        ? String(assignedPop.name).trim()
        : '';
    const displayName = name || 'Support team member';
    return {
      status,
      assignedTo: assignedId,
      assignedToName: displayName,
      supportTeam: [
        {
          id: assignedId,
          name: displayName,
          online: !closed && isUserOnline(assignedId),
        },
      ],
    };
  }

  const team = await listPrimarySupportUsers(locId);
  return {
    status,
    assignedTo: null,
    assignedToName: null,
    supportTeam: team.map((u) => ({
      id: u.id,
      name: u.name,
      online: !closed && isUserOnline(u.id),
    })),
  };
}
