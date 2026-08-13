import { Router } from 'express';
import multer from 'multer';
import { asyncHandler } from '../utils/asyncHandler.js';
import * as publicInvoice from '../services/ar/arPublicInvoiceService.js';

const router = Router();

const proofUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
});

/**
 * Public invoice payment APIs — no auth.
 * GET  /api/public/invoices/:token
 * POST /api/public/invoices/:token/payment-submissions
 */

router.get(
  '/invoices/:token',
  asyncHandler(async (req, res) => {
    res.json(await publicInvoice.getPublicInvoiceByToken(req.params.token));
  }),
);

router.post(
  '/invoices/:token/payment-submissions',
  proofUpload.single('proof'),
  asyncHandler(async (req, res) => {
    const body = { ...req.body };
    if (typeof body.amount === 'string') body.amount = Number(body.amount);
    res
      .status(201)
      .json(await publicInvoice.submitPublicPayment(req.params.token, body, req.file || null));
  }),
);

export default router;
