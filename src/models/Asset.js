import mongoose from 'mongoose';

/**
 * Shared file asset for Documents and Marketing Assets.
 * File binary lives in Cloudflare R2 — only URL + metadata are stored here.
 *
 * @swagger
 * components:
 *   schemas:
 *     Document:
 *       type: object
 *       properties:
 *         id: { type: string, example: '507f1f77bcf86cd799439011' }
 *         name: { type: string, example: 'Partner Handbook' }
 *         originalFileName: { type: string, example: 'handbook.pdf' }
 *         fileUrl: { type: string, example: 'https://cdn.example.com/assets/handbook.pdf' }
 *         contentType: { type: string, example: 'application/pdf' }
 *         fileSize: { type: integer, example: 245760 }
 *         category: { type: string, enum: [documents, marketing_assets] }
 *         visibility: { type: string, enum: [global, location] }
 *         locationIds:
 *           type: array
 *           items: { type: string }
 *         type: { type: string, enum: [postcard, banner, logo, video, other], nullable: true }
 *         uploadedBy: { type: string }
 *         createdAt: { type: string, format: date-time }
 *         updatedAt: { type: string, format: date-time }
 *         isDeleted: { type: boolean, example: false }
 */
const assetSchema = new mongoose.Schema(
  {
    name: { type: String, default: '', trim: true },
    originalName: { type: String, required: true, trim: true },
    storedName: { type: String, default: '', trim: true },
    fileUrl: { type: String, default: '', trim: true },
    storageKey: { type: String, default: '', trim: true },
    /** JPEG/WebP frame for video cards (and optional future use). */
    thumbnailUrl: { type: String, default: '', trim: true },
    thumbnailStorageKey: { type: String, default: '', trim: true },
    mimeType: { type: String, required: true, trim: true },
    size: { type: Number, required: true },
    category: {
      type: String,
      enum: ['documents', 'marketing_assets'],
      required: true,
      index: true,
    },
    visibility: {
      type: String,
      enum: ['global', 'location'],
      default: 'global',
    },
    locationIds: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Location' }],
    type: {
      type: String,
      enum: ['postcard', 'banner', 'logo', 'video', 'other'],
      required: false,
    },
    /** Logical Drive folder; null = root. Does not change R2 storageKey. */
    folderId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'AssetFolder',
      default: null,
      index: true,
    },
    uploadedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    isDeleted: { type: Boolean, default: false, index: true },
    expiresAt: {
      type: Date,
      default: () => {
        const d = new Date();
        d.setDate(d.getDate() + 90);
        return d;
      },
    },
  },
  { timestamps: true },
);

assetSchema.index({ category: 1, isDeleted: 1, createdAt: -1 });
assetSchema.index({ category: 1, folderId: 1, isDeleted: 1 });

const Asset = mongoose.model('Asset', assetSchema);
export default Asset;
