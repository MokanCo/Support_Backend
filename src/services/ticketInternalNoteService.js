import mongoose from 'mongoose';
import Ticket from '../models/Ticket.js';
import TicketInternalNote from '../models/TicketInternalNote.js';
import { AppError } from '../utils/AppError.js';
import { assertCanAccessTicket } from './accessService.js';

function formatNote(doc) {
  const n = typeof doc.toObject === 'function' ? doc.toObject() : doc;
  const author = n.author && typeof n.author === 'object' && n.author._id != null ? n.author : null;
  return {
    id: String(n._id),
    ticketId: n.ticket != null ? String(n.ticket) : '',
    body: n.body != null ? String(n.body) : '',
    createdAt: n.createdAt,
    updatedAt: n.updatedAt,
    authorId: author ? String(author._id) : n.author != null ? String(n.author) : '',
    authorName: author?.name != null ? String(author.name) : '',
    authorRole: author?.role != null ? String(author.role) : '',
  };
}

/**
 * @param {{ id: string; role: string; locationId: string | null; name?: string }} actor
 */
export async function listInternalNotes(actor, ticketId) {
  if (actor.role !== 'admin' && actor.role !== 'support') {
    throw new AppError('Forbidden', 403);
  }
  const ticket = await Ticket.findById(ticketId);
  assertCanAccessTicket(actor, ticket);
  const notes = await TicketInternalNote.find({ ticket: ticketId })
    .sort({ createdAt: 1 })
    .populate({ path: 'author', select: 'name email role' })
    .lean();
  return notes.map((n) => formatNote(n));
}

/**
 * @param {{ id: string; role: string; locationId: string | null; name?: string }} actor
 * @param {{ body: string }} input
 */
export async function createInternalNote(actor, ticketId, input) {
  if (actor.role !== 'admin' && actor.role !== 'support') {
    throw new AppError('Forbidden', 403);
  }
  const ticket = await Ticket.findById(ticketId);
  assertCanAccessTicket(actor, ticket);
  if (ticket.status === 'completed' || ticket.status === 'cancelled') {
    throw new AppError('Cannot add internal notes to a closed ticket', 403);
  }
  const body = (input.body ?? '').trim();
  if (!body) {
    throw new AppError('Note body is required', 400);
  }
  const created = await TicketInternalNote.create({
    ticket: new mongoose.Types.ObjectId(ticketId),
    author: new mongoose.Types.ObjectId(actor.id),
    body,
  });
  const populated = await TicketInternalNote.findById(created._id).populate({
    path: 'author',
    select: 'name email role',
  });
  return formatNote(populated);
}

/**
 * @param {{ id: string; role: string; locationId: string | null }} actor
 * @param {{ body?: string }} patch
 */
export async function updateInternalNote(actor, ticketId, noteId, patch) {
  if (actor.role !== 'admin' && actor.role !== 'support') {
    throw new AppError('Forbidden', 403);
  }
  const ticket = await Ticket.findById(ticketId);
  assertCanAccessTicket(actor, ticket);
  if (ticket.status === 'completed' || ticket.status === 'cancelled') {
    throw new AppError('Cannot edit internal notes on a closed ticket', 403);
  }
  const note = await TicketInternalNote.findOne({ _id: noteId, ticket: ticketId });
  if (!note) {
    throw new AppError('Note not found', 404);
  }
  if (String(note.author) !== actor.id && actor.role !== 'admin') {
    throw new AppError('You can only edit your own notes', 403);
  }
  if (patch.body !== undefined) {
    const next = String(patch.body).trim();
    if (!next) {
      throw new AppError('Note body cannot be empty', 400);
    }
    note.body = next;
  }
  await note.save();
  const populated = await TicketInternalNote.findById(note._id).populate({
    path: 'author',
    select: 'name email role',
  });
  return formatNote(populated);
}

/**
 * @param {{ id: string; role: string; locationId: string | null }} actor
 */
export async function deleteInternalNote(actor, ticketId, noteId) {
  if (actor.role !== 'admin' && actor.role !== 'support') {
    throw new AppError('Forbidden', 403);
  }
  const ticket = await Ticket.findById(ticketId);
  assertCanAccessTicket(actor, ticket);
  if (ticket.status === 'completed' || ticket.status === 'cancelled') {
    throw new AppError('Cannot delete internal notes on a closed ticket', 403);
  }
  const note = await TicketInternalNote.findOne({ _id: noteId, ticket: ticketId });
  if (!note) {
    throw new AppError('Note not found', 404);
  }
  if (String(note.author) !== actor.id && actor.role !== 'admin') {
    throw new AppError('You can only delete your own notes', 403);
  }
  await TicketInternalNote.deleteOne({ _id: noteId });
  return { ok: true };
}
