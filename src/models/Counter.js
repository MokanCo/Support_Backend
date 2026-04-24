import mongoose from 'mongoose';

/**
 * @swagger
 * components:
 *   schemas:
 *     TicketCounterDocument:
 *       description: Atomic counter for ticketId sequence (_id is typically "ticket")
 *       type: object
 *       properties:
 *         _id: { type: string, example: ticket }
 *         seq: { type: integer, example: 42 }
 */
const counterSchema = new mongoose.Schema({
  _id: { type: String, required: true },
  seq: { type: Number, default: 0 },
});

export default mongoose.model('Counter', counterSchema);
