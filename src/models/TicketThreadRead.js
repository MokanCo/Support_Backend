import mongoose from 'mongoose';

/**
 * Last time a user marked the ticket thread as read (for unread summaries).
 */
const ticketThreadReadSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    ticketId: { type: mongoose.Schema.Types.ObjectId, ref: 'Ticket', required: true },
    lastReadAt: { type: Date, required: true },
  },
  { timestamps: true },
);

ticketThreadReadSchema.index({ userId: 1, ticketId: 1 }, { unique: true });

export default mongoose.model('TicketThreadRead', ticketThreadReadSchema);
