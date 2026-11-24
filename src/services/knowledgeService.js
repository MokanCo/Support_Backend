import { KnowledgeEntry, KNOWLEDGE_CATEGORIES } from '../models/receptionist.js';
import Location from '../models/Location.js';
import { AppError } from '../utils/AppError.js';
import { MAX_TICKET_LIST_PAGE_SIZE } from '../constants/pagination.js';
import { recordAudit } from './receptionistAuditService.js';

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function format(doc, branchName = '') {
  const row = doc.toObject ? doc.toObject() : doc;
  return {
    id: String(row._id),
    title: row.title,
    body: row.body,
    category: row.category,
    scope: row.scope,
    locationId: row.locationId ? String(row.locationId) : null,
    branchName,
    approved: Boolean(row.approved),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

async function namesFor(docs) {
  const ids = docs.map((doc) => doc.locationId).filter(Boolean);
  const locations = await Location.find({ _id: { $in: ids } }).select('name').lean();
  return new Map(locations.map((location) => [String(location._id), location.name]));
}

async function requireBranch(locationId) {
  const location = await Location.findById(locationId).select('_id name');
  if (!location) throw new AppError('Branch not found', 404);
  return location;
}

function cleanWrite(input, { partial = false } = {}) {
  const next = {};
  if (!partial || input.title !== undefined) {
    const title = String(input.title ?? '').trim();
    if (!title || title.length > 180) throw new AppError('title must be 1 to 180 characters', 400);
    next.title = title;
  }
  if (!partial || input.body !== undefined) {
    const body = String(input.body ?? '').trim();
    if (!body || body.length > 20000) throw new AppError('body must be 1 to 20000 characters', 400);
    next.body = body;
  }
  if (!partial || input.category !== undefined) {
    if (!KNOWLEDGE_CATEGORIES.includes(input.category)) throw new AppError('category is invalid', 400);
    next.category = input.category;
  }
  if (!partial || input.scope !== undefined) {
    if (!['global', 'branch'].includes(input.scope)) throw new AppError('scope must be global or branch', 400);
    next.scope = input.scope;
  }
  return next;
}

export async function listKnowledge(query) {
  const page = Math.max(1, Number(query.page) || 1);
  const pageSize = Math.min(MAX_TICKET_LIST_PAGE_SIZE, Math.max(1, Number(query.pageSize) || 10));
  const filter = { approved: true };
  if (query.category && query.category !== 'all') filter.category = query.category;
  if (query.scope === 'global' || query.scope === 'branch') filter.scope = query.scope;
  if (query.locationId) filter.locationId = query.locationId;
  const search = typeof query.search === 'string' ? query.search.trim() : '';
  if (search) {
    const rx = new RegExp(escapeRegex(search), 'i');
    filter.$or = [{ title: rx }, { body: rx }];
  }
  const [total, docs] = await Promise.all([
    KnowledgeEntry.countDocuments(filter),
    KnowledgeEntry.find(filter)
      .sort({ updatedAt: -1 })
      .skip((page - 1) * pageSize)
      .limit(pageSize)
      .lean(),
  ]);
  const names = await namesFor(docs);
  return {
    entries: docs.map((doc) => format(doc, names.get(String(doc.locationId)) ?? '')),
    total,
    page,
    pageSize,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
  };
}

export async function getKnowledge(id) {
  const doc = await KnowledgeEntry.findById(id);
  if (!doc) throw new AppError('Knowledge entry not found', 404);
  let branchName = '';
  if (doc.locationId) {
    const location = await Location.findById(doc.locationId).select('name').lean();
    branchName = location?.name ?? '';
  }
  return format(doc, branchName);
}

async function applyScope(doc, input) {
  const scope = input.scope ?? doc.scope;
  if (scope === 'branch') {
    if (!input.locationId && !doc.locationId) throw new AppError('locationId is required for branch entries', 400);
    const location = await requireBranch(input.locationId || doc.locationId);
    doc.locationId = location._id;
    doc.scope = 'branch';
    return location.name;
  }
  doc.scope = 'global';
  doc.locationId = null;
  return '';
}

export async function createKnowledge(input, user) {
  const cleaned = cleanWrite(input);
  const doc = new KnowledgeEntry({ ...cleaned, approved: true, updatedBy: user?.id ?? null });
  const branchName = await applyScope(doc, input);
  await doc.save();
  await recordAudit(user, 'create', 'knowledge', doc._id, doc.locationId);
  return format(doc, branchName);
}

export async function updateKnowledge(id, input, user) {
  const doc = await KnowledgeEntry.findById(id);
  if (!doc) throw new AppError('Knowledge entry not found', 404);
  const cleaned = cleanWrite({ ...doc.toObject(), ...input }, { partial: true });
  Object.assign(doc, cleaned);
  const branchName = await applyScope(doc, { ...input, scope: doc.scope, locationId: input.locationId });
  doc.approved = true;
  doc.updatedBy = user?.id ?? null;
  await doc.save();
  await recordAudit(user, 'update', 'knowledge', doc._id, doc.locationId);
  return format(doc, branchName);
}

export async function deleteKnowledge(id, user) {
  const doc = await KnowledgeEntry.findById(id);
  if (!doc) throw new AppError('Knowledge entry not found', 404);
  await doc.deleteOne();
  await recordAudit(user, 'delete', 'knowledge', id, doc.locationId);
  return { ok: true };
}

export function splitImport(text, filename) {
  const source = String(text ?? '').trim();
  if (!source) throw new AppError('Import text is empty', 400);
  const blocks = source.split(/\n(?=(?:Q:|Question:)\s)/i).map((part) => part.trim()).filter(Boolean);
  if (blocks.length <= 1) {
    return [{ title: String(filename || 'Imported note').replace(/\.(txt|md)$/i, '').slice(0, 180), body: source.slice(0, 20000) }];
  }
  return blocks.slice(0, 50).map((block) => {
    const lines = block.split('\n');
    const title = lines[0].replace(/^(?:Q:|Question:)\s*/i, '').trim().slice(0, 180);
    const body = lines.slice(1).join('\n').replace(/^(?:A:|Answer:)\s*/i, '').trim().slice(0, 20000);
    return { title: title || 'Imported question', body: body || title };
  });
}

export async function importKnowledge(input, user) {
  const category = input.category;
  const scope = input.scope;
  if (!KNOWLEDGE_CATEGORIES.includes(category)) throw new AppError('category is invalid', 400);
  if (!['global', 'branch'].includes(scope)) throw new AppError('scope must be global or branch', 400);
  let locationId = null;
  let branchName = '';
  if (scope === 'branch') {
    const location = await requireBranch(input.locationId);
    locationId = location._id;
    branchName = location.name;
  }
  const pieces = splitImport(input.text, input.filename);
  const created = [];
  for (const piece of pieces) {
    // eslint-disable-next-line no-await-in-loop
    const doc = await KnowledgeEntry.create({
      title: piece.title,
      body: piece.body,
      category,
      scope,
      locationId,
      approved: true,
      updatedBy: user?.id ?? null,
    });
    created.push(format(doc, branchName));
  }
  await recordAudit(user, 'import', 'knowledge', '', locationId);
  return { imported: created.length, entries: created };
}

export async function approvedEntriesForBranch(locationId) {
  const filter = locationId
    ? { approved: true, $or: [{ scope: 'global' }, { scope: 'branch', locationId }] }
    : { approved: true, scope: 'global' };
  return KnowledgeEntry.find(filter).select('title body category scope locationId').lean();
}
