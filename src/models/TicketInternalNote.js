import mongoose from 'mongoose';

const ticketInternalNoteSchema = new mongoose.Schema(
  {
    ticket: { type: mongoose.Schema.Types.ObjectId, ref: 'Ticket', required: true, index: true },
    author: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    body: { type: String, required: true, trim: true, maxlength: 20000 },
  },
  { timestamps: true },
);

ticketInternalNoteSchema.index({ ticket: 1, createdAt: -1 });

export default mongoose.model('TicketInternalNote', ticketInternalNoteSchema);
