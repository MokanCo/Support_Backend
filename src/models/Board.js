import mongoose from 'mongoose';

const boardSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 200 },
    description: { type: String, default: '', trim: true, maxlength: 4000 },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    users: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
    notifyOnCompleteUsers: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  },
  { timestamps: true, versionKey: false },
);

boardSchema.index({ createdBy: 1, createdAt: -1 });

export default mongoose.model('Board', boardSchema, 'boards');
