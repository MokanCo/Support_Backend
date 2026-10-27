import crypto from 'crypto';
import ArInvoiceTemplate from '../../models/ArInvoiceTemplate.js';
import { AppError } from '../../utils/AppError.js';
import {
  AR_DEFAULT_INVOICE_BLOCKS,
  AR_INVOICE_BLOCK_TYPES,
} from '../../constants/arConstants.js';
import { assertCanManageAr, assertCanViewAr, toObjectId } from './arAccess.js';
import { writeArAudit } from './arAuditService.js';

function blockId() {
  return crypto.randomBytes(6).toString('hex');
}

export function buildDefaultBlocks() {
  return AR_DEFAULT_INVOICE_BLOCKS.map((b) => ({
    id: blockId(),
    type: b.type,
    enabled: b.enabled !== false,
    label: b.label || b.type,
    content: '',
    align: 'left',
    fontSize: 10,
  }));
}

function formatTemplate(doc) {
  const d = doc.toObject ? doc.toObject() : doc;
  return {
    id: String(d._id),
    name: d.name,
    description: d.description || '',
    isDefault: Boolean(d.isDefault),
    isActive: d.isActive !== false,
    blocks: (d.blocks || []).map((b) => ({
      id: b.id,
      type: b.type,
      enabled: b.enabled !== false,
      label: b.label || '',
      content: b.content || '',
      align: b.align || 'left',
      fontSize: Number(b.fontSize) || 10,
    })),
    createdAt: d.createdAt,
    updatedAt: d.updatedAt,
  };
}

function normalizeBlocks(blocks) {
  if (!Array.isArray(blocks) || blocks.length === 0) {
    return buildDefaultBlocks();
  }
  return blocks.map((b, idx) => {
    const type = String(b.type || '').trim();
    if (!AR_INVOICE_BLOCK_TYPES.includes(type)) {
      throw new AppError(`Invalid block type at index ${idx}: ${type}`, 400);
    }
    return {
      id: String(b.id || blockId()),
      type,
      enabled: b.enabled !== false,
      label: String(b.label || type).trim().slice(0, 80),
      content: String(b.content || '').slice(0, 4000),
      align: ['left', 'center', 'right'].includes(b.align) ? b.align : 'left',
      fontSize: Math.min(24, Math.max(8, Number(b.fontSize) || 10)),
    };
  });
}

export async function ensureDefaultTemplate() {
  const existing = await ArInvoiceTemplate.findOne({
    isDefault: true,
    isDeleted: { $ne: true },
  });
  if (existing) return existing;

  const any = await ArInvoiceTemplate.findOne({ isDeleted: { $ne: true } });
  if (any) {
    any.isDefault = true;
    await any.save();
    return any;
  }

  return ArInvoiceTemplate.create({
    name: 'Standard Invoice',
    description: 'Default Mokanco invoice layout',
    isDefault: true,
    isActive: true,
    blocks: buildDefaultBlocks(),
  });
}

export async function listTemplates(actor) {
  assertCanViewAr(actor);
  await ensureDefaultTemplate();
  const items = await ArInvoiceTemplate.find({ isDeleted: { $ne: true } })
    .sort({ isDefault: -1, name: 1 })
    .lean();
  return { templates: items.map(formatTemplate) };
}

export async function getTemplate(actor, id) {
  assertCanViewAr(actor);
  const doc = await ArInvoiceTemplate.findOne({
    _id: toObjectId(id, 'template id'),
    isDeleted: { $ne: true },
  });
  if (!doc) throw new AppError('Invoice template not found', 404);
  return { template: formatTemplate(doc) };
}

export async function getDefaultTemplate() {
  const doc = await ensureDefaultTemplate();
  return doc;
}

export async function createTemplate(actor, input, ipAddress = '') {
  assertCanManageAr(actor);
  const name = String(input.name || '').trim();
  if (!name) throw new AppError('name is required', 400);

  const doc = await ArInvoiceTemplate.create({
    name,
    description: String(input.description || '').trim(),
    isDefault: false,
    isActive: input.isActive !== false,
    blocks: normalizeBlocks(input.blocks),
    createdBy: actor.id || null,
  });

  if (input.isDefault === true) {
    await ArInvoiceTemplate.updateMany(
      { _id: { $ne: doc._id }, isDeleted: { $ne: true } },
      { $set: { isDefault: false } },
    );
    doc.isDefault = true;
    await doc.save();
  }

  await writeArAudit({
    entityType: 'invoice_template',
    entityId: String(doc._id),
    action: 'template_created',
    description: `Invoice template created: ${doc.name}`,
    newValue: formatTemplate(doc),
    actor,
    ipAddress,
  });

  return { template: formatTemplate(doc) };
}

export async function updateTemplate(actor, id, input, ipAddress = '') {
  assertCanManageAr(actor);
  const doc = await ArInvoiceTemplate.findOne({
    _id: toObjectId(id, 'template id'),
    isDeleted: { $ne: true },
  });
  if (!doc) throw new AppError('Invoice template not found', 404);

  if (input.name !== undefined) {
    const name = String(input.name || '').trim();
    if (!name) throw new AppError('name is required', 400);
    doc.name = name;
  }
  if (input.description !== undefined) {
    doc.description = String(input.description || '').trim();
  }
  if (input.isActive !== undefined) doc.isActive = Boolean(input.isActive);
  if (input.blocks !== undefined) doc.blocks = normalizeBlocks(input.blocks);

  if (input.isDefault === true) {
    await ArInvoiceTemplate.updateMany(
      { _id: { $ne: doc._id }, isDeleted: { $ne: true } },
      { $set: { isDefault: false } },
    );
    doc.isDefault = true;
  } else if (input.isDefault === false && doc.isDefault) {
    throw new AppError('Set another template as default instead of unsetting this one', 400);
  }

  await doc.save();

  await writeArAudit({
    entityType: 'invoice_template',
    entityId: String(doc._id),
    action: 'template_updated',
    description: `Invoice template updated: ${doc.name}`,
    newValue: formatTemplate(doc),
    actor,
    ipAddress,
  });

  return { template: formatTemplate(doc) };
}

export async function deleteTemplate(actor, id, ipAddress = '') {
  assertCanManageAr(actor);
  const doc = await ArInvoiceTemplate.findOne({
    _id: toObjectId(id, 'template id'),
    isDeleted: { $ne: true },
  });
  if (!doc) throw new AppError('Invoice template not found', 404);
  if (doc.isDefault) {
    throw new AppError('Cannot delete the default invoice template', 409);
  }

  doc.isDeleted = true;
  doc.isActive = false;
  await doc.save();

  await writeArAudit({
    entityType: 'invoice_template',
    entityId: String(doc._id),
    action: 'template_deleted',
    description: `Invoice template deleted: ${doc.name}`,
    actor,
    ipAddress,
  });

  return { ok: true };
}

export async function resolveTemplateForInvoice(templateId) {
  if (templateId) {
    const doc = await ArInvoiceTemplate.findOne({
      _id: templateId,
      isDeleted: { $ne: true },
      isActive: { $ne: false },
    }).lean();
    if (doc) return doc;
  }
  return ensureDefaultTemplate();
}

export { formatTemplate, buildDefaultBlocks as getPaletteBlocks };
