import { Router } from 'express';
import { authMiddleware } from '../middleware/authMiddleware.js';
import { roleMiddleware } from '../middleware/roleMiddleware.js';
import { assetUpload } from '../middleware/assetUpload.js';
import {
  uploadAsset,
  listAssetsHandler,
  getAssetHandler,
  serveAssetFile,
  serveAssetThumbnail,
  deleteAssetHandler,
  removeAssetLocationHandler,
} from '../controllers/assetController.js';

const router = Router();

router.use(authMiddleware);

/**
 * @swagger
 * /api/assets:
 *   get:
 *     tags: [Assets]
 *     summary: List assets by category
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: category
 *         required: true
 *         schema:
 *           type: string
 *           enum: [documents, marketing_assets]
 *     responses:
 *       200:
 *         description: Asset list
 *   post:
 *     tags: [Assets]
 *     summary: Upload an asset (admin)
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             required: [file, category]
 *             properties:
 *               file:
 *                 type: string
 *                 format: binary
 *               name:
 *                 type: string
 *               category:
 *                 type: string
 *                 enum: [documents, marketing_assets]
 *               visibility:
 *                 type: string
 *                 enum: [global, location]
 *                 default: global
 *               locationIds:
 *                 type: array
 *                 items: { type: string }
 *               type:
 *                 type: string
 *                 enum: [postcard, banner, logo, other]
 *     responses:
 *       201:
 *         description: Created
 */
router.post('/', roleMiddleware(['admin']), assetUpload.single('file'), uploadAsset);
router.get('/', roleMiddleware(['admin', 'partner']), listAssetsHandler);
router.get('/:id', roleMiddleware(['admin', 'partner']), getAssetHandler);
router.get('/:id/file', roleMiddleware(['admin', 'partner']), serveAssetFile);
router.get('/:id/thumbnail', roleMiddleware(['admin', 'partner']), serveAssetThumbnail);
router.delete('/:id/locations/:locationId', roleMiddleware(['admin']), removeAssetLocationHandler);
router.delete('/:id', roleMiddleware(['admin']), deleteAssetHandler);

export default router;
