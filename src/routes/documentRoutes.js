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
 * /api/documents:
 *   get:
 *     tags: [Documents]
 *     summary: List all active documents
 *     description: Returns documents visible to the caller (admin sees all; partners see global + their location).
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Document list
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 documents:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/Document'
 *       401:
 *         description: Unauthorized
 *   post:
 *     tags: [Documents]
 *     summary: Upload a document
 *     description: |
 *       Accepts `multipart/form-data`. The file is uploaded to Cloudflare R2;
 *       only the public URL and metadata are saved in the database.
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
 *                 description: Display name (optional; defaults to original filename)
 *                 example: Partner Handbook
 *               name:
 *                 type: string
 *                 description: Alias for Name
 *               file:
 *                 type: string
 *                 format: binary
 *                 description: Document file (max 50 MB)
 *               visibility:
 *                 type: string
 *                 enum: [global, location]
 *                 default: global
 *               locationIds:
 *                 type: array
 *                 items:
 *                   type: string
 *                 description: Required when visibility is location
 *     responses:
 *       201:
 *         description: Document created
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 document:
 *                   $ref: '#/components/schemas/Document'
 *       400:
 *         description: Validation error
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden (admin only)
 *       503:
 *         description: R2 not configured (when local fallback is disabled)
 *
 * /api/documents/{id}:
 *   get:
 *     tags: [Documents]
 *     summary: Get a single document
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Document
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 document:
 *                   $ref: '#/components/schemas/Document'
 *       404:
 *         description: Not found
 *   delete:
 *     tags: [Documents]
 *     summary: Soft-delete a document
 *     description: Marks the document as deleted. The file is not removed from the R2 bucket.
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Soft-deleted
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 ok: { type: boolean, example: true }
 *       404:
 *         description: Not found
 */
router.get('/', roleMiddleware(['admin', 'partner']), makeCategoryListHandler('documents'));
router.post(
  '/',
  roleMiddleware(['admin']),
  assetUpload.single('file'),
  makeCategoryUploadHandler('documents'),
);
router.get('/:id', roleMiddleware(['admin', 'partner']), makeCategoryGetHandler('documents'));
router.get('/:id/file', roleMiddleware(['admin', 'partner']), serveAssetFile);
router.delete(
  '/:id/locations/:locationId',
  roleMiddleware(['admin']),
  removeAssetLocationHandler,
);
router.delete('/:id', roleMiddleware(['admin']), makeCategoryDeleteHandler('documents'));

export default router;
