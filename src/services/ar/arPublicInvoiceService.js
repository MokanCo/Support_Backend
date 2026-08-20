import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import ArInvoice from '../../models/ArInvoice.js';
import ArPaymentSubmission from '../../models/ArPaymentSubmission.js';
import Location from '../../models/Location.js';
import ArBillingProfile from '../../models/ArBillingProfile.js';
import { AppError } from '../../utils/AppError.js';
import { money } from './arAccess.js';
import { quoteStripePayment } from '../../config/stripeFees.js';
import { getOrCreateSettings } from './arSettingsService.js';
import { writeArAudit } from './arAuditService.js';
import { createArPaymentSubmittedAdminNotification } from '../notificationService.js';
import { isR2Configured, uploadFile } from '../cloudflareR2StorageService.js';

const LOCAL_PROOF_ROOT = path.join(process.cwd(), 'uploads', 'ar-payment-proofs');

/** Cryptographically random public payment token (not based on invoice/partner ids). */
export function generatePublicPaymentToken() {
  return crypto.randomBytes(32).toString('hex');
}

/**
 * Ensure an invoice has an active public payment token. Reuses existing token
 * unless revoked or missing. Mutates and saves the mongoose document when needed.
 */
export async function ensurePublicPaymentToken(doc) {
  if (
    doc.publicPaymentToken &&
    !doc.publicPaymentTokenRevokedAt
  ) {
    return doc.publicPaymentToken;
  }
  let token = generatePublicPaymentToken();
  // Extremely unlikely collision — retry once.
  const clash = await ArInvoice.findOne({ publicPaymentToken: token }).select('_id').lean();
  if (clash) token = generatePublicPaymentToken();
  doc.publicPaymentToken = token;
  doc.publicPaymentTokenCreatedAt = new Date();
  doc.publicPaymentTokenRevokedAt = null;
  await doc.save();
  return token;
}

export function publicInvoicePayPath(token) {
  return `/invoice/pay?token=${encodeURIComponent(token)}`;
}

export function publicInvoicePayUrl(token) {
  const base = (process.env.APP_URL || process.env.FRONTEND_URL || '').replace(/\/$/, '');
  if (!base || !token) return '';
  return `${base}${publicInvoicePayPath(token)}`;
}

export async function loadInvoiceByToken(token) {
  const raw = String(token || '').trim();
  if (!raw || raw.length < 32) throw new AppError('Invalid payment link', 404);
  const doc = await ArInvoice.findOne({
    publicPaymentToken: raw,
    isDeleted: { $ne: true },
  });
  if (!doc) throw new AppError('Invoice not found or link expired', 404);
  if (doc.publicPaymentTokenRevokedAt) {
    throw new AppError('This payment link has been revoked', 410);
  }
  if (['void', 'cancelled', 'draft'].includes(doc.status)) {
    throw new AppError('This invoice is not available for payment', 409);
  }
  return doc;
}

function publicZelleMethod(settings) {
  return (settings.paymentMethods || []).find(
    (m) => m.type === 'zelle' && m.enabled !== false,
  ) || null;
}

function publicStripeMethod(settings) {
  return (settings.paymentMethods || []).find(
    (m) => m.type === 'stripe' && m.enabled !== false,
  ) || null;
}

/**
 * Public payload — only fields needed to view/pay. No internal notes, admin ids, etc.
 */
export async function getPublicInvoiceByToken(token) {
  const doc = await loadInvoiceByToken(token);
  const [location, profile, settings, pendingSubmission] = await Promise.all([
    Location.findById(doc.locationId).lean(),
    ArBillingProfile.findOne({ locationId: doc.locationId }).lean(),
    getOrCreateSettings(),
    ArPaymentSubmission.findOne({
      invoiceId: doc._id,
      status: 'pending',
    })
      .sort({ createdAt: -1 })
      .lean(),
  ]);

  // Mark viewed (public open counts as view)
  if (!doc.viewedAt) {
    doc.viewedAt = new Date();
    if (doc.status === 'sent') doc.status = 'viewed';
    doc.timeline = doc.timeline || [];
    doc.timeline.push({
      eventType: 'viewed',
      title: 'Invoice Viewed',
      description: 'Opened via public payment link',
      createdAt: new Date(),
    });
    await doc.save();
  }

  const zelle = publicZelleMethod(settings);
  const stripe = publicStripeMethod(settings);
  const balanceDue = money(doc.balanceDue);
  const isPaid = balanceDue <= 0 || doc.status === 'paid';

  return {
    invoice: {
      invoiceNumber: doc.invoiceNumber,
      status: doc.status,
      invoiceDate: doc.invoiceDate,
      dueDate: doc.dueDate,
      currency: doc.currency || 'USD',
      items: (doc.items || []).map((i) => ({
        name: i.name,
        description: i.description || '',
        quantity: i.quantity,
        unitPrice: i.unitPrice,
        lineTotal: i.lineTotal,
      })),
      subtotal: doc.subtotal,
      taxAmount: doc.taxAmount,
      discountAmount: doc.discountAmount,
      lateFeeAmount: doc.lateFeeAmount,
      creditApplied: doc.creditApplied,
      total: doc.total,
      amountPaid: doc.amountPaid,
      balanceDue,
      notes: doc.notes || '',
      isPaid,
      hasPendingSubmission: Boolean(pendingSubmission),
      pendingSubmission: pendingSubmission
        ? {
            amount: pendingSubmission.amount,
            submittedAt: pendingSubmission.createdAt,
            paymentDate: pendingSubmission.paymentDate,
            paymentMethod: pendingSubmission.paymentMethod,
            transactionReference: pendingSubmission.transactionReference || '',
            notes: pendingSubmission.notes || '',
            proofUrl: pendingSubmission.proofUrl || '',
            status: pendingSubmission.status,
          }
        : null,
    },
    billing: {
      companyName: location?.name || '',
      billingEmail:
        profile?.billingEmail ||
        profile?.secondaryBillingEmail ||
        location?.email ||
        '',
      billingAddress: [
        location?.address,
        [location?.city, location?.state, location?.zip].filter(Boolean).join(', '),
      ]
        .filter(Boolean)
        .join('\n'),
    },
    company: {
      name: settings.companyName || 'Mokanco',
      logoUrl: settings.logoUrl || '',
      supportEmail: settings.supportEmail || '',
      billingEmail: settings.billingEmail || '',
    },
    zelle: zelle
      ? {
          enabled: true,
          label: zelle.label || 'Zelle',
          displayName: zelle.displayName || '',
          recipientEmail: zelle.recipientEmail || '',
          recipientPhone: zelle.recipientPhone || '',
          qrCodeUrl: zelle.qrCodeUrl || '',
          details: zelle.details || '',
          instructions:
            settings.paymentInstructions ||
            'Please pay via Zelle using the instructions on this page.',
        }
      : { enabled: false },
    // Stripe's secret key never leaves the server — only whether the admin
    // has enabled it is exposed; the actual checkout session is created
    // server-side via /stripe-checkout-session.
    stripe:
      stripe && process.env.STRIPE_SECRET_KEY
        ? {
            enabled: true,
            label: stripe.label || 'Credit / Debit Card',
            fee: quoteStripePayment(balanceDue, 'stripe', doc.currency || 'USD'),
          }
        : { enabled: false },
  };
}

export async function storePaymentProof(file) {
  if (!file?.buffer?.length) return '';
  const ext = path.extname(file.originalname || '').toLowerCase() || '.jpg';
  const allowed = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.pdf']);
  if (!allowed.has(ext)) {
    throw new AppError('Proof must be an image or PDF', 400);
  }
  if (file.buffer.length > 10 * 1024 * 1024) {
    throw new AppError('Proof file exceeds 10 MB', 400);
  }

  if (isR2Configured('documents')) {
    const uploaded = await uploadFile(file, {
      category: 'documents',
      folder: 'ar-payment-proofs',
    });
    return uploaded.fileUrl;
  }

  await fs.promises.mkdir(LOCAL_PROOF_ROOT, { recursive: true });
  const name = `${Date.now()}-${randomUUID().slice(0, 8)}${ext}`;
  await fs.promises.writeFile(path.join(LOCAL_PROOF_ROOT, name), file.buffer);
  return `/uploads/ar-payment-proofs/${name}`;
}

/**
 * Public "I've completed payment" — does NOT mark invoice paid.
 */
export async function submitPublicPayment(token, body = {}, file = null) {
  const doc = await loadInvoiceByToken(token);
  const balanceDue = money(doc.balanceDue);
  if (balanceDue <= 0) {
    throw new AppError('This invoice is already paid', 409);
  }

  const existingPending = await ArPaymentSubmission.findOne({
    invoiceId: doc._id,
    status: 'pending',
  }).lean();
  if (existingPending) {
    throw new AppError(
      'A payment confirmation is already pending verification for this invoice',
      409,
    );
  }

  const amount = body.amount != null ? money(body.amount) : balanceDue;
  if (amount <= 0) throw new AppError('A valid amount is required', 400);
  if (amount > balanceDue + 0.009) {
    throw new AppError('Amount cannot exceed the outstanding balance', 400);
  }

  const transactionReference = String(body.transactionReference || '').trim();
  if (!transactionReference) {
    throw new AppError('Zelle transaction ID is required', 400);
  }

  let proofUrl = '';
  if (file) proofUrl = await storePaymentProof(file);

  const paymentDate = body.paymentDate ? new Date(body.paymentDate) : new Date();
  if (Number.isNaN(paymentDate.getTime())) {
    throw new AppError('Invalid payment date', 400);
  }

  const submission = await ArPaymentSubmission.create({
    invoiceId: doc._id,
    locationId: doc.locationId,
    submittedBy: null,
    amount,
    paymentMethod: body.paymentMethod || 'zelle',
    paymentDate,
    transactionReference,
    notes: String(body.notes || '').trim(),
    proofUrl,
    source: 'public_invoice',
    status: 'pending',
  });

  const location = await Location.findById(doc.locationId).select('name').lean();

  await createArPaymentSubmittedAdminNotification({
    submissionId: String(submission._id),
    invoiceId: String(doc._id),
    invoiceNumber: doc.invoiceNumber,
    amount,
    method: submission.paymentMethod,
    locationName: location?.name || 'Unknown location',
    partnerName: 'Customer (public invoice)',
  });

  await writeArAudit({
    entityType: 'payment_submission',
    entityId: String(submission._id),
    action: 'payment_submission_created',
    description: `Public payment confirmation for ${doc.invoiceNumber}`,
    newValue: {
      amount,
      paymentMethod: submission.paymentMethod,
      source: 'public_invoice',
    },
    actor: { id: null, name: 'Public invoice', email: '' },
  });

  doc.timeline = doc.timeline || [];
  doc.timeline.push({
    eventType: 'payment_submitted',
    title: 'Payment Submitted',
    description: 'Customer reported Zelle payment — pending verification',
    createdAt: new Date(),
  });
  await doc.save();

  return {
    submission: {
      id: String(submission._id),
      status: submission.status,
      amount: submission.amount,
      transactionReference: submission.transactionReference,
      submittedAt: submission.createdAt,
    },
  };
}
