/**
 * Upload local-disk assets (uploads/assets) into Cloudflare R2 and backfill
 * fileUrl + storageKey in MongoDB so production can serve them.
 *
 * Run on the machine that still has the files (usually local):
 *   npm run migrate:assets-to-r2
 *
 * Requires the same MONGODB_URI and CLOUDFLARE_R2_* env vars as the app.
 */
import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import mongoose from 'mongoose';
import { connectDb } from '../src/config/db.js';
import Asset from '../src/models/Asset.js';
import { ASSET_UPLOAD_ROOT } from '../src/services/assetService.js';
import {
  isR2Configured,
  uploadFile,
  publicUrlForKey,
} from '../src/services/cloudflareR2StorageService.js';

async function main() {
  await connectDb();

  const docs = await Asset.find({ isDeleted: { $ne: true } });
  console.log(`Found ${docs.length} assets`);

  let uploaded = 0;
  let skipped = 0;
  let failed = 0;
  let backfilled = 0;

  for (const doc of docs) {
    const category = doc.category;
    if (!isR2Configured(category)) {
      console.error(`R2 is not configured for ${category}. Set CLOUDFLARE_R2_* env vars.`);
      process.exit(1);
    }

    if (doc.fileUrl && doc.storageKey) {
      skipped += 1;
      continue;
    }

    if (doc.storageKey && !doc.fileUrl) {
      const url = publicUrlForKey(category, doc.storageKey);
      if (url) {
        doc.fileUrl = url;
        await doc.save();
        backfilled += 1;
        console.log(`  backfilled URL  ${doc.originalName}`);
        continue;
      }
    }

    const localPath = path.join(ASSET_UPLOAD_ROOT, doc.storedName || '');
    if (!doc.storedName || !fs.existsSync(localPath)) {
      console.warn(`  missing locally  ${doc.originalName} (${doc._id})`);
      failed += 1;
      continue;
    }

    const buffer = await fs.promises.readFile(localPath);
    const uploadedFile = await uploadFile(
      {
        buffer,
        originalname: doc.originalName || doc.storedName,
        mimetype: doc.mimeType || 'application/octet-stream',
        size: buffer.length,
      },
      { category },
    );

    doc.storageKey = uploadedFile.key;
    doc.fileUrl = uploadedFile.fileUrl;
    doc.size = uploadedFile.fileSize;
    await doc.save();
    uploaded += 1;
    console.log(`  uploaded         ${doc.originalName} → ${uploadedFile.key}`);
  }

  console.log(
    `\nDone. uploaded=${uploaded} backfilled=${backfilled} already-on-r2=${skipped} missing=${failed}`,
  );
  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
