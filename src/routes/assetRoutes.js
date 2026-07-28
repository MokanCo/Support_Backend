import { Router } from 'express';
import fs from 'fs';
import path from 'path';
import multer from 'multer';
import { authMiddleware } from '../middleware/authMiddleware.js';
import { roleMiddleware } from '../middleware/roleMiddleware.js';
import {
  uploadAsset,
  listAssetsHandler,
  serveAssetFile,
  deleteAssetHandler,
  removeAssetLocationHandler,
} from '../controllers/assetController.js';
import { ASSET_UPLOAD_ROOT } from '../services/assetService.js';

const router = Router();

try {
  fs.mkdirSync(ASSET_UPLOAD_ROOT, { recursive: true });
} catch (e) {
  console.error('[assets] could not create upload dir', e);
}

const assetUpload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, ASSET_UPLOAD_ROOT),
    filename: (_req, file, cb) => {
      const ext = path.extname(file.originalname || '').slice(0, 16);
      const base = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
      cb(null, `${base}${ext}`);
    },
  }),
  limits: { fileSize: 50 * 1024 * 1024 },
});

router.use(authMiddleware);

router.post('/', roleMiddleware(['admin']), assetUpload.single('file'), uploadAsset);
router.get('/', roleMiddleware(['admin', 'partner']), listAssetsHandler);
router.get('/:id/file', roleMiddleware(['admin', 'partner']), serveAssetFile);
router.delete('/:id/locations/:locationId', roleMiddleware(['admin']), removeAssetLocationHandler);
router.delete('/:id', roleMiddleware(['admin']), deleteAssetHandler);

export default router;
