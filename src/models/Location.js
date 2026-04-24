import mongoose from 'mongoose';

/**
 * @swagger
 * components:
 *   schemas:
 *     LocationDocument:
 *       description: Mongoose Location document
 *       type: object
 *       properties:
 *         _id: { type: string }
 *         name: { type: string }
 *         email: { type: string, format: email }
 *         phone: { type: string }
 *         address: { type: string }
 *         createdAt: { type: string, format: date-time }
 *         updatedAt: { type: string, format: date-time }
 */
const locationSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    email: { type: String, required: true, lowercase: true, trim: true },
    phone: { type: String, required: true, trim: true },
    address: { type: String, required: true, trim: true },
  },
  { timestamps: true },
);

export default mongoose.model('Location', locationSchema);
