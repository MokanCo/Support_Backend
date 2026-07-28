import mongoose from 'mongoose';

const assetSchema = new mongoose.Schema(
  {
    originalName: { type: String, required: true },
    storedName: { type: String, required: true },
    mimeType: { type: String, required: true },
    size: { type: Number, required: true },
    category: {
      type: String,
      enum: ['documents', 'marketing_assets'],
      required: true,
    },
    visibility: {
      type: String,
      enum: ['global', 'location'],
      default: 'global',
    },
    locationIds: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Location' }],
    type: {
      type: String,
      enum: ['postcard', 'banner', 'logo', 'other'],
      required: false,
    },
    uploadedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
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

const Asset = mongoose.model('Asset', assetSchema);
export default Asset;
