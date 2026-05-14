import mongoose from 'mongoose';

const boardTaskAttachmentSchema = new mongoose.Schema(
  {
    taskId: { type: mongoose.Schema.Types.ObjectId, ref: 'BoardTask', required: true, index: true },
    uploadedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    originalName: { type: String, required: true, trim: true, maxlength: 500 },
    storedName: { type: String, required: true, maxlength: 200 },
    mimeType: { type: String, default: 'application/octet-stream', maxlength: 200 },
    size: { type: Number, required: true, min: 0 },
  },
  { timestamps: { createdAt: true, updatedAt: false }, versionKey: false },
);

boardTaskAttachmentSchema.index({ taskId: 1, createdAt: -1 });

export default mongoose.model(
  'BoardTaskAttachment',
  boardTaskAttachmentSchema,
  'board_task_attachments',
);
