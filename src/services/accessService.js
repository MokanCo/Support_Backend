import mongoose from 'mongoose';
import { AppError } from '../utils/AppError.js';

/**
 * @param {{ locationId?: unknown }} ticket
 * @returns {string} Mongo id string, or "" if missing
 */
function ticketLocationIdString(ticket) {
  const loc = ticket?.locationId;
  if (loc == null) return '';
  if (typeof loc === 'object' && loc !== null && '_id' in loc && loc._id != null) {
    return String(loc._id);
  }
  return String(loc);
}

/**
 * @param {{ role: string; locationId: string | null }} user
 * @returns {import('mongoose').FilterQuery<Record<string, unknown>> | null}
 * Returns null means "no filter" (all tickets). Empty impossible object for partner without location.
 */
export function ticketListFilterForUser(user) {
  if (user.role === 'partner') {
    if (!user.locationId) {
      throw new AppError('Partner account is missing a location', 403);
    }
    return { locationId: new mongoose.Types.ObjectId(user.locationId) };
  }
  return {};
}

/**
 * Scope for GET /api/tickets list (matches dashboard copy: support sees assignments only).
 * @param {{ id: string; role: string; locationId: string | null }} user
 */
export function ticketListScopeForUser(user) {
  if (user.role === 'admin') return {};
  if (user.role === 'support') {
    return { assignedTo: new mongoose.Types.ObjectId(user.id) };
  }
  return ticketListFilterForUser(user);
}

/**
 * @param {{ role: string; locationId: string | null }} user
 * @param {{ locationId?: import('mongoose').Types.ObjectId }} ticket
 */
export function assertCanAccessTicket(user, ticket) {
  if (!ticket) {
    throw new AppError('Ticket not found', 404);
  }
  if (user.role === 'partner') {
    if (!user.locationId) {
      throw new AppError('Partner account is missing a location', 403);
    }
    if (ticketLocationIdString(ticket) !== user.locationId) {
      throw new AppError('Forbidden', 403);
    }
  }
}

/**
 * @param {{ role: string; locationId: string | null }} user
 * @param {string} locationId
 */
export function assertPartnerUsesOwnLocation(user, locationId) {
  if (user.role !== 'partner') return;
  if (!user.locationId) {
    throw new AppError('Partner account is missing a location', 403);
  }
  if (locationId !== user.locationId) {
    throw new AppError('Partners can only use their own location', 403);
  }
}
