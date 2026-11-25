import { KNOWLEDGE_CATEGORIES } from '../models/receptionist.js';

export const MAX_FAQ_IMPORT = 500;
export const MAX_TITLE_LENGTH = 180;
export const MAX_BODY_LENGTH = 20000;

const CATEGORY_BY_KEY = new Map(KNOWLEDGE_CATEGORIES.map((category) => [category.toLowerCase(), category]));
const CATEGORY_ALIASES = new Map([
  ['company', 'Company information'],
  ['company info', 'Company information'],
  ['about', 'Company information'],
  ['about us', 'Company information'],
  ['faq', 'General FAQs'],
  ['faqs', 'General FAQs'],
  ['general', 'General FAQs'],
  ['general faq', 'General FAQs'],
  ['general faqs', 'General FAQs'],
  ['menu', 'Menu information'],
  ['menu info', 'Menu information'],
  ['price', 'Menu prices'],
  ['prices', 'Menu prices'],
  ['pricing', 'Menu prices'],
  ['menu price', 'Menu prices'],
  ['promotion', 'Promotions'],
  ['promo', 'Promotions'],
  ['promos', 'Promotions'],
  ['specials', 'Promotions'],
  ['hours', 'Opening hours'],
  ['hour', 'Opening hours'],
  ['opening hour', 'Opening hours'],
  ['business hours', 'Opening hours'],
  ['hours of operation', 'Opening hours'],
  ['policy', 'Branch policies'],
  ['policies', 'Branch policies'],
  ['branch policy', 'Branch policies'],
  ['delivery', 'Delivery information'],
  ['pickup', 'Pickup information'],
  ['pick up', 'Pickup information'],
  ['takeout', 'Pickup information'],
  ['customer service', 'Customer service policies'],
  ['service policies', 'Customer service policies'],
  ['other', 'Other frequently asked questions'],
  ['other faqs', 'Other frequently asked questions'],
  ['miscellaneous', 'Other frequently asked questions'],
]);

const SCOPE_KEYS = new Map([
  ['global', 'global'],
  ['branch', 'branch'],
  ['branch specific', 'branch'],
  ['branch scoped', 'branch'],
]);

function cleanInline(value) {
  return String(value ?? '')
    .replace(/\*\*/g, '')
    .replace(/__/g, '')
    .replace(/`/g, '')
    .trim();
}

function normalizeKey(value) {
  return cleanInline(value).replace(/\s+/g, ' ').toLowerCase();
}

export function canonicalCategory(value) {
  const key = normalizeKey(value);
  return CATEGORY_BY_KEY.get(key) ?? CATEGORY_ALIASES.get(key) ?? null;
}

export function canonicalScope(value) {
  return SCOPE_KEYS.get(normalizeKey(value).replace(/[_-]+/g, ' ')) ?? null;
}

function fieldKind(label) {
  const key = normalizeKey(label);
  if (key === 'title' || key === 'question' || key === 'faq') return 'title';
  if (key === 'approved answer' || key === 'approved answers' || key === 'answer' || key === 'body') return 'answer';
  if (key === 'category') return 'category';
  if (key === 'scope') return 'scope';
  return null;
}

function matchFieldLine(line) {
  const stripped = cleanInline(line.replace(/^[-*+]\s+/, ''));
  const match = /^(title|question|faq|approved answers|approved answer|answer|body|category|scope)\s*[:：]\s*(.*)$/i.exec(stripped);
  if (!match) return null;
  return { field: fieldKind(match[1]), value: match[2].trim() };
}

function isScopeHeading(text) {
  const key = normalizeKey(text).replace(/[_-]+/g, ' ');
  return SCOPE_KEYS.has(key);
}

function freshBlock(title, inheritedCategory, inheritedScope) {
  return {
    title: title || '',
    titleExplicit: false,
    body: [],
    categoryExplicit: null,
    scopeExplicit: null,
    inheritedCategory,
    inheritedScope,
    sawField: false,
    activeField: null,
  };
}

function setScalar(block, field, value) {
  if (field === 'title') {
    block.title = value;
    block.titleExplicit = true;
    return;
  }
  if (field === 'category') block.categoryExplicit = value;
  if (field === 'scope') block.scopeExplicit = value;
}

function assignField(block, field, value) {
  block.sawField = true;
  if (field === 'answer') {
    block.activeField = 'answer';
    block.body = value ? [value] : [];
    return;
  }
  if (value) {
    setScalar(block, field, value);
    block.activeField = null;
    return;
  }
  block.activeField = field;
}

function materialize(block) {
  const title = String(block.title ?? '').trim().replace(/\s+/g, ' ');
  const body = block.body.join('\n').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  const questionHeading = /\?\s*$/.test(title);
  if (!block.sawField && !body && !questionHeading) return null;

  let category = null;
  let categoryRecognized = false;
  if (block.categoryExplicit != null) {
    const canon = canonicalCategory(block.categoryExplicit);
    category = canon || String(block.categoryExplicit).trim();
    categoryRecognized = Boolean(canon);
  } else if (block.inheritedCategory) {
    category = block.inheritedCategory;
    categoryRecognized = true;
  }

  let scope = null;
  let scopeRecognized = false;
  if (block.scopeExplicit != null) {
    scope = canonicalScope(block.scopeExplicit);
    scopeRecognized = Boolean(scope);
  } else if (block.inheritedScope) {
    scope = block.inheritedScope;
    scopeRecognized = true;
  }

  return { title, body, category, categoryRecognized, scope, scopeRecognized };
}

/**
 * Pull structured FAQ entries out of a Markdown document.
 * Category headings and Global / Branch headings are inherited.
 * Each entry heading or labeled block becomes its own entry.
 */
export function parseFaqMarkdown(text) {
  const lines = String(text ?? '').replace(/^\uFEFF/, '').split(/\r?\n/);
  const entries = [];
  let inheritedCategory = null;
  let inheritedScope = null;
  let block = null;
  let inFence = false;

  const flush = () => {
    if (!block) return;
    const entry = materialize(block);
    if (entry) entries.push(entry);
    block = null;
  };

  for (const raw of lines) {
    const line = raw.trim();
    if (line.startsWith('```')) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    if (!line) {
      if (block?.activeField === 'answer' && block.body.length) block.body.push('');
      continue;
    }
    if (/^(?:---|\*\*\*|___)\s*$/.test(line)) {
      flush();
      continue;
    }

    const heading = /^(#{1,6})\s+(.+?)\s*#*$/.exec(line);
    if (heading) {
      const text = cleanInline(heading[2]).replace(/\s+/g, ' ');
      const labeled = matchFieldLine(text);
      if (labeled?.field) {
        if (!block) block = freshBlock('', inheritedCategory, inheritedScope);
        assignField(block, labeled.field, labeled.value);
        continue;
      }
      const asField = fieldKind(text);
      if (asField) {
        if (!block) block = freshBlock('', inheritedCategory, inheritedScope);
        assignField(block, asField, '');
        continue;
      }
      const category = canonicalCategory(text);
      if (category) {
        flush();
        inheritedCategory = category;
        continue;
      }
      if (isScopeHeading(text)) {
        flush();
        inheritedScope = canonicalScope(text);
        continue;
      }
      flush();
      block = freshBlock(text, inheritedCategory, inheritedScope);
      continue;
    }

    const field = matchFieldLine(line);
    if (field?.field) {
      if (!block) block = freshBlock('', inheritedCategory, inheritedScope);
      assignField(block, field.field, field.value);
      continue;
    }

    if (block?.activeField === 'answer') {
      block.body.push(line);
      continue;
    }
    if (block?.activeField === 'title' || block?.activeField === 'category' || block?.activeField === 'scope') {
      setScalar(block, block.activeField, line);
      block.sawField = true;
      block.activeField = null;
      continue;
    }
    if (block && (block.inheritedCategory || block.sawField || /\?\s*$/.test(block.title))) {
      block.body.push(line);
      block.sawField = true;
    }
  }

  flush();
  return entries;
}

export function splitImport(text, filename) {
  const source = String(text ?? '').trim();
  if (!source) {
    const error = new Error('Import text is empty');
    error.statusCode = 400;
    throw error;
  }
  const blocks = source.split(/\n(?=(?:Q:|Question:)\s)/i).map((part) => part.trim()).filter(Boolean);
  if (blocks.length <= 1 && !/^(?:Q:|Question:)\s/i.test(blocks[0] || '')) {
    return [{
      title: String(filename || 'Imported note').replace(/\.(txt|md)$/i, '').slice(0, MAX_TITLE_LENGTH),
      body: source.slice(0, MAX_BODY_LENGTH),
    }];
  }
  return blocks.slice(0, 50).map((block) => {
    const lines = block.split('\n');
    const title = lines[0].replace(/^(?:Q:|Question:)\s*/i, '').trim().slice(0, MAX_TITLE_LENGTH);
    const body = lines.slice(1).join('\n').replace(/^(?:A:|Answer:)\s*/i, '').trim().slice(0, MAX_BODY_LENGTH);
    return { title: title || 'Imported question', body: body || title };
  });
}

function looksLikeFaq(text) {
  return /(?:^|\n)\s*(?:[-*+]\s+)?(?:\*\*|__)?approved answer(?:\*\*|__)?\s*[:：]/i.test(text)
    || /(?:^|\n)#{1,6}\s+approved answer\s*$/i.test(text);
}

export function parseKnowledgeFile(text, filename = '') {
  const source = String(text ?? '').replace(/^\uFEFF/, '').trim();
  if (!source) return { kind: 'empty', entries: [], parseError: 'Import text is empty.' };
  const faqEntries = parseFaqMarkdown(source);
  if (faqEntries.length) return { kind: 'faq', entries: faqEntries, parseError: '' };
  const hasQuestions = /(?:^|\n)(?:Q:|Question:)\s/i.test(source);
  if (hasQuestions) return { kind: 'legacy', entries: splitImport(source, filename), parseError: '' };
  if (/\.md$/i.test(filename) || looksLikeFaq(source)) {
    return {
      kind: 'faq',
      entries: [],
      parseError: 'No FAQ entries were found. Each entry needs a title, an approved answer, a category, and a scope.',
    };
  }
  return { kind: 'legacy', entries: splitImport(source, filename), parseError: '' };
}

function duplicateKey(title, scope, locationId) {
  return `${scope}|${locationId || ''}|${title.trim().toLowerCase().replace(/\s+/g, ' ')}`;
}

function groupByCategory(entries) {
  const groups = new Map();
  for (const entry of entries) {
    const category = entry.category || 'Uncategorized';
    const row = groups.get(category) || { category, total: 0, valid: 0 };
    row.total += 1;
    if (entry.valid) row.valid += 1;
    groups.set(category, row);
  }
  return [...groups.values()];
}

/**
 * Validate parsed entries and flag duplicates. Does not write to the database.
 * `existing` is a list of `{ title, scope, locationId }` already stored.
 */
export function classifyFaqEntries(rawEntries, options = {}) {
  const kind = options.kind === 'legacy' ? 'legacy' : 'faq';
  const locationId = options.locationId ? String(options.locationId) : '';
  const fallbackCategory = canonicalCategory(options.fallbackCategory);
  const fallbackScope = options.fallbackScope === 'global' || options.fallbackScope === 'branch' ? options.fallbackScope : null;
  const existingKeys = new Set(
    (options.existing || []).map((row) => duplicateKey(row.title || '', row.scope, row.locationId ? String(row.locationId) : '')),
  );
  const seen = new Set();
  const entries = rawEntries.map((raw, index) => {
    const errors = [];
    if (index >= MAX_FAQ_IMPORT) errors.push('Only the first 500 entries can be imported.');

    const title = String(raw.title ?? '').trim().replace(/\s+/g, ' ');
    const body = String(raw.body ?? '').trim();
    let category = '';
    let scope = '';

    if (kind === 'legacy') {
      category = fallbackCategory || '';
      scope = fallbackScope || '';
      if (!fallbackCategory) errors.push('Category is required.');
      if (!fallbackScope) errors.push('Scope must be Global or Branch.');
    } else {
      scope = raw.scopeRecognized ? raw.scope : '';
      if (raw.categoryRecognized) category = raw.category;
      else if (fallbackCategory) category = fallbackCategory;
      else if (!raw.category) errors.push('Category is required.');
      else errors.push(`Category must match an existing category. Use one of: ${KNOWLEDGE_CATEGORIES.join(', ')}.`);
      if (!raw.scope) errors.push('Scope must be Global or Branch.');
      else if (!raw.scopeRecognized) errors.push('Scope must be Global or Branch.');
    }

    if (!title) errors.push('Title is required.');
    else if (title.length > MAX_TITLE_LENGTH) errors.push('Title must be 180 characters or fewer.');
    if (!body) errors.push('Approved answer is required.');
    else if (body.length > MAX_BODY_LENGTH) errors.push('Approved answer must be 20000 characters or fewer.');
    if (scope === 'branch' && !locationId) errors.push('Select a branch for this branch-scoped entry.');

    let duplicate = false;
    let duplicateOf = null;
    const canKey = Boolean(title) && (scope === 'global' || (scope === 'branch' && locationId));
    if (!errors.length && canKey) {
      const key = duplicateKey(title, scope, scope === 'branch' ? locationId : '');
      if (existingKeys.has(key)) {
        duplicate = true;
        duplicateOf = 'database';
      } else if (seen.has(key)) {
        duplicate = true;
        duplicateOf = 'file';
      } else {
        seen.add(key);
      }
    }

    return {
      index: index + 1,
      title,
      body,
      category: category || (kind === 'faq' ? String(raw.category || '') : ''),
      scope: scope === 'global' || scope === 'branch' ? scope : '',
      valid: errors.length === 0 && !duplicate,
      duplicate,
      duplicateOf,
      errors,
    };
  });

  return {
    kind,
    parseError: options.parseError || '',
    total: entries.length,
    valid: entries.filter((entry) => entry.valid).length,
    invalid: entries.filter((entry) => entry.errors.length > 0).length,
    duplicates: entries.filter((entry) => entry.duplicate).length,
    byCategory: groupByCategory(entries),
    entries,
  };
}
