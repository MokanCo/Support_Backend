import mongoose from 'mongoose';

/**
 * Logical folder for Documents / Marketing Assets (Google Drive–style).
 * Does NOT map to R2 path prefixes — organization is DB-only so existing
 * objects keep their storage keys.
 */
const assetFolderSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    parentId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'AssetFolder',
      default: null,
      index: true,
    },
    category: {
      type: String,
      enum: ['documents', 'marketing_assets'],
      required: true,
      index: true,
    },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    isDeleted: { type: Boolean, default: false, index: true },
  },
  { timestamps: true },
);

assetFolderSchema.index({ category: 1, parentId: 1, isDeleted: 1, name: 1 });

export default mongoose.model('AssetFolder', assetFolderSchema);
