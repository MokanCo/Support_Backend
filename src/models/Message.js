import mongoose from 'mongoose';

/**
 * @swagger
 * components:
 *   schemas:
 *     MessageDocument:
 *       description: Mongoose Message document
 *       type: object
 *       properties:
 *         _id: { type: string }
 *         ticketId: { type: string }
 *         senderId: { type: string }
 *         text: { type: string }
 *         createdAt: { type: string, format: date-time }
 *         updatedAt: { type: string, format: date-time }
 */
const SYSTEM_EVENTS = ['ticket_created', 'ticket_closed'];

const messageSchema = new mongoose.Schema(
  {
    ticketId: { type: mongoose.Schema.Types.ObjectId, ref: 'Ticket', required: true, index: true },
    senderId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    text: { type: String, required: true, trim: true, maxlength: 10000 },
    isSystem: { type: Boolean, default: false, index: true },
    systemEvent: {
      type: String,
      enum: SYSTEM_EVENTS,
      required: false,
    },
  },
  { timestamps: true },
);

messageSchema.index({ ticketId: 1, createdAt: 1 });
messageSchema.index(
  { ticketId: 1, systemEvent: 1 },
  { unique: true, partialFilterExpression: { systemEvent: { $type: 'string' } } },
);

export default mongoose.model('Message', messageSchema);
