import { KnowledgeEntry, KNOWLEDGE_CATEGORIES } from '../models/receptionist.js';
import Location from '../models/Location.js';
import { AppError } from '../utils/AppError.js';
import { MAX_TICKET_LIST_PAGE_SIZE } from '../constants/pagination.js';
import { recordAudit } from './receptionistAuditService.js';
import { classifyFaqEntries, parseKnowledgeFile } from './faqMarkdown.js';

export { splitImport } from './faqMarkdown.js';

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

async function existingMatches(entries, locationId) {
  const titles = [...new Set(entries.map((entry) => String(entry.title || '').trim()).filter(Boolean))];
  if (!titles.length) return [];
  const docs = await KnowledgeEntry.find({ title: { $in: titles } })
    .collation({ locale: 'en', strength: 2 })
    .select('title scope locationId')
    .lean();
  return docs.map((doc) => ({
    title: doc.title,
    scope: doc.scope,
    locationId: doc.locationId ? String(doc.locationId) : null,
  }));
}

function assertLegacyImport(input, kind) {
  if (kind !== 'legacy') return;
  if (!KNOWLEDGE_CATEGORIES.includes(input.category)) throw new AppError('category is invalid', 400);
  if (!['global', 'branch'].includes(input.scope)) throw new AppError('scope must be global or branch', 400);
}

export async function previewKnowledgeImport(input) {
  const source = String(input.text ?? '');
  if (!source.trim()) throw new AppError('Import text is empty', 400);
  if (input.locationId) await requireBranch(input.locationId);
  const parsed = parseKnowledgeFile(source, input.filename);
  const existing = await existingMatches(parsed.entries, input.locationId);
  return classifyFaqEntries(parsed.entries, {
    kind: parsed.kind === 'legacy' ? 'legacy' : 'faq',
    locationId: input.locationId || null,
    fallbackCategory: input.category,
    fallbackScope: input.scope,
    existing,
    parseError: parsed.parseError,
  });
}

export async function importKnowledge(input, user) {
  const source = String(input.text ?? '');
  if (!source.trim()) throw new AppError('Import text is empty', 400);
  const parsed = parseKnowledgeFile(source, input.filename);
  assertLegacyImport(input, parsed.kind);
  if (parsed.kind === 'legacy' && input.scope === 'branch') await requireBranch(input.locationId);
  const preview = await previewKnowledgeImport(input);
  if (preview.parseError && preview.total === 0) throw new AppError(preview.parseError, 400);
  const created = [];
  const failed = [];
  for (const entry of preview.entries) {
    if (!entry.valid) continue;
    try {
      // Reuse the single-entry validation, scope rules, and audit trail.
      // eslint-disable-next-line no-await-in-loop
      const saved = await createKnowledge(
        {
          title: entry.title,
          body: entry.body,
          category: entry.category,
          scope: entry.scope,
          locationId: entry.scope === 'branch' ? input.locationId : null,
        },
        user,
      );
      created.push(saved);
    } catch (error) {
      failed.push({
        index: entry.index,
        title: entry.title,
        error: error instanceof Error ? error.message : 'Could not save this entry',
      });
    }
  }
  const locationId = input.locationId || null;
  await recordAudit(user, 'import', 'knowledge', '', locationId);
  return {
    imported: created.length,
    created: created.length,
    skipped: preview.entries
      .filter((entry) => entry.errors.length > 0)
      .map((entry) => ({ index: entry.index, title: entry.title, errors: entry.errors })),
    duplicates: preview.entries
      .filter((entry) => entry.duplicate && entry.errors.length === 0)
      .map((entry) => ({
        index: entry.index,
        title: entry.title,
        reason: entry.duplicateOf === 'file' ? 'Repeated in this file' : 'Already in the knowledge base',
      })),
    failed,
    entries: created,
  };
}

export async function approvedEntriesForBranch(locationId) {
  const filter = locationId
    ? { approved: true, $or: [{ scope: 'global' }, { scope: 'branch', locationId }] }
    : { approved: true, scope: 'global' };
  return KnowledgeEntry.find(filter).select('title body category scope locationId').lean();
}
