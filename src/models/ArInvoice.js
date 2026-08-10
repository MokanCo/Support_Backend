import mongoose from 'mongoose';
import { AR_INVOICE_STATUSES } from '../constants/arConstants.js';

const lineItemSchema = new mongoose.Schema(
  {
    productId: { type: mongoose.Schema.Types.ObjectId, ref: 'ArProduct', default: null },
    name: { type: String, required: true, trim: true },
    description: { type: String, default: '' },
    quantity: { type: Number, required: true, min: 0, default: 1 },
    unitPrice: { type: Number, required: true, min: 0 },
    taxable: { type: Boolean, default: false },
    taxPercentage: { type: Number, default: 0 },
    lineTotal: { type: Number, required: true, min: 0 },
  },
  { _id: true },
);

const attachmentSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    fileUrl: { type: String, required: true },
    contentType: { type: String, default: '' },
    uploadedAt: { type: Date, default: Date.now },
  },
  { _id: true },
);

const timelineSchema = new mongoose.Schema(
  {
    eventType: { type: String, required: true },
    title: { type: String, required: true },
    description: { type: String, default: '' },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    userName: { type: String, default: '' },
    ipAddress: { type: String, default: '' },
    createdAt: { type: Date, default: Date.now },
  },
  { _id: true },
);

const arInvoiceSchema = new mongoose.Schema(
  {
    invoiceNumber: { type: String, unique: true, sparse: true, trim: true, index: true },
    locationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Location',
      required: true,
      index: true,
    },
    recurringTemplateId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'ArRecurringTemplate',
      default: null,
    },
    /** PDF layout template (drag-drop builder). */
    invoiceTemplateId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'ArInvoiceTemplate',
      default: null,
    },
    status: {
      type: String,
      enum: AR_INVOICE_STATUSES,
      default: 'draft',
      index: true,
    },
    invoiceDate: { type: Date, required: true, index: true },
    dueDate: { type: Date, required: true, index: true },
    billingPeriodStart: { type: Date, default: null },
    billingPeriodEnd: { type: Date, default: null },
    currency: { type: String, default: 'USD' },
    items: { type: [lineItemSchema], default: [] },
    notes: { type: String, default: '' },
    internalNotes: { type: String, default: '' },
    discountAmount: { type: Number, default: 0, min: 0 },
    taxAmount: { type: Number, default: 0, min: 0 },
    lateFeeAmount: { type: Number, default: 0, min: 0 },
    creditApplied: { type: Number, default: 0, min: 0 },
    subtotal: { type: Number, default: 0, min: 0 },
    total: { type: Number, default: 0, min: 0 },
    amountPaid: { type: Number, default: 0, min: 0 },
    balanceDue: { type: Number, default: 0, min: 0 },
    attachments: { type: [attachmentSchema], default: [] },
    timeline: { type: [timelineSchema], default: [] },
    pdfUrl: { type: String, default: '' },
    sentAt: { type: Date, default: null },
    viewedAt: { type: Date, default: null },
    paidAt: { type: Date, default: null },
    scheduledSendAt: { type: Date, default: null },
    lateFeeAppliedAt: { type: Date, default: null },
    lastReminderAt: { type: Date, default: null },
    lastReminderDayOffset: { type: Number, default: null },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    approvedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    isDeleted: { type: Boolean, default: false, index: true },
  },
  { timestamps: true },
);

arInvoiceSchema.index({ locationId: 1, status: 1, invoiceDate: -1 });
arInvoiceSchema.index({ dueDate: 1, status: 1 });

export default mongoose.model('ArInvoice', arInvoiceSchema);
