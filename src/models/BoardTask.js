import mongoose from 'mongoose';
import { BOARD_TASK_CARD_COLORS } from '../utils/boardTaskCardColors.js';

const STATUSES = ['in_queue', 'in_progress', 'completed', 'cancelled'];
const PRIORITIES = ['low', 'medium', 'high', 'urgent'];

const boardTaskSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true, maxlength: 500 },
    description: { type: String, default: '', trim: true, maxlength: 20000 },
    ticketId: { type: mongoose.Schema.Types.ObjectId, ref: 'Ticket', default: null, index: true },
    boardId: { type: mongoose.Schema.Types.ObjectId, ref: 'Board', required: true, index: true },
    columnId: { type: mongoose.Schema.Types.ObjectId, ref: 'BoardColumn', required: true, index: true },
    assignedTo: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    priority: { type: String, enum: PRIORITIES, default: 'medium' },
    cardColor: { type: String, enum: BOARD_TASK_CARD_COLORS, default: 'gray' },
    progress: { type: Number, default: 0, min: 0, max: 100 },
    deadline: { type: Date, default: null },
    status: { type: String, enum: STATUSES, default: 'in_queue' },
    order: { type: Number, required: true, default: 0 },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  },
  { timestamps: true, versionKey: false },
);

boardTaskSchema.index({ columnId: 1, order: 1 });
boardTaskSchema.index({ boardId: 1, updatedAt: -1 });

export const BOARD_TASK_STATUSES = STATUSES;
export const BOARD_TASK_PRIORITIES = PRIORITIES;
export { BOARD_TASK_CARD_COLORS };
export default mongoose.model('BoardTask', boardTaskSchema, 'board_tasks');
