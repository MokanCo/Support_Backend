import Ticket from '../models/Ticket.js';

function addEmail(set, raw) {
  const s = String(raw ?? '')
    .trim()
    .toLowerCase();
  if (s) set.add(s);
}

/**
 * Recipients and copy for when a support ticket is marked completed.
 * Uses location contact email, creator, and assignee (deduped).
 * @param {import('mongoose').Types.ObjectId | string} ticketId
 */
export async function getTicketCompletionMailContext(ticketId) {
  const t = await Ticket.findById(ticketId)
    .populate('locationId', 'email name')
    .populate('createdBy', 'email')
    .populate('assignedTo', 'email')
    .lean();

  if (!t) {
    return { to: [], ticketRef: '', title: '', locationName: null };
  }

  const emails = new Set();
  addEmail(emails, t.locationId && typeof t.locationId === 'object' ? t.locationId.email : null);
  addEmail(emails, t.createdBy && typeof t.createdBy === 'object' ? t.createdBy.email : null);
  addEmail(emails, t.assignedTo && typeof t.assignedTo === 'object' ? t.assignedTo.email : null);

  const locationName =
    t.locationId && typeof t.locationId === 'object' && t.locationId.name != null
      ? String(t.locationId.name)
      : null;

  return {
    to: [...emails],
    ticketRef: t.ticketId != null ? String(t.ticketId) : '',
    title: String(t.title ?? ''),
    locationName,
  };
}
