/**
 * Removes Asset records whose backing file no longer exists on disk
 * (e.g. from testing before uploads/assets was set up, or a wiped uploads dir).
 *
 * Usage:
 *   node scripts/clean-orphaned-assets.js            (dry run, reports only)
 *   node scripts/clean-orphaned-assets.js --delete   (actually deletes)
 *
 * Requires MONGODB_URI in .env
 */
import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import mongoose from 'mongoose';
import { connectDb } from '../src/config/db.js';
import Asset from '../src/models/Asset.js';
import { ASSET_UPLOAD_ROOT } from '../src/services/assetService.js';

const shouldDelete = process.argv.includes('--delete');

async function main() {
  await connectDb();

  const docs = await Asset.find({}).lean();
  const orphaned = docs.filter((doc) => {
    const filePath = path.join(ASSET_UPLOAD_ROOT, doc.storedName);
    return !fs.existsSync(filePath);
  });

  console.log(`Total assets: ${docs.length}`);
  console.log(`Orphaned (no file on disk): ${orphaned.length}\n`);

  for (const doc of orphaned) {
    console.log(`  [${doc.category}] ${doc.originalName} (id: ${doc._id}, storedName: ${doc.storedName})`);
  }

  if (orphaned.length === 0) {
    console.log('\nNothing to clean up.');
  } else if (shouldDelete) {
    const ids = orphaned.map((d) => d._id);
    const res = await Asset.deleteMany({ _id: { $in: ids } });
    console.log(`\nDeleted ${res.deletedCount} orphaned asset record(s).`);
  } else {
    console.log('\nDry run only — no records deleted. Re-run with --delete to remove them.');
  }

  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
