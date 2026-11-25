import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  classifyFaqEntries,
  parseFaqMarkdown,
  parseKnowledgeFile,
} from '../src/services/faqMarkdown.js';

const GLOBAL_FILE = `# Moka & Co. Global FAQs

## Company information

### What is Moka & Co.?

**Approved answer:** Moka & Co. is a neighborhood coffee and bakery company.

**Category:** Company information

**Scope:** Global

---

### Where is the company based?

**Approved answer:** The company is based in New York.

**Scope:** Global

## Opening hours

### What are standard hours?

**Approved answer:** Most cafes open at 7:00 and close at 18:00.
Confirm the branch entry for local hours.

**Category:** Opening hours
**Scope:** Global
`;

const BRANCH_FILE = `# Midtown branch FAQs

## Opening hours

### When does Midtown open?

**Title:** When does Midtown open?
**Approved answer:** Midtown opens at 7:00 and closes at 19:00 on weekdays.
**Category:** Opening hours
**Scope:** Branch
`;

const COMBINED_FILE = `## Company information

### Who do I call for catering?

**Approved answer:** Call the main line for catering.
**Category:** Company information
**Scope:** Global

---

## Opening hours

### What time does this branch close on Sunday?

**Approved answer:** This branch is closed on Sunday.
**Category:** Opening hours
**Scope:** Branch
`;

describe('parseFaqMarkdown', () => {
  it('creates one record shape per global FAQ and does not keep the file as one entry', () => {
    const entries = parseFaqMarkdown(GLOBAL_FILE);
    assert.equal(entries.length, 3);
    assert.equal(entries[0].title, 'What is Moka & Co.?');
    assert.equal(entries[0].body, 'Moka & Co. is a neighborhood coffee and bakery company.');
    assert.equal(entries[0].category, 'Company information');
    assert.equal(entries[0].scope, 'global');
    assert.equal(entries[1].title, 'Where is the company based?');
    assert.equal(entries[1].category, 'Company information');
    assert.equal(entries[1].scope, 'global');
    assert.equal(entries[2].title, 'What are standard hours?');
    assert.match(entries[2].body, /Most cafes open at 7:00/);
    assert.match(entries[2].body, /branch entry/);
    assert.equal(entries[2].category, 'Opening hours');
  });

  it('parses a branch file from each entry scope', () => {
    const entries = parseFaqMarkdown(BRANCH_FILE);
    assert.equal(entries.length, 1);
    assert.equal(entries[0].scope, 'branch');
    assert.equal(entries[0].category, 'Opening hours');
    assert.equal(entries[0].title, 'When does Midtown open?');
  });

  it('keeps mixed scopes in one file', () => {
    const entries = parseFaqMarkdown(COMBINED_FILE);
    assert.deepEqual(entries.map((entry) => entry.scope), ['global', 'branch']);
  });

  it('reads field headings and scope headings', () => {
    const entries = parseFaqMarkdown(`# Global

## Company information

## Who owns the company?

### Approved answer
The founders.

### Scope
Global
`);
    assert.equal(entries.length, 1);
    assert.equal(entries[0].title, 'Who owns the company?');
    assert.equal(entries[0].body, 'The founders.');
    assert.equal(entries[0].category, 'Company information');
    assert.equal(entries[0].scope, 'global');
  });

  it('uses the paragraph under an entry heading when the category heading supplies the category', () => {
    const entries = parseFaqMarkdown(`## Menu prices

### Latte
A latte is $4.50.
Last price change was in May.

**Scope:** Global
`);
    assert.equal(entries.length, 1);
    assert.equal(entries[0].title, 'Latte');
    assert.equal(entries[0].category, 'Menu prices');
    assert.equal(entries[0].scope, 'global');
    assert.match(entries[0].body, /A latte is \$4\.50/);
    assert.match(entries[0].body, /May/);
  });

  it('keeps an entry that is missing its approved answer', () => {
    const entries = parseFaqMarkdown(`### What is the wifi password?

**Category:** General FAQs
**Scope:** Global
`);
    assert.equal(entries.length, 1);
    assert.equal(entries[0].body, '');
    assert.equal(entries[0].category, 'General FAQs');
  });
});

describe('classifyFaqEntries', () => {
  it('reports invalid category, missing scope, and a branch that still needs a location', () => {
    const parsed = parseFaqMarkdown(`**Title:** Latte price
**Approved answer:** A latte is 4.50.
**Category:** Not a real category
**Scope:** Local

---

**Title:** Sunday hours
**Approved answer:** Closed on Sunday.
**Category:** Opening hours
**Scope:** Branch
`);
    const report = classifyFaqEntries(parsed, { kind: 'faq', locationId: '' });
    assert.equal(report.total, 2);
    assert.equal(report.valid, 0);
    assert.equal(report.invalid, 2);
    assert.ok(report.entries[0].errors.some((error) => error.startsWith('Category must match an existing category.')));
    assert.ok(report.entries[0].errors.includes('Scope must be Global or Branch.'));
    assert.ok(report.entries[1].errors.includes('Select a branch for this branch-scoped entry.'));
  });

  it('uses the selected category for every entry whose category is not recognized', () => {
    const parsed = parseFaqMarkdown(`**Title:** Latte price
**Approved answer:** A latte is 4.50.
**Category:** Prices
**Scope:** Global

---

**Title:** Sunday hours
**Approved answer:** Closed on Sunday.
**Category:** Something else
**Scope:** Global
`);
    const report = classifyFaqEntries(parsed, { kind: 'faq', fallbackCategory: 'Menu prices' });
    assert.equal(report.valid, 2);
    assert.equal(report.entries[0].category, 'Menu prices');
    assert.equal(report.entries[1].category, 'Menu prices');
  });

  it('maps a common category name onto an existing category', () => {
    const parsed = parseFaqMarkdown(`**Title:** Hours
**Approved answer:** Open at 7:00.
**Category:** Hours
**Scope:** Global
`);
    const report = classifyFaqEntries(parsed, { kind: 'faq' });
    assert.equal(report.entries[0].category, 'Opening hours');
    assert.equal(report.entries[0].valid, true);
  });

  it('accepts a branch entry once a branch is selected and skips duplicates', () => {
    const parsed = parseFaqMarkdown(BRANCH_FILE + `
---

**Title:** When does Midtown open?
**Approved answer:** Another copy.
**Category:** Opening hours
**Scope:** Branch
`);
    const report = classifyFaqEntries(parsed, {
      kind: 'faq',
      locationId: '507f1f77bcf86cd799439011',
      existing: [{ title: 'When does Midtown open?', scope: 'branch', locationId: '507f1f77bcf86cd799439011' }],
    });
    assert.equal(report.entries.length, 2);
    assert.equal(report.entries[0].duplicateOf, 'database');
    assert.equal(report.entries[0].valid, false);
    assert.equal(report.entries[1].duplicateOf, 'database');
    assert.equal(report.byCategory[0].category, 'Opening hours');
  });

  it('does not treat a global title as a duplicate of a branch title', () => {
    const parsed = parseFaqMarkdown(`**Title:** Hours
**Approved answer:** Open at 7:00.
**Category:** Opening hours
**Scope:** Global
`);
    const report = classifyFaqEntries(parsed, {
      kind: 'faq',
      existing: [{ title: 'Hours', scope: 'branch', locationId: '507f1f77bcf86cd799439011' }],
    });
    assert.equal(report.valid, 1);
    assert.equal(report.duplicates, 0);
  });

  it('flags the second copy inside the file', () => {
    const parsed = parseFaqMarkdown(`**Title:** Hours
**Approved answer:** Open at 7:00.
**Category:** Opening hours
**Scope:** Global

---

**Title:** hours
**Approved answer:** Open at 7:00.
**Category:** Opening hours
**Scope:** Global
`);
    const report = classifyFaqEntries(parsed, { kind: 'faq' });
    assert.equal(report.entries[0].valid, true);
    assert.equal(report.entries[1].duplicateOf, 'file');
    assert.equal(report.valid, 1);
  });
});

describe('parseKnowledgeFile', () => {
  it('refuses to import an unstructured markdown file as one entry', () => {
    const parsed = parseKnowledgeFile('# Notes\n\nWe open at 7.\n', 'notes.md');
    assert.equal(parsed.kind, 'faq');
    assert.equal(parsed.entries.length, 0);
    assert.match(parsed.parseError, /No FAQ entries/);
  });

  it('still splits plain-text question blocks', () => {
    const parsed = parseKnowledgeFile('Q: Hours?\nA: 7 to 6\n\nQ: Wifi?\nA: No public wifi.\n', 'notes.txt');
    assert.equal(parsed.kind, 'legacy');
    assert.equal(parsed.entries.length, 2);
    assert.equal(parsed.entries[0].title, 'Hours?');
    assert.equal(parsed.entries[1].body, 'No public wifi.');
  });

  it('keeps a plain note as one legacy entry', () => {
    const parsed = parseKnowledgeFile('Open from 7 to 6.', 'hours.txt');
    assert.equal(parsed.kind, 'legacy');
    assert.equal(parsed.entries.length, 1);
    assert.equal(parsed.entries[0].title, 'hours');
  });
});
