/** Allowed task card accent colors (stored on BoardTask.cardColor). */
export const BOARD_TASK_CARD_COLORS = [
  'gray',
  'sky',
  'amber',
  'emerald',
  'violet',
  'rose',
  'orange',
];

export function normalizeCardColor(value) {
  const v = typeof value === 'string' ? value.trim() : '';
  return BOARD_TASK_CARD_COLORS.includes(v) ? v : 'gray';
}

export function normalizeProgress(value) {
  const p = Number(value);
  if (!Number.isFinite(p)) return 0;
  return Math.min(100, Math.max(0, Math.round(p)));
}
