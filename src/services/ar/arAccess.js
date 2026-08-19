import mongoose from 'mongoose';
import { AppError } from '../../utils/AppError.js';

/** Reject non-ObjectId input up front so Mongoose never throws an opaque CastError. */
export function toObjectId(value, label = 'id') {
  const raw = String(value ?? '').trim();
  if (!mongoose.Types.ObjectId.isValid(raw)) {
    throw new AppError(`Invalid ${label}`, 400);
  }
  return new mongoose.Types.ObjectId(raw);
}

export function optionalObjectId(value, label = 'id') {
  const raw = String(value ?? '').trim();
  if (!raw) return null;
  return toObjectId(raw, label);
}

/** Admin has full AR access; support is read-only staff; partner is scoped to location. */
export function assertCanManageAr(actor) {
  if (actor?.role !== 'admin') {
    throw new AppError('Only admin can manage Accounts Receivable', 403);
  }
}

export function assertCanViewAr(actor) {
  if (!['admin', 'support', 'partner'].includes(actor?.role)) {
    throw new AppError('Access denied', 403);
  }
}

export function assertCanRecordPayments(actor) {
  if (actor?.role !== 'admin') {
    throw new AppError('Only admin can record payments', 403);
  }
}

/** Scope query to partner's location when role is partner. */
export function locationScopeFilter(actor, locationIdFromQuery) {
  if (actor.role === 'partner') {
    if (!actor.locationId) throw new AppError('Partner has no location assigned', 403);
    return { locationId: toObjectId(actor.locationId, 'locationId') };
  }
  const scoped = optionalObjectId(locationIdFromQuery, 'locationId');
  if (scoped) {
    return { locationId: scoped };
  }
  return {};
}

export function assertCanAccessLocation(actor, locationId) {
  if (actor.role === 'admin' || actor.role === 'support') return;
  if (actor.role === 'partner' && String(actor.locationId) === String(locationId)) return;
  throw new AppError('Access denied for this partner', 403);
}

export function parseListQuery(query, { defaultSort = 'createdAt' } = {}) {
  const page = Math.max(1, Number(query.page) || 1);
  const pageSize = Math.min(100, Math.max(1, Number(query.pageSize) || 20));
  const sort = typeof query.sort === 'string' && query.sort ? query.sort : defaultSort;
  const order = query.order === 'asc' ? 1 : -1;
  const search = typeof query.search === 'string' ? query.search.trim() : '';
  return { page, pageSize, sort, order, search, skip: (page - 1) * pageSize };
}

export function money(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}
