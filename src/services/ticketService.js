import mongoose from 'mongoose';
import Ticket from '../models/Ticket.js';
import TicketActivity from '../models/TicketActivity.js';
import Message from '../models/Message.js';
import Location from '../models/Location.js';
import User from '../models/User.js';
import { AppError } from '../utils/AppError.js';
import { deadlineInfo } from '../utils/deadline.js';
import { getNextTicketSequence, formatTicketId } from './counterService.js';
import {
  assertCanAccessTicket,
  assertPartnerUsesOwnLocation,
  ticketListFilterForUser,
  ticketListScopeForUser,
} from './accessService.js';
import {
  sendSystemMessage,
  AUTO_MESSAGE_TICKET_CREATED,
  AUTO_MESSAGE_TICKET_CLOSED,
} from './messageService.js';
import { sendTicketCompletedEmails } from './boardMailService.js';
import { getTicketCompletionMailContext } from './ticketStakeholderEmails.js';
import { MAX_TICKET_LIST_PAGE_SIZE } from '../constants/pagination.js';

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function isOverdueForDisplay(deadline, status) {
  if (!deadline) return false;
  if (status === 'completed' || status === 'cancelled') return false;
  const d = deadline instanceof Date ? deadline : new Date(deadline);
  if (Number.isNaN(d.getTime())) return false;
  return d.getTime() < Date.now();
}

const LIST_SORT_FIELDS = [
  'createdAt',
  'updatedAt',
  'title',
  'status',
  'priority',
  'ticketId',
  'deadline',
  'progress',
];

const POPULATE = [
  { path: 'locationId', select: 'name email phone address' },
  { path: 'createdBy', select: 'name email role' },
  { path: 'assignedTo', select: 'name email role' },
];

function assertTicketNotLocked(ticket) {
  if (ticket.progress === 100) {
    throw new AppError('Ticket progress is 100% and this ticket can no longer be modified', 403);
  }
}

async function allocateTicketId(maxAttempts = 8) {
  for (let i = 0; i < maxAttempts; i += 1) {
    const seq = await getNextTicketSequence();
    const ticketId = formatTicketId(seq);
    // eslint-disable-next-line no-await-in-loop
    const clash = await Ticket.exists({ ticketId });
    if (!clash) return ticketId;
  }
  throw new AppError('Could not allocate ticket id', 500);
}

function toPlain(doc) {
  if (!doc) return null;
  return typeof doc.toObject === 'function' ? doc.toObject() : doc;
}

export function formatTicketResponse(ticketDoc) {
  const t = toPlain(ticketDoc);
  if (!t) return null;
  const { overdue } = deadlineInfo(t.deadline);

  const locRef = t.locationId;
  const locationPopulated =
    locRef && typeof locRef === 'object' && locRef._id != null ? locRef : null;
  const locationId = locationPopulated
    ? String(locationPopulated._id)
    : locRef != null
      ? String(locRef)
      : '';
  const locationName =
    locationPopulated && locationPopulated.name != null ? String(locationPopulated.name) : null;

  const createdByPopulated =
    t.createdBy && typeof t.createdBy === 'object' && t.createdBy._id != null ? t.createdBy : null;
  const assignedPopulated =
    t.assignedTo && typeof t.assignedTo === 'object' && t.assignedTo._id != null
      ? t.assignedTo
      : null;

  const createdBy = createdByPopulated
    ? String(createdByPopulated._id)
    : t.createdBy != null
      ? String(t.createdBy)
      : '';
  const assignedTo = assignedPopulated
    ? String(assignedPopulated._id)
    : t.assignedTo != null
      ? String(t.assignedTo)
      : null;

  const deadlineIso = t.deadline ? new Date(t.deadline).toISOString() : null;
  const isOverdue = isOverdueForDisplay(t.deadline, t.status);
  const createdTs = t.createdAt ? new Date(t.createdAt).getTime() : 0;
  const isNew = createdTs > 0 && Date.now() - createdTs < 24 * 60 * 60 * 1000;

  return {
    id: String(t._id),
    ticketId: t.ticketId,
    ticketCode: t.ticketId != null ? String(t.ticketId) : null,
    title: t.title,
    description: t.description,
    category: t.category,
    status: t.status,
    priority: t.priority,
    progress: t.progress,
    deadline: deadlineIso,
    overdue,
    isOverdue,
    locationId,
    locationName,
    location:
      locationPopulated && locationPopulated._id
        ? { _id: locationPopulated._id, name: locationPopulated.name }
        : undefined,
    createdBy,
    createdByName: createdByPopulated?.name != null ? String(createdByPopulated.name) : undefined,
    createdByUser: createdByPopulated ?? undefined,
    assignedTo,
    assignedToName: assignedPopulated?.name != null ? String(assignedPopulated.name) : null,
    assignedToUser: assignedPopulated ?? undefined,
    createdAt: t.createdAt,
    updatedAt: t.updatedAt,
    isNew,
  };
}

/**
 * @param {{ id: string; role: string; locationId: string | null }} actor
 * @param {object} input
 */
export async function createTicket(actor, input) {
  const raw =
    actor.role === 'partner'
      ? actor.locationId
      : input.locationId != null && String(input.locationId).trim() !== ''
        ? String(input.locationId).trim()
        : null;

  if (!raw || !mongoose.Types.ObjectId.isValid(raw)) {
    if (actor.role === 'partner') {
      throw new AppError('Partner account is missing a location', 403);
    }
    throw new AppError('locationId is required', 400);
  }

  assertPartnerUsesOwnLocation(actor, raw);

  const loc = await Location.findById(raw);
  if (!loc) {
    throw new AppError('Location not found', 400);
  }

  const progress = input.progress ?? 0;
  if (progress < 0 || progress > 100) {
    throw new AppError('Progress must be between 0 and 100', 400);
  }

  let assignedTo = null;
  if (input.assignedTo) {
    const assignee = await User.findById(input.assignedTo);
    if (!assignee) {
      throw new AppError('Assigned user not found', 400);
    }
    assignedTo = assignee._id;
  }

  const ticketId = await allocateTicketId();

  const ticket = await Ticket.create({
    ticketId,
    title: input.title.trim(),
    description: (input.description ?? '').trim(),
    category: input.category.trim(),
    status: input.status ?? 'in_queue',
    priority: input.priority ?? 'medium',
    progress,
    deadline: input.deadline ?? null,
    locationId: new mongoose.Types.ObjectId(raw),
    createdBy: new mongoose.Types.ObjectId(actor.id),
    assignedTo,
  });

  const populated = await Ticket.findById(ticket._id).populate(POPULATE);
  try {
    await sendSystemMessage(ticket._id, AUTO_MESSAGE_TICKET_CREATED, 'ticket_created');
  } catch (e) {
    if (!(e && typeof e === 'object' && 'code' in e && e.code === 11000)) {
      // eslint-disable-next-line no-console
      console.error('[ticketService] auto welcome message failed', e);
    }
  }
  return formatTicketResponse(populated);
}

/**
 * @param {{ id: string; role: string; locationId: string | null }} actor
 * @param {{ status?: string; locationId?: string }} query
 */
export async function listTickets(actor, query) {
  /** @type {import('mongoose').FilterQuery<typeof Ticket>} */
  const filter = { ...ticketListScopeForUser(actor) };

  if (query.status) {
    filter.status = query.status;
  }
  if (query.priority) {
    filter.priority = query.priority;
  }
  if (query.locationId && (actor.role === 'admin' || actor.role === 'support')) {
    filter.locationId = new mongoose.Types.ObjectId(query.locationId);
  }
  if (query.overdue === '1' || query.overdue === true) {
    filter.deadline = { $lt: new Date(), $ne: null };
    filter.status = { $nin: ['completed', 'cancelled'] };
  }
  const search = typeof query.search === 'string' ? query.search.trim() : '';
  if (search) {
    const rx = new RegExp(escapeRegex(search), 'i');
    filter.$or = [{ title: rx }, { description: rx }, { ticketId: rx }, { category: rx }];
  }

  const page = Math.max(1, Number(query.page) || 1);
  const pageSize = Math.min(
    MAX_TICKET_LIST_PAGE_SIZE,
    Math.max(1, Number(query.pageSize) || 20),
  );
  let sortField = typeof query.sort === 'string' ? query.sort : 'updatedAt';
  if (sortField === 'ticketCode') sortField = 'ticketId';
  if (!LIST_SORT_FIELDS.includes(sortField)) sortField = 'updatedAt';
  const order = query.order === 'asc' ? 1 : -1;
  /** @type {Record<string, 1 | -1>} */
  const sort = { [sortField]: order };

  const [total, ticketDocs] = await Promise.all([
    Ticket.countDocuments(filter),
    Ticket.find(filter)
      .sort(sort)
      .skip((page - 1) * pageSize)
      .limit(pageSize)
      .populate(POPULATE)
      .lean(),
  ]);

  const tickets = ticketDocs.map((doc) => formatTicketResponse(doc)).filter(Boolean);

  return {
    tickets,
    total,
    page,
    pageSize,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
  };
}

export async function getTicketById(actor, id) {
  const ticket = await Ticket.findById(id).populate(POPULATE);
  assertCanAccessTicket(actor, ticket);
  return formatTicketResponse(ticket);
}

/**
 * @param {{ id: string; role: string; locationId: string | null }} actor
 * @param {string} id
 * @param {Record<string, unknown>} patch
 */
export async function updateTicket(actor, id, patch) {
  const ticket = await Ticket.findById(id);
  assertCanAccessTicket(actor, ticket);
  assertTicketNotLocked(ticket);
  const previousStatus = ticket.status;

  if (patch.locationId !== undefined) {
    assertPartnerUsesOwnLocation(actor, String(patch.locationId));
    const loc = await Location.findById(patch.locationId);
    if (!loc) {
      throw new AppError('Location not found', 400);
    }
    ticket.locationId = new mongoose.Types.ObjectId(String(patch.locationId));
  }

  if (patch.title !== undefined) ticket.title = String(patch.title).trim();
  if (patch.description !== undefined) ticket.description = String(patch.description).trim();
  if (patch.category !== undefined) ticket.category = String(patch.category).trim();
  if (patch.status !== undefined) ticket.status = patch.status;
  if (patch.priority !== undefined) ticket.priority = patch.priority;

  if (patch.progress !== undefined) {
    const p = Number(patch.progress);
    if (Number.isNaN(p) || p < 0 || p > 100) {
      throw new AppError('Progress must be between 0 and 100', 400);
    }
    ticket.progress = p;
  }

  if (patch.deadline !== undefined) {
    if (patch.deadline === null || patch.deadline === '') {
      ticket.deadline = null;
    } else {
      const d = new Date(patch.deadline);
      if (Number.isNaN(d.getTime())) {
        throw new AppError('Invalid deadline date', 400);
      }
      ticket.deadline = d;
    }
  }

  if (patch.assignedTo !== undefined) {
    if (patch.assignedTo === null || patch.assignedTo === '') {
      ticket.assignedTo = null;
    } else {
      const assignee = await User.findById(patch.assignedTo);
      if (!assignee) {
        throw new AppError('Assigned user not found', 400);
      }
      ticket.assignedTo = assignee._id;
    }
  }

  await ticket.save();
  if (ticket.status === 'completed' && previousStatus !== 'completed') {
    try {
      await sendSystemMessage(ticket._id, AUTO_MESSAGE_TICKET_CLOSED, 'ticket_closed');
    } catch (e) {
      if (!(e && typeof e === 'object' && 'code' in e && e.code === 11000)) {
        // eslint-disable-next-line no-console
        console.error('[ticketService] auto closing message failed', e);
      }
    }
    try {
      const ctx = await getTicketCompletionMailContext(ticket._id);
      await sendTicketCompletedEmails({
        to: ctx.to,
        ticketRef: ctx.ticketRef,
        title: ctx.title,
        locationName: ctx.locationName,
      });
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error('[ticketService] completion email failed', e);
    }
  }
  const populated = await Ticket.findById(ticket._id).populate(POPULATE);
  return formatTicketResponse(populated);
}

export async function deleteTicket(actor, id) {
  const ticket = await Ticket.findById(id);
  assertCanAccessTicket(actor, ticket);
  await Message.deleteMany({ ticketId: id });
  await TicketActivity.deleteMany({ ticket: id });
  await Ticket.findByIdAndDelete(id);
  return { ok: true };
}

/**
 * @param {{ id: string; role: string; locationId: string | null }} actor
 * @param {{ ids: string[]; updates: Record<string, unknown> }} body
 */
export async function bulkUpdateTickets(actor, body) {
  const { ids, updates } = body;
  if (!Array.isArray(ids) || ids.length === 0) {
    throw new AppError('ids must be a non-empty array', 400);
  }
  if (!updates || typeof updates !== 'object') {
    throw new AppError('updates object is required', 400);
  }

  const results = [];
  for (const rawId of ids) {
    // eslint-disable-next-line no-await-in-loop
    const updated = await updateTicket(actor, rawId, updates);
    results.push(updated);
  }
  return { updated: results.length, tickets: results };
}

/**
 * @param {{ id: string; role: string; locationId: string | null }} actor
 * @param {{ ids: string[] }} body
 */
export async function bulkDeleteTickets(actor, body) {
  const { ids } = body;
  if (!Array.isArray(ids) || ids.length === 0) {
    throw new AppError('ids must be a non-empty array', 400);
  }

  let deleted = 0;
  for (const rawId of ids) {
    // eslint-disable-next-line no-await-in-loop
    await deleteTicket(actor, rawId);
    deleted += 1;
  }
  return { deleted };
}
