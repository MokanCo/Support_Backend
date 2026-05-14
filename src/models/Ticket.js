import mongoose from 'mongoose';

/**
 * @swagger
 * components:
 *   schemas:
 *     TicketDocument:
 *       description: Mongoose Ticket document (ticketId is human-readable MK-####)
 *       type: object
 *       properties:
 *         _id: { type: string }
 *         ticketId: { type: string, example: MK-0001 }
 *         title: { type: string }
 *         description: { type: string }
 *         category: { type: string }
 *         status: { type: string, enum: [in_queue, in_progress, completed, cancelled] }
 *         priority: { type: string, enum: [p0, p1, p2, p3, p4] }
 *         progress: { type: integer, minimum: 0, maximum: 100 }
 *         deadline: { type: string, format: date-time, nullable: true }
 *         locationId: { type: string }
 *         createdBy: { type: string }
 *         assignedTo: { type: string, nullable: true }
 *         createdAt: { type: string, format: date-time }
 *         updatedAt: { type: string, format: date-time }
 */
const STATUSES = ['in_queue', 'in_progress', 'completed', 'cancelled'];
const PRIORITIES = ['p0', 'p1', 'p2', 'p3', 'p4'];

const ticketSchema = new mongoose.Schema(
  {
    ticketId: { type: String, required: true, unique: true },
    title: { type: String, required: true, trim: true },
    description: { type: String, default: '', trim: true },
    category: { type: String, required: true, trim: true },
    status: { type: String, enum: STATUSES, default: 'in_queue', index: true },
    priority: { type: String, enum: PRIORITIES, default: 'p2' },
    progress: { type: Number, default: 0, min: 0, max: 100 },
    deadline: { type: Date, default: null },
    locationId: { type: mongoose.Schema.Types.ObjectId, ref: 'Location', required: true, index: true },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    assignedTo: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: true },
);

ticketSchema.index({ locationId: 1, createdAt: -1 });

export const TICKET_STATUSES = STATUSES;
export const TICKET_PRIORITIES = PRIORITIES;
export default mongoose.model('Ticket', ticketSchema);
