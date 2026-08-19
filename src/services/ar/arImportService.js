import ArImportJob from '../../models/ArImportJob.js';
import Location from '../../models/Location.js';
import { AppError } from '../../utils/AppError.js';
import { assertCanManageAr, assertCanViewAr, money, parseListQuery } from './arAccess.js';
import { writeArAudit } from './arAuditService.js';
import { createInvoice } from './arInvoiceService.js';
import { recordPayment } from './arPaymentService.js';
import { createCredit } from './arCreditService.js';
import { upsertBillingProfile } from './arBillingProfileService.js';

const TEMPLATES = {
  invoices: [
    'invoiceNumber',
    'locationName',
    'invoiceDate',
    'dueDate',
    'itemName',
    'quantity',
    'unitPrice',
    'notes',
    'status',
  ],
  payments: [
    'invoiceNumber',
    'paymentDate',
    'amount',
    'paymentMethod',
    'transactionReference',
    'notes',
  ],
  partners: [
    'locationName',
    'billingEmail',
    'phone',
    'paymentTermsDays',
    'currency',
    'billingFrequency',
  ],
  credits: ['locationName', 'amount', 'type', 'reason', 'issuedDate'],
};

function parseCsv(text) {
  const lines = String(text || '')
    .replace(/^\uFEFF/, '')
    .split(/\r?\n/)
    .filter((l) => l.trim());
  if (!lines.length) return { headers: [], rows: [] };
  const split = (line) => {
    const out = [];
    let cur = '';
    let inQ = false;
    for (let i = 0; i < line.length; i += 1) {
      const ch = line[i];
      if (ch === '"') {
        if (inQ && line[i + 1] === '"') {
          cur += '"';
          i += 1;
        } else inQ = !inQ;
      } else if (ch === ',' && !inQ) {
        out.push(cur.trim());
        cur = '';
      } else cur += ch;
    }
    out.push(cur.trim());
    return out;
  };
  const headers = split(lines[0]).map((h) => h.trim());
  const rows = lines.slice(1).map((line) => {
    const cols = split(line);
    const obj = {};
    headers.forEach((h, i) => {
      obj[h] = cols[i] ?? '';
    });
    return obj;
  });
  return { headers, rows };
}

function autoMapColumns(headers, importType) {
  const expected = TEMPLATES[importType] || [];
  const mapping = {};
  for (const field of expected) {
    const hit = headers.find(
      (h) => h.toLowerCase().replace(/[\s_-]+/g, '') === field.toLowerCase().replace(/[\s_-]+/g, ''),
    );
    if (hit) mapping[field] = hit;
  }
  return mapping;
}

function mapRow(row, mapping) {
  const out = {};
  for (const [field, col] of Object.entries(mapping || {})) {
    out[field] = row[col] ?? '';
  }
  return out;
}

async function findLocationByName(name) {
  if (!name) return null;
  return Location.findOne({ name: new RegExp(`^${String(name).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') });
}

export function getImportTemplate(importType) {
  if (!TEMPLATES[importType]) throw new AppError('Unknown import type', 400);
  const headers = TEMPLATES[importType];
  return {
    importType,
    headers,
    csv: `${headers.join(',')}\n`,
  };
}

export async function listImportJobs(actor, query) {
  assertCanViewAr(actor);
  assertCanManageAr(actor);
  const { page, pageSize, skip } = parseListQuery(query);
  const [items, total] = await Promise.all([
    ArImportJob.find().sort({ createdAt: -1 }).skip(skip).limit(pageSize).lean(),
    ArImportJob.countDocuments(),
  ]);
  return {
    jobs: items.map((j) => ({
      id: String(j._id),
      importType: j.importType,
      fileName: j.fileName,
      status: j.status,
      totalRows: j.totalRows,
      successCount: j.successCount,
      errorCount: j.errorCount,
      createdAt: j.createdAt,
      completedAt: j.completedAt,
    })),
    total,
    page,
    pageSize,
  };
}

export async function createImportUpload(actor, { importType, fileName, csvText }, ipAddress = '') {
  assertCanManageAr(actor);
  if (!TEMPLATES[importType]) throw new AppError('Unknown import type', 400);
  const { headers, rows } = parseCsv(csvText);
  if (!headers.length) throw new AppError('CSV has no headers', 400);
  const columnMapping = autoMapColumns(headers, importType);
  const job = await ArImportJob.create({
    importType,
    fileName: fileName || 'upload.csv',
    status: 'uploaded',
    columnMapping,
    previewRows: rows.slice(0, 25),
    totalRows: rows.length,
    createdBy: actor.id || null,
  });
  // stash full rows on job temporarily via preview + re-parse on execute using stored mapping;
  // keep all rows in previewRows capped is bad — store as Mixed on errors field unused: use previewRows for all when small
  job.previewRows = rows.slice(0, 5000);
  await job.save();
  await writeArAudit({
    actor,
    action: 'import_uploaded',
    entityType: 'import',
    entityId: job._id,
    description: `Uploaded ${importType} import (${rows.length} rows)`,
    ipAddress,
  });
  return {
    id: String(job._id),
    importType: job.importType,
    fileName: job.fileName,
    status: job.status,
    headers,
    columnMapping: job.columnMapping,
    previewRows: rows.slice(0, 25),
    totalRows: job.totalRows,
  };
}

export async function updateImportMapping(actor, id, columnMapping) {
  assertCanManageAr(actor);
  const job = await ArImportJob.findById(id);
  if (!job) throw new AppError('Import job not found', 404);
  job.columnMapping = columnMapping || {};
  job.status = 'mapped';
  await job.save();
  return { id: String(job._id), columnMapping: job.columnMapping, status: job.status };
}

export async function validateImport(actor, id) {
  assertCanManageAr(actor);
  const job = await ArImportJob.findById(id);
  if (!job) throw new AppError('Import job not found', 404);
  const errors = [];
  const mapped = (job.previewRows || []).map((row, idx) => {
    const m = mapRow(row, job.columnMapping);
    if (job.importType === 'invoices' && !m.locationName) {
      errors.push({ row: idx + 2, message: 'locationName required' });
    }
    if (job.importType === 'payments' && (!m.amount || !m.invoiceNumber)) {
      errors.push({ row: idx + 2, message: 'invoiceNumber and amount required' });
    }
    if (job.importType === 'partners' && !m.locationName) {
      errors.push({ row: idx + 2, message: 'locationName required' });
    }
    if (job.importType === 'credits' && (!m.locationName || !m.amount)) {
      errors.push({ row: idx + 2, message: 'locationName and amount required' });
    }
    return m;
  });
  job.errorRows = errors;
  job.errorCount = errors.length;
  job.status = 'validated';
  await job.save();
  return {
    id: String(job._id),
    status: job.status,
    errorCount: errors.length,
    errors: errors.slice(0, 100),
    sampleMapped: mapped.slice(0, 5),
  };
}

export async function executeImport(actor, id, ipAddress = '') {
  assertCanManageAr(actor);
  const job = await ArImportJob.findById(id);
  if (!job) throw new AppError('Import job not found', 404);
  job.status = 'importing';
  await job.save();

  let success = 0;
  const errors = [];
  const rows = job.previewRows || [];

  for (let i = 0; i < rows.length; i += 1) {
    const m = mapRow(rows[i], job.columnMapping);
    try {
      if (job.importType === 'partners') {
        const loc = await findLocationByName(m.locationName);
        if (!loc) throw new Error(`Location not found: ${m.locationName}`);
        await upsertBillingProfile(
          actor,
          String(loc._id),
          {
            billingEmail: m.billingEmail,
            phone: m.phone,
            paymentTermsDays: Number(m.paymentTermsDays) || undefined,
            currency: m.currency || undefined,
            billingFrequency: m.billingFrequency || undefined,
          },
          ipAddress,
        );
      } else if (job.importType === 'invoices') {
        const loc = await findLocationByName(m.locationName);
        if (!loc) throw new Error(`Location not found: ${m.locationName}`);
        await createInvoice(
          actor,
          {
            locationId: String(loc._id),
            invoiceDate: m.invoiceDate || new Date(),
            dueDate: m.dueDate || new Date(),
            notes: m.notes || '',
            status: m.status === 'sent' ? 'draft' : m.status || 'draft',
            items: [
              {
                name: m.itemName || 'Imported item',
                quantity: Number(m.quantity) || 1,
                unitPrice: money(m.unitPrice),
              },
            ],
          },
          ipAddress,
        );
      } else if (job.importType === 'credits') {
        const loc = await findLocationByName(m.locationName);
        if (!loc) throw new Error(`Location not found: ${m.locationName}`);
        await createCredit(
          actor,
          {
            locationId: String(loc._id),
            amount: money(m.amount),
            type: m.type || 'credit_note',
            reason: m.reason || 'Imported credit',
            issuedDate: m.issuedDate || new Date(),
          },
          ipAddress,
        );
      } else if (job.importType === 'payments') {
        const ArInvoice = (await import('../../models/ArInvoice.js')).default;
        const inv = await ArInvoice.findOne({ invoiceNumber: m.invoiceNumber, isDeleted: { $ne: true } });
        if (!inv) throw new Error(`Invoice not found: ${m.invoiceNumber}`);
        await recordPayment(
          actor,
          {
            invoiceId: String(inv._id),
            amount: money(m.amount),
            paymentDate: m.paymentDate || new Date(),
            paymentMethod: m.paymentMethod || 'zelle',
            transactionReference: m.transactionReference || '',
            notes: m.notes || '',
          },
          ipAddress,
        );
      }
      success += 1;
    } catch (e) {
      errors.push({ row: i + 2, message: e.message || 'Import failed' });
    }
  }

  job.successCount = success;
  job.errorCount = errors.length;
  job.errorRows = errors;
  job.status = errors.length && !success ? 'failed' : 'completed';
  job.completedAt = new Date();
  await job.save();
  await writeArAudit({
    actor,
    action: 'import_completed',
    entityType: 'import',
    entityId: job._id,
    description: `Import ${job.importType}: ${success} success, ${errors.length} errors`,
    ipAddress,
    newValue: { success, errors: errors.length },
  });
  return {
    id: String(job._id),
    status: job.status,
    successCount: success,
    errorCount: errors.length,
    errors: errors.slice(0, 200),
  };
}

export async function getImportJob(actor, id) {
  assertCanManageAr(actor);
  const job = await ArImportJob.findById(id).lean();
  if (!job) throw new AppError('Import job not found', 404);
  return {
    id: String(job._id),
    importType: job.importType,
    fileName: job.fileName,
    status: job.status,
    columnMapping: job.columnMapping,
    previewRows: (job.previewRows || []).slice(0, 25),
    totalRows: job.totalRows,
    successCount: job.successCount,
    errorCount: job.errorCount,
    errors: (job.errorRows || []).slice(0, 200),
    createdAt: job.createdAt,
    completedAt: job.completedAt,
  };
}
