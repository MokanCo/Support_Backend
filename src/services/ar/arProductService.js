import ArProduct from '../../models/ArProduct.js';
import { AppError } from '../../utils/AppError.js';
import { assertCanManageAr, assertCanViewAr, parseListQuery, money } from './arAccess.js';
import { writeArAudit } from './arAuditService.js';

function formatProduct(doc) {
  const d = doc.toObject ? doc.toObject() : doc;
  return {
    id: String(d._id),
    name: d.name,
    description: d.description,
    category: d.category,
    price: d.price,
    taxable: d.taxable,
    taxPercentage: d.taxPercentage,
    isRequired: Boolean(d.isRequired),
    accountingCategory: d.accountingCategory,
    isActive: d.isActive,
    isArchived: d.isArchived,
    createdAt: d.createdAt,
    updatedAt: d.updatedAt,
  };
}

export async function listProducts(actor, query) {
  assertCanViewAr(actor);
  const { page, pageSize, sort, order, search, skip } = parseListQuery(query, {
    defaultSort: 'name',
  });
  const filter = { isDeleted: { $ne: true } };
  if (query.active === 'true') filter.isActive = true;
  if (query.active === 'false') filter.isActive = false;
  if (query.archived === 'true') filter.isArchived = true;
  else if (query.archived !== 'all') filter.isArchived = { $ne: true };
  if (query.category) filter.category = query.category;
  if (search) filter.$text = { $search: search };

  const [items, total] = await Promise.all([
    ArProduct.find(filter).sort({ [sort]: order }).skip(skip).limit(pageSize).lean(),
    ArProduct.countDocuments(filter),
  ]);

  return {
    products: items.map(formatProduct),
    total,
    page,
    pageSize,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
  };
}

export async function getProduct(actor, id) {
  assertCanViewAr(actor);
  const doc = await ArProduct.findOne({ _id: id, isDeleted: { $ne: true } });
  if (!doc) throw new AppError('Product not found', 404);
  return { product: formatProduct(doc) };
}

export async function createProduct(actor, input, ipAddress = '') {
  assertCanManageAr(actor);
  const doc = await ArProduct.create({
    name: String(input.name || '').trim(),
    description: String(input.description || '').trim(),
    category: String(input.category || 'General').trim(),
    price: money(input.price),
    taxable: Boolean(input.taxable),
    taxPercentage: money(input.taxPercentage),
    isRequired: Boolean(input.isRequired),
    accountingCategory: String(input.accountingCategory || '').trim(),
    isActive: input.isActive !== false,
    createdBy: actor.id,
  });
  await writeArAudit({
    entityType: 'product',
    entityId: String(doc._id),
    action: 'product_created',
    description: `Product created: ${doc.name}`,
    newValue: formatProduct(doc),
    actor,
    ipAddress,
  });
  return { product: formatProduct(doc) };
}

export async function updateProduct(actor, id, patch, ipAddress = '') {
  assertCanManageAr(actor);
  const doc = await ArProduct.findOne({ _id: id, isDeleted: { $ne: true } });
  if (!doc) throw new AppError('Product not found', 404);
  const prev = formatProduct(doc);
  if (patch.name !== undefined) doc.name = String(patch.name).trim();
  if (patch.description !== undefined) doc.description = String(patch.description).trim();
  if (patch.category !== undefined) doc.category = String(patch.category).trim();
  if (patch.price !== undefined) doc.price = money(patch.price);
  if (patch.taxable !== undefined) doc.taxable = Boolean(patch.taxable);
  if (patch.taxPercentage !== undefined) doc.taxPercentage = money(patch.taxPercentage);
  if (patch.isRequired !== undefined) doc.isRequired = Boolean(patch.isRequired);
  if (patch.accountingCategory !== undefined) {
    doc.accountingCategory = String(patch.accountingCategory).trim();
  }
  if (patch.isActive !== undefined) doc.isActive = Boolean(patch.isActive);
  if (patch.isArchived !== undefined) doc.isArchived = Boolean(patch.isArchived);
  await doc.save();
  await writeArAudit({
    entityType: 'product',
    entityId: String(doc._id),
    action: 'product_updated',
    description: `Product updated: ${doc.name}`,
    previousValue: prev,
    newValue: formatProduct(doc),
    actor,
    ipAddress,
  });
  return { product: formatProduct(doc) };
}

export async function archiveProduct(actor, id, ipAddress = '') {
  return updateProduct(actor, id, { isArchived: true, isActive: false }, ipAddress);
}

export async function deleteProduct(actor, id, ipAddress = '') {
  assertCanManageAr(actor);
  const doc = await ArProduct.findOne({ _id: id, isDeleted: { $ne: true } });
  if (!doc) throw new AppError('Product not found', 404);
  doc.isDeleted = true;
  doc.isActive = false;
  await doc.save();
  await writeArAudit({
    entityType: 'product',
    entityId: String(doc._id),
    action: 'product_deleted',
    description: `Product deleted: ${doc.name}`,
    actor,
    ipAddress,
  });
  return { ok: true };
}
