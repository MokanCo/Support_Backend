import mongoose from 'mongoose';

/**
 * @swagger
 * components:
 *   schemas:
 *     UserDocument:
 *       description: Mongoose User document (password hashed; never returned by API)
 *       type: object
 *       properties:
 *         _id: { type: string }
 *         name: { type: string }
 *         email: { type: string, format: email }
 *         role: { type: string, enum: [admin, support, partner] }
 *         locationId: { type: string, nullable: true }
 *         createdAt: { type: string, format: date-time }
 *         updatedAt: { type: string, format: date-time }
 */
const ROLES = ['admin', 'support', 'partner'];

const userSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
    },
    password: { type: String, required: true, select: false },
    role: { type: String, enum: ROLES, required: true, index: true },
    locationId: { type: mongoose.Schema.Types.ObjectId, ref: 'Location', default: null },
  },
  { timestamps: true },
);

export const USER_ROLES = ROLES;
export default mongoose.model('User', userSchema);
