import mongoose from 'mongoose';
import Ticket from '../models/Ticket.js';
import User from '../models/User.js';

/**
 * @param {{ id: string; role: string; locationId: string | null }} user
 * @returns {import('mongoose').FilterQuery<typeof Ticket>}
 */
function ticketScopeFilter(user) {
  if (user.role === 'admin') return {};
  if (user.role === 'support') {
    return { assignedTo: new mongoose.Types.ObjectId(user.id) };
  }
  if (user.role === 'partner') {
    if (!user.locationId) return { _id: { $exists: false } };
    return { locationId: new mongoose.Types.ObjectId(user.locationId) };
  }
  return {};
}

function isOverdueTicket(deadline, status) {
  if (!deadline) return false;
  if (status === 'completed' || status === 'cancelled') return false;
  return new Date(deadline).getTime() < Date.now();
}

/**
 * @param {Record<string, unknown>} t lean ticket
 * @param {Map<string, string>} nameById
 */
function serializeRecentTicket(t, nameById) {
  const loc = t.locationId;
  let locationId = '';
  let locationName = null;
  if (loc != null && typeof loc === 'object' && loc._id != null) {
    locationId = String(loc._id);
    locationName = loc.name != null ? String(loc.name) : null;
  } else if (loc != null) {
    locationId = String(loc);
  }
  const created = new Date(t.createdAt).getTime();
  const isNew = Date.now() - created < 24 * 60 * 60 * 1000;
  const deadline = t.deadline ? new Date(t.deadline).toISOString() : null;

  return {
    id: String(t._id),
    ticketCode: t.ticketId != null ? String(t.ticketId) : null,
    title: String(t.title ?? ''),
    description: String(t.description ?? ''),
    category: String(t.category ?? ''),
    status: t.status,
    priority: t.priority ?? 'medium',
    progress: typeof t.progress === 'number' ? t.progress : 0,
    deadline,
    isOverdue: isOverdueTicket(t.deadline, t.status),
    locationId,
    locationName,
    createdBy: String(t.createdBy),
    createdByName: nameById.get(String(t.createdBy)),
    assignedTo: t.assignedTo ? String(t.assignedTo) : null,
    assignedToName: t.assignedTo ? nameById.get(String(t.assignedTo)) ?? null : null,
    createdAt: t.createdAt,
    updatedAt: t.updatedAt,
    isNew,
  };
}

/**
 * Dashboard aggregates (matches legacy Next `/api/analytics/dashboard` shape).
 * @param {{ id: string; role: string; locationId: string | null }} user
 */
export async function getDashboardAnalytics(user) {
  const orgMatch = ticketScopeFilter(user);

  const dayStart = new Date();
  dayStart.setDate(dayStart.getDate() - 13);
  dayStart.setHours(0, 0, 0, 0);

  const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000);

  const [
    total,
    inProgress,
    completed,
    newTickets,
    perDay,
    byStatus,
    recentDocs,
  ] = await Promise.all([
    Ticket.countDocuments(orgMatch),
    Ticket.countDocuments({ ...orgMatch, status: 'in_progress' }),
    Ticket.countDocuments({ ...orgMatch, status: 'completed' }),
    Ticket.countDocuments({ ...orgMatch, createdAt: { $gte: since24h } }),
    Ticket.aggregate([
      { $match: { ...orgMatch, createdAt: { $gte: dayStart } } },
      {
        $group: {
          _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } },
          count: { $sum: 1 },
        },
      },
      { $sort: { _id: 1 } },
    ]),
    Ticket.aggregate([
      { $match: orgMatch },
      { $group: { _id: '$status', count: { $sum: 1 } } },
    ]),
    Ticket.find(orgMatch)
      .sort({ updatedAt: -1 })
      .limit(8)
      .populate('locationId', 'name')
      .lean(),
  ]);

  const userIds = new Set();
  for (const t of recentDocs) {
    userIds.add(String(t.createdBy));
    if (t.assignedTo) userIds.add(String(t.assignedTo));
  }
  const users = await User.find({ _id: { $in: [...userIds] } })
    .select('name')
    .lean();
  const nameById = new Map(users.map((u) => [String(u._id), u.name]));

  const days = [];
  for (let i = 0; i < 14; i += 1) {
    const d = new Date(dayStart);
    d.setDate(d.getDate() + i);
    days.push(d.toISOString().slice(0, 10));
  }
  const dayMap = new Map(perDay.map((p) => [p._id, p.count]));
  const ticketsPerDay = days.map((date) => ({
    date,
    count: dayMap.get(date) ?? 0,
  }));

  const recentTickets = recentDocs.map((t) => serializeRecentTicket(t, nameById));

  return {
    totals: {
      total,
      inProgress,
      completed,
      newTickets,
    },
    ticketsPerDay,
    byStatus: byStatus.map((b) => ({ status: b._id, count: b.count })),
    recentTickets,
  };
}
