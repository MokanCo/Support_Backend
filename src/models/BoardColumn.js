import mongoose from 'mongoose';

const boardColumnSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 120 },
    boardId: { type: mongoose.Schema.Types.ObjectId, ref: 'Board', required: true, index: true },
    order: { type: Number, required: true, default: 0 },
  },
  { versionKey: false },
);

boardColumnSchema.index({ boardId: 1, order: 1 });

export default mongoose.model('BoardColumn', boardColumnSchema, 'board_columns');
