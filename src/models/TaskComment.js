import mongoose from 'mongoose';

const taskCommentSchema = new mongoose.Schema(
  {
    taskId: { type: mongoose.Schema.Types.ObjectId, ref: 'BoardTask', required: true, index: true },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    comment: { type: String, required: true, trim: true, maxlength: 8000 },
  },
  { timestamps: { createdAt: true, updatedAt: false }, versionKey: false },
);

taskCommentSchema.index({ taskId: 1, createdAt: 1 });

export default mongoose.model('TaskComment', taskCommentSchema, 'task_comments');
