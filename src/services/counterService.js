import Counter from '../models/Counter.js';

const TICKET_COUNTER_ID = 'ticket';

/**
 * Atomically increments the ticket sequence and returns the new value.
 * @returns {Promise<number>}
 */
export async function getNextTicketSequence() {
  const doc = await Counter.findOneAndUpdate(
    { _id: TICKET_COUNTER_ID },
    { $inc: { seq: 1 } },
    { new: true, upsert: true, setDefaultsOnInsert: true },
  );
  return doc.seq;
}

/**
 * @param {number} seq
 */
export function formatTicketId(seq) {
  return `MK-${String(seq).padStart(4, '0')}`;
}
