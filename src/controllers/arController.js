import { asyncHandler } from '../utils/asyncHandler.js';
import * as settingsService from '../services/ar/arSettingsService.js';
import * as productService from '../services/ar/arProductService.js';
import * as billingService from '../services/ar/arBillingProfileService.js';
import * as invoiceService from '../services/ar/arInvoiceService.js';
import * as paymentService from '../services/ar/arPaymentService.js';
import * as creditService from '../services/ar/arCreditService.js';
import * as recurringService from '../services/ar/arRecurringService.js';
import * as statementService from '../services/ar/arStatementService.js';
import * as dashboardService from '../services/ar/arDashboardService.js';
import * as auditService from '../services/ar/arAuditService.js';
import * as scheduler from '../services/ar/arScheduler.js';
import * as importService from '../services/ar/arImportService.js';
import * as reportService from '../services/ar/arReportService.js';
import * as invoiceTemplateService from '../services/ar/arInvoiceTemplateService.js';
import ArJobRun from '../models/ArJobRun.js';
import { assertCanManageAr } from '../services/ar/arAccess.js';

function actor(req) {
  return req.user;
}

function ip(req) {
  return req.headers['x-forwarded-for']?.toString().split(',')[0]?.trim() || req.ip || '';
}

export const getDashboard = asyncHandler(async (req, res) => {
  const data = await dashboardService.getArDashboard(actor(req), req.query);
  res.json(data);
});

export const getSettings = asyncHandler(async (req, res) => {
  res.json(await settingsService.getSettings(actor(req)));
});

export const updateSettings = asyncHandler(async (req, res) => {
  res.json(await settingsService.updateSettings(actor(req), req.body, ip(req)));
});

export const listInvoiceTemplates = asyncHandler(async (req, res) => {
  res.json(await invoiceTemplateService.listTemplates(actor(req)));
});

export const getInvoiceTemplate = asyncHandler(async (req, res) => {
  res.json(await invoiceTemplateService.getTemplate(actor(req), req.params.id));
});

export const createInvoiceTemplate = asyncHandler(async (req, res) => {
  res.status(201).json(await invoiceTemplateService.createTemplate(actor(req), req.body, ip(req)));
});

export const updateInvoiceTemplate = asyncHandler(async (req, res) => {
  res.json(await invoiceTemplateService.updateTemplate(actor(req), req.params.id, req.body, ip(req)));
});

export const deleteInvoiceTemplate = asyncHandler(async (req, res) => {
  res.json(await invoiceTemplateService.deleteTemplate(actor(req), req.params.id, ip(req)));
});

export const getInvoiceTemplatePalette = asyncHandler(async (_req, res) => {
  res.json({
    blocks: invoiceTemplateService.buildDefaultBlocks(),
    blockTypes: [
      { type: 'company_header', label: 'Company header' },
      { type: 'invoice_meta', label: 'Invoice number & dates' },
      { type: 'bill_to', label: 'Bill to' },
      { type: 'line_items', label: 'Line items' },
      { type: 'totals', label: 'Totals' },
      { type: 'notes', label: 'Invoice notes' },
      { type: 'payment_instructions', label: 'Payment instructions' },
      { type: 'terms', label: 'Terms & conditions' },
      { type: 'custom_text', label: 'Custom text' },
      { type: 'spacer', label: 'Spacer' },
    ],
  });
});

export const listProducts = asyncHandler(async (req, res) => {
  res.json(await productService.listProducts(actor(req), req.query));
});

export const getProduct = asyncHandler(async (req, res) => {
  res.json(await productService.getProduct(actor(req), req.params.id));
});

export const createProduct = asyncHandler(async (req, res) => {
  res.status(201).json(await productService.createProduct(actor(req), req.body, ip(req)));
});

export const updateProduct = asyncHandler(async (req, res) => {
  res.json(await productService.updateProduct(actor(req), req.params.id, req.body, ip(req)));
});

export const archiveProduct = asyncHandler(async (req, res) => {
  res.json(await productService.archiveProduct(actor(req), req.params.id, ip(req)));
});

export const deleteProduct = asyncHandler(async (req, res) => {
  res.json(await productService.deleteProduct(actor(req), req.params.id, ip(req)));
});

export const listBillingProfiles = asyncHandler(async (req, res) => {
  res.json(await billingService.listBillingProfiles(actor(req), req.query));
});

export const getBillingProfile = asyncHandler(async (req, res) => {
  res.json(await billingService.getBillingProfileByLocation(actor(req), req.params.locationId));
});

export const upsertBillingProfile = asyncHandler(async (req, res) => {
  res.json(
    await billingService.upsertBillingProfile(
      actor(req),
      req.params.locationId,
      req.body,
      ip(req),
    ),
  );
});

export const listInvoices = asyncHandler(async (req, res) => {
  res.json(await invoiceService.listInvoices(actor(req), req.query));
});

export const getInvoice = asyncHandler(async (req, res) => {
  res.json(await invoiceService.getInvoice(actor(req), req.params.id));
});

export const createInvoice = asyncHandler(async (req, res) => {
  res.status(201).json(await invoiceService.createInvoice(actor(req), req.body, ip(req)));
});

export const updateInvoice = asyncHandler(async (req, res) => {
  res.json(await invoiceService.updateInvoice(actor(req), req.params.id, req.body, ip(req)));
});

export const approveInvoice = asyncHandler(async (req, res) => {
  res.json(await invoiceService.approveInvoice(actor(req), req.params.id, ip(req)));
});

export const sendInvoice = asyncHandler(async (req, res) => {
  res.json(await invoiceService.sendInvoice(actor(req), req.params.id, ip(req)));
});

export const viewInvoice = asyncHandler(async (req, res) => {
  res.json(await invoiceService.markInvoiceViewed(actor(req), req.params.id));
});

export const duplicateInvoice = asyncHandler(async (req, res) => {
  res.status(201).json(await invoiceService.duplicateInvoice(actor(req), req.params.id, ip(req)));
});

export const cancelInvoice = asyncHandler(async (req, res) => {
  res.json(await invoiceService.cancelInvoice(actor(req), req.params.id, ip(req)));
});

export const voidInvoice = asyncHandler(async (req, res) => {
  res.json(await invoiceService.voidInvoice(actor(req), req.params.id, ip(req)));
});

export const deleteInvoice = asyncHandler(async (req, res) => {
  res.json(await invoiceService.deleteInvoice(actor(req), req.params.id, ip(req)));
});

export const downloadInvoicePdf = asyncHandler(async (req, res) => {
  const { buffer, filename } = await invoiceService.getInvoicePdf(actor(req), req.params.id);
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send(buffer);
});

export const listPayments = asyncHandler(async (req, res) => {
  res.json(await paymentService.listPayments(actor(req), req.query));
});

export const recordPayment = asyncHandler(async (req, res) => {
  res.status(201).json(await paymentService.recordPayment(actor(req), req.body, ip(req)));
});

export const deletePayment = asyncHandler(async (req, res) => {
  res.json(await paymentService.deletePayment(actor(req), req.params.id, ip(req)));
});

export const listCredits = asyncHandler(async (req, res) => {
  res.json(await creditService.listCredits(actor(req), req.query));
});

export const createCredit = asyncHandler(async (req, res) => {
  res.status(201).json(await creditService.createCredit(actor(req), req.body, ip(req)));
});

export const applyCredit = asyncHandler(async (req, res) => {
  res.json(
    await creditService.applyCreditToInvoice(
      actor(req),
      req.params.id,
      req.body.invoiceId,
      req.body.amount,
      ip(req),
    ),
  );
});

export const listRecurring = asyncHandler(async (req, res) => {
  res.json(await recurringService.listRecurring(actor(req), req.query));
});

export const createRecurring = asyncHandler(async (req, res) => {
  res.status(201).json(await recurringService.createRecurring(actor(req), req.body, ip(req)));
});

export const updateRecurring = asyncHandler(async (req, res) => {
  res.json(await recurringService.updateRecurring(actor(req), req.params.id, req.body, ip(req)));
});

export const deleteRecurring = asyncHandler(async (req, res) => {
  res.json(await recurringService.deleteRecurring(actor(req), req.params.id, ip(req)));
});

export const runRecurringNow = asyncHandler(async (req, res) => {
  const ArRecurringTemplate = (await import('../models/ArRecurringTemplate.js')).default;
  const tpl = await ArRecurringTemplate.findById(req.params.id);
  if (!tpl) {
    res.status(404).json({ success: false, message: 'Template not found' });
    return;
  }
  const invoice = await recurringService.generateFromTemplate(tpl, actor(req));
  res.status(201).json({ invoiceId: String(invoice._id), invoiceNumber: invoice.invoiceNumber });
});

export const listStatements = asyncHandler(async (req, res) => {
  res.json(await statementService.listStatements(actor(req), req.query));
});

export const generateStatement = asyncHandler(async (req, res) => {
  res.status(201).json(await statementService.generateStatement(actor(req), req.body, ip(req)));
});

export const emailStatement = asyncHandler(async (req, res) => {
  res.json(await statementService.emailStatement(actor(req), req.params.id, ip(req)));
});

export const listAuditLogs = asyncHandler(async (req, res) => {
  res.json(await auditService.listArAuditLogs(req.query));
});

export const listJobRuns = asyncHandler(async (req, res) => {
  const page = Math.max(1, Number(req.query.page) || 1);
  const pageSize = Math.min(50, Math.max(1, Number(req.query.pageSize) || 20));
  const [items, total] = await Promise.all([
    ArJobRun.find().sort({ createdAt: -1 }).skip((page - 1) * pageSize).limit(pageSize).lean(),
    ArJobRun.countDocuments(),
  ]);
  res.json({
    jobs: items.map((j) => ({
      id: String(j._id),
      jobName: j.jobName,
      status: j.status,
      startedAt: j.startedAt,
      finishedAt: j.finishedAt,
      processedCount: j.processedCount,
      successCount: j.successCount,
      failureCount: j.failureCount,
      details: j.details,
      errorMessage: j.errorMessage,
    })),
    total,
    page,
    pageSize,
  });
});

export const runJobManually = asyncHandler(async (req, res) => {
  assertCanManageAr(actor(req));
  const name = req.params.jobName;
  let result;
  if (name === 'daily_invoice_generation') result = await scheduler.runDailyInvoiceGeneration();
  else if (name === 'reminder_scheduler') result = await scheduler.runReminderScheduler();
  else if (name === 'late_fee_scheduler') result = await scheduler.runLateFeeScheduler();
  else if (name === 'monthly_statement_generator') {
    result = await scheduler.runMonthlyStatementGenerator();
  } else if (name === 'overdue_status_sync') {
    const sync = await scheduler.runOverdueStatusSync();
    res.json({ job: { status: 'success', details: `Modified ${sync.modified} invoices` } });
    return;
  } else {
    res.status(400).json({ success: false, message: 'Unknown job' });
    return;
  }
  res.json({ job: { id: String(result._id), status: result.status, details: result.details } });
});

export const getReport = asyncHandler(async (req, res) => {
  const data = await reportService.runReport(actor(req), req.params.reportType, req.query);
  if (data.format === 'csv') {
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="${data.filename}"`);
    res.send(data.content);
    return;
  }
  res.json(data);
});

export const listImportJobs = asyncHandler(async (req, res) => {
  res.json(await importService.listImportJobs(actor(req), req.query));
});

export const getImportTemplate = asyncHandler(async (req, res) => {
  const tpl = importService.getImportTemplate(req.params.importType);
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader(
    'Content-Disposition',
    `attachment; filename="ar-${req.params.importType}-template.csv"`,
  );
  res.send(tpl.csv);
});

export const createImportJob = asyncHandler(async (req, res) => {
  res.status(201).json(await importService.createImportUpload(actor(req), req.body, ip(req)));
});

export const getImportJob = asyncHandler(async (req, res) => {
  res.json(await importService.getImportJob(actor(req), req.params.id));
});

export const updateImportMapping = asyncHandler(async (req, res) => {
  res.json(await importService.updateImportMapping(actor(req), req.params.id, req.body.columnMapping));
});

export const validateImportJob = asyncHandler(async (req, res) => {
  res.json(await importService.validateImport(actor(req), req.params.id));
});

export const executeImportJob = asyncHandler(async (req, res) => {
  res.json(await importService.executeImport(actor(req), req.params.id, ip(req)));
});
