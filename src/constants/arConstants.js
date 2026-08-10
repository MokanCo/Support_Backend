/** Shared AR constants */

export const AR_INVOICE_STATUSES = [
  'draft',
  'pending_approval',
  'scheduled',
  'sent',
  'viewed',
  'partially_paid',
  'paid',
  'overdue',
  'cancelled',
  'void',
];

export const AR_FREQUENCIES = [
  'weekly',
  'biweekly',
  'monthly',
  'quarterly',
  'semi_annual',
  'annual',
  'custom',
];

export const AR_PAYMENT_METHODS = [
  'zelle',
  'ach',
  'check',
  'card',
  'wire',
  'cash',
  'other',
];

export const AR_CREDIT_TYPES = ['credit_note', 'discount', 'refund', 'write_off'];

export const AR_DEFAULT_REMINDER_DAYS = [-7, -3, -1, 0, 3, 7, 14, 30];

export const AR_CURRENCIES = ['USD'];

/** Invoice PDF layout block types for drag-drop template builder. */
export const AR_INVOICE_BLOCK_TYPES = [
  'company_header',
  'invoice_meta',
  'bill_to',
  'line_items',
  'totals',
  'notes',
  'payment_instructions',
  'terms',
  'custom_text',
  'spacer',
];

export const AR_DEFAULT_INVOICE_BLOCKS = [
  { type: 'company_header', enabled: true, label: 'Company header' },
  { type: 'invoice_meta', enabled: true, label: 'Invoice number & dates' },
  { type: 'bill_to', enabled: true, label: 'Bill to' },
  { type: 'line_items', enabled: true, label: 'Line items' },
  { type: 'totals', enabled: true, label: 'Totals' },
  { type: 'notes', enabled: true, label: 'Invoice notes' },
  { type: 'payment_instructions', enabled: true, label: 'Payment instructions' },
  { type: 'terms', enabled: true, label: 'Terms & conditions' },
];
