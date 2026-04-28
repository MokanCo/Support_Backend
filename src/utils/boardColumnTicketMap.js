/** Map column display name → ticket status when a task is linked to a ticket. */
export function columnNameToTicketStatus(name) {
  const n = String(name || '')
    .trim()
    .toLowerCase();
  if (['todo', 'to do', 'backlog', 'queue', 'new'].includes(n)) return 'in_queue';
  if (['in progress', 'in_progress', 'doing', 'progress', 'review'].includes(n)) return 'in_progress';
  if (['done', 'completed', 'closed', 'complete'].includes(n)) return 'completed';
  if (['cancelled', 'canceled'].includes(n)) return 'cancelled';
  return null;
}

export function isDoneLikeColumnName(name) {
  const s = columnNameToTicketStatus(name);
  return s === 'completed' || s === 'cancelled';
}

export function columnNameToTaskStatus(name) {
  return columnNameToTicketStatus(name) || 'in_queue';
}
