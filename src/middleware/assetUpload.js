import multer from 'multer';
import { MAX_ASSET_FILE_SIZE } from '../services/assetService.js';

/** Memory storage — buffer is uploaded to Cloudflare R2 (or written locally as fallback). */
export const assetUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_ASSET_FILE_SIZE },
});
