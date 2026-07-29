import { Router } from 'express';
import { authMiddleware } from '../middleware/authMiddleware.js';
import { roleMiddleware } from '../middleware/roleMiddleware.js';
import {
  makeCategoryUploadHandler,
  makeCategoryListHandler,
  makeCategoryGetHandler,
  makeCategoryDeleteHandler,
  serveAssetFile,
  removeAssetLocationHandler,
} from '../controllers/assetController.js';
import { assetUpload } from '../middleware/assetUpload.js';

const router = Router();

router.use(authMiddleware);

/**
 * @swagger
 * /api/marketing-assets:
 *   get:
 *     tags: [Marketing Assets]
 *     summary: List marketing assets
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Asset list
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 assets:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/Document'
 *   post:
 *     tags: [Marketing Assets]
 *     summary: Upload a marketing asset
 *     description: Uploads file to Cloudflare R2 and saves URL + metadata only.
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             required: [file]
 *             properties:
 *               Name:
 *                 type: string
 *               name:
 *                 type: string
 *               file:
 *                 type: string
 *                 format: binary
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
 *                 description: Marketing asset type
 *     responses:
 *       201:
 *         description: Created
 *       400:
 *         description: Validation error
 *
 * /api/marketing-assets/{id}:
 *   get:
 *     tags: [Marketing Assets]
 *     summary: Get one marketing asset
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Asset
 *       404:
 *         description: Not found
 *   delete:
 *     tags: [Marketing Assets]
 *     summary: Soft-delete a marketing asset
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Soft-deleted
 *       404:
 *         description: Not found
 */
router.get('/', roleMiddleware(['admin', 'partner']), makeCategoryListHandler('marketing_assets'));
router.post(
  '/',
  roleMiddleware(['admin']),
  assetUpload.single('file'),
  makeCategoryUploadHandler('marketing_assets'),
);
router.get('/:id', roleMiddleware(['admin', 'partner']), makeCategoryGetHandler('marketing_assets'));
router.get('/:id/file', roleMiddleware(['admin', 'partner']), serveAssetFile);
router.delete(
  '/:id/locations/:locationId',
  roleMiddleware(['admin']),
  removeAssetLocationHandler,
);
router.delete('/:id', roleMiddleware(['admin']), makeCategoryDeleteHandler('marketing_assets'));

export default router;
