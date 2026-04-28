import User from '../models/User.js';
import Ticket from '../models/Ticket.js';

export async function serializeTasksWithUsers(tasks) {
  const userIds = new Set();
  for (const t of tasks) {
    if (t.assignedTo) userIds.add(String(t.assignedTo));
    if (t.createdBy) userIds.add(String(t.createdBy));
  }
  const users = await User.find({ _id: { $in: [...userIds] } })
    .select('name email')
    .lean();
  const map = Object.fromEntries(users.map((u) => [String(u._id), u]));

  const ticketIds = tasks.map((t) => t.ticketId).filter(Boolean);
  const tickets = await Ticket.find({ _id: { $in: ticketIds } })
    .select('ticketId title')
    .lean();
  const tmap = Object.fromEntries(tickets.map((tk) => [String(tk._id), tk]));

  return tasks.map((t) => {
    const a = t.assignedTo ? map[String(t.assignedTo)] : null;
    const c = t.createdBy ? map[String(t.createdBy)] : null;
    const tk = t.ticketId ? tmap[String(t.ticketId)] : null;
    return {
      id: String(t._id),
      title: t.title,
      description: t.description,
      ticketId: t.ticketId ? String(t.ticketId) : null,
      ticketCode: tk?.ticketId ?? null,
      ticketTitle: tk?.title ?? null,
      boardId: String(t.boardId),
      columnId: String(t.columnId),
      assignedTo: t.assignedTo
        ? { id: String(t.assignedTo), name: a?.name || 'User', email: a?.email || '' }
        : null,
      priority: t.priority,
      deadline: t.deadline,
      status: t.status,
      order: t.order,
      createdBy: t.createdBy ? { id: String(t.createdBy), name: c?.name || '' } : null,
      createdAt: t.createdAt,
      updatedAt: t.updatedAt,
    };
  });
}
