import { Router } from 'express';
import { authMiddleware } from '../middleware/authMiddleware.js';
import { roleMiddleware } from '../middleware/roleMiddleware.js';
import {
  makeCategoryUploadHandler,
  makeCategoryListHandler,
  makeCategoryGetHandler,
  makeCategoryDeleteHandler,
  makeFolderHandlers,
  makeMoveAssetsHandler,
  makeBulkDeleteAssetsHandler,
  makeBulkDownloadAssetsHandler,
  serveAssetFile,
  serveAssetThumbnail,
  removeAssetLocationHandler,
} from '../controllers/assetController.js';
import { assetUpload } from '../middleware/assetUpload.js';

const router = Router();
const folders = makeFolderHandlers('documents');

router.use(authMiddleware);

router.get('/', roleMiddleware(['admin', 'partner']), makeCategoryListHandler('documents'));
router.post(
  '/',
  roleMiddleware(['admin']),
  assetUpload.single('file'),
  makeCategoryUploadHandler('documents'),
);

// Folders (before /:id)
router.get('/folders', roleMiddleware(['admin', 'partner']), folders.list);
router.post('/folders', roleMiddleware(['admin']), folders.create);
router.post('/folders/ensure-path', roleMiddleware(['admin']), folders.ensurePath);
router.get('/folders/:id', roleMiddleware(['admin', 'partner']), folders.get);
router.get('/folders/:id/path', roleMiddleware(['admin', 'partner']), folders.path);
router.get('/folders/:id/download', roleMiddleware(['admin', 'partner']), folders.download);
router.patch('/folders/:id', roleMiddleware(['admin']), folders.rename);
router.post('/folders/:id/move', roleMiddleware(['admin']), folders.move);
router.delete('/folders/:id', roleMiddleware(['admin']), folders.remove);

router.post('/move', roleMiddleware(['admin']), makeMoveAssetsHandler('documents'));
router.post('/bulk-delete', roleMiddleware(['admin']), makeBulkDeleteAssetsHandler('documents'));
router.post('/download-zip', roleMiddleware(['admin', 'partner']), makeBulkDownloadAssetsHandler('documents'));

router.get('/:id', roleMiddleware(['admin', 'partner']), makeCategoryGetHandler('documents'));
router.get('/:id/file', roleMiddleware(['admin', 'partner']), serveAssetFile);
router.get('/:id/thumbnail', roleMiddleware(['admin', 'partner']), serveAssetThumbnail);
router.delete(
  '/:id/locations/:locationId',
  roleMiddleware(['admin']),
  removeAssetLocationHandler,
);
router.delete('/:id', roleMiddleware(['admin']), makeCategoryDeleteHandler('documents'));

export default router;
