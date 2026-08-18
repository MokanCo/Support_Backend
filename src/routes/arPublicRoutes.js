import { Router } from 'express';
import multer from 'multer';
import { asyncHandler } from '../utils/asyncHandler.js';
import * as publicInvoice from '../services/ar/arPublicInvoiceService.js';
import { createPublicCheckoutSession } from '../services/ar/arStripeService.js';

const router = Router();

const proofUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
});

/**
 * Public invoice payment APIs — no auth.
 * GET  /api/public/invoices/:token
 * POST /api/public/invoices/:token/payment-submissions
 * POST /api/public/invoices/:token/stripe-checkout-session
 *
 * The Stripe webhook itself is mounted separately in app.js, ahead of the
 * JSON body parser, since Stripe's signature check needs the raw body.
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

router.post(
  '/invoices/:token/stripe-checkout-session',
  asyncHandler(async (req, res) => {
    res.json(await createPublicCheckoutSession(req.params.token));
  }),
);

export default router;
