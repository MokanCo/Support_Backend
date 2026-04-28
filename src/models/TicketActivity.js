import mongoose from 'mongoose';

/** Audit trail for tickets. Collection: `ticket_activities` */
const ticketActivitySchema = new mongoose.Schema(
  {
    ticket: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Ticket',
      required: true,
      index: true,
    },
    actor: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    actorName: { type: String, required: true, trim: true, maxlength: 200 },
    kind: { type: String, required: true, trim: true, maxlength: 64 },
    summary: { type: String, required: true, trim: true, maxlength: 2000 },
    meta: { type: mongoose.Schema.Types.Mixed, default: undefined },
    createdAt: { type: Date, default: Date.now, index: true },
  },
  { versionKey: false },
);

ticketActivitySchema.index({ ticket: 1, createdAt: 1 });

export default mongoose.model('TicketActivity', ticketActivitySchema, 'ticket_activities');
