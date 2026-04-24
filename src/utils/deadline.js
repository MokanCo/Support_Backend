/**
 * @param {Date | string | null | undefined} deadline
 * @param {Date} [now=new Date()]
 * @returns {boolean}
 */
export function isOverdue(deadline, now = new Date()) {
  if (!deadline) return false;
  const d = deadline instanceof Date ? deadline : new Date(deadline);
  if (Number.isNaN(d.getTime())) return false;
  return d.getTime() < now.getTime();
}

/**
 * @param {Date | string | null | undefined} deadline
 * @param {Date} [now=new Date()]
 * @returns {{ overdue: boolean, deadlineAt: Date | null }}
 */
export function deadlineInfo(deadline, now = new Date()) {
  if (!deadline) return { overdue: false, deadlineAt: null };
  const d = deadline instanceof Date ? deadline : new Date(deadline);
  if (Number.isNaN(d.getTime())) return { overdue: false, deadlineAt: null };
  return { overdue: d.getTime() < now.getTime(), deadlineAt: d };
}
