import { Router } from 'express';
import { authMiddleware } from '../middleware/authMiddleware.js';
import { roleMiddleware } from '../middleware/roleMiddleware.js';
import * as ar from '../controllers/arController.js';

const router = Router();

router.use(authMiddleware);
router.use(roleMiddleware(['admin', 'support', 'partner']));

/**
 * @swagger
 * tags:
 *   - name: AR Dashboard
 *     description: Accounts Receivable KPIs and charts
 *   - name: AR Settings
 *     description: Global AR configuration
 *   - name: AR Products
 *     description: Billable products and services
 *   - name: AR Billing Profiles
 *     description: Partner billing profiles
 *   - name: AR Invoices
 *     description: Invoice lifecycle
 *   - name: AR Payments
 *     description: Manual payment recording (Zelle)
 *   - name: AR Credits
 *     description: Credit notes, discounts, refunds, write-offs
 *   - name: AR Recurring
 *     description: Recurring billing templates
 *   - name: AR Statements
 *     description: Partner statements
 *   - name: AR Reports
 *     description: AR reports and exports
 *   - name: AR Imports
 *     description: CSV import wizard
 *   - name: AR Audit
 *     description: AR audit logs and job runs
 */

/**
 * @swagger
 * /api/ar/dashboard:
 *   get:
 *     tags: [AR Dashboard]
 *     summary: AR dashboard KPIs and charts
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: locationId
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Dashboard payload with kpis and charts
 *       401:
 *         description: Unauthorized
 */
router.get('/dashboard', ar.getDashboard);

/**
 * @swagger
 * /api/ar/settings:
 *   get:
 *     tags: [AR Settings]
 *     summary: Get global AR settings
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Settings object
 *   put:
 *     tags: [AR Settings]
 *     summary: Update global AR settings (admin)
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             example:
 *               invoiceNumberPrefix: INV
 *               defaultCurrency: USD
 *               defaultPaymentTermsDays: 15
 *               gracePeriodDays: 3
 *     responses:
 *       200:
 *         description: Updated settings
 *       403:
 *         description: Forbidden
 */
router.get('/settings', ar.getSettings);
router.put('/settings', roleMiddleware(['admin']), ar.updateSettings);

/**
 * @swagger
 * /api/ar/invoice-templates:
 *   get:
 *     tags: [AR Settings]
 *     summary: List invoice PDF layout templates
 *   post:
 *     tags: [AR Settings]
 *     summary: Create invoice layout template (admin)
 */
router.get('/invoice-templates', ar.listInvoiceTemplates);
router.get('/invoice-templates/palette', ar.getInvoiceTemplatePalette);
router.post('/invoice-templates', roleMiddleware(['admin']), ar.createInvoiceTemplate);
router.get('/invoice-templates/:id', ar.getInvoiceTemplate);
router.put('/invoice-templates/:id', roleMiddleware(['admin']), ar.updateInvoiceTemplate);
router.delete('/invoice-templates/:id', roleMiddleware(['admin']), ar.deleteInvoiceTemplate);

/**
 * @swagger
 * /api/ar/products:
 *   get:
 *     tags: [AR Products]
 *     summary: List products and services
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: search
 *         schema: { type: string }
 *       - in: query
 *         name: page
 *         schema: { type: integer, default: 1 }
 *       - in: query
 *         name: pageSize
 *         schema: { type: integer, default: 20 }
 *       - in: query
 *         name: active
 *         schema: { type: string, enum: [true, false] }
 *     responses:
 *       200:
 *         description: Paginated product list
 *   post:
 *     tags: [AR Products]
 *     summary: Create product (admin)
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [name, price]
 *             properties:
 *               name: { type: string, example: Monthly Platform Fee }
 *               description: { type: string }
 *               category: { type: string }
 *               price: { type: number, example: 299 }
 *               taxable: { type: boolean }
 *               taxPercentage: { type: number }
 *               accountingCategory: { type: string }
 *               active: { type: boolean }
 *     responses:
 *       201:
 *         description: Created
 */
router.get('/products', ar.listProducts);
router.post('/products', roleMiddleware(['admin']), ar.createProduct);

/**
 * @swagger
 * /api/ar/products/{id}:
 *   get:
 *     tags: [AR Products]
 *     summary: Get product by id
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Product
 *   put:
 *     tags: [AR Products]
 *     summary: Update product
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     requestBody:
 *       content:
 *         application/json:
 *           schema: { type: object }
 *     responses:
 *       200:
 *         description: Updated
 *   delete:
 *     tags: [AR Products]
 *     summary: Soft-delete product
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Deleted
 */
router.get('/products/:id', ar.getProduct);
router.put('/products/:id', roleMiddleware(['admin']), ar.updateProduct);
router.delete('/products/:id', roleMiddleware(['admin']), ar.deleteProduct);

/**
 * @swagger
 * /api/ar/products/{id}/archive:
 *   post:
 *     tags: [AR Products]
 *     summary: Archive (deactivate) product
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Archived
 */
router.post('/products/:id/archive', roleMiddleware(['admin']), ar.archiveProduct);

/**
 * @swagger
 * /api/ar/billing-profiles:
 *   get:
 *     tags: [AR Billing Profiles]
 *     summary: List partner billing profiles
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: search
 *         schema: { type: string }
 *       - in: query
 *         name: page
 *         schema: { type: integer }
 *     responses:
 *       200:
 *         description: Profile list
 */
router.get('/billing-profiles', ar.listBillingProfiles);

/**
 * @swagger
 * /api/ar/billing-profiles/{locationId}:
 *   get:
 *     tags: [AR Billing Profiles]
 *     summary: Get billing profile for a location
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: locationId
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Profile (defaults if none saved)
 *   put:
 *     tags: [AR Billing Profiles]
 *     summary: Upsert billing profile (admin)
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: locationId
 *         required: true
 *         schema: { type: string }
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             example:
 *               billingEmail: billing@partner.example
 *               paymentTermsDays: 15
 *               autoGenerateInvoice: true
 *               autoSendInvoice: true
 *               lateFeeEnabled: true
 *     responses:
 *       200:
 *         description: Saved profile
 */
router.get('/billing-profiles/:locationId', ar.getBillingProfile);
router.put('/billing-profiles/:locationId', roleMiddleware(['admin']), ar.upsertBillingProfile);

/**
 * @swagger
 * /api/ar/invoices:
 *   get:
 *     tags: [AR Invoices]
 *     summary: List invoices
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: search
 *         schema: { type: string }
 *       - in: query
 *         name: status
 *         schema: { type: string }
 *       - in: query
 *         name: locationId
 *         schema: { type: string }
 *       - in: query
 *         name: page
 *         schema: { type: integer }
 *       - in: query
 *         name: pageSize
 *         schema: { type: integer }
 *       - in: query
 *         name: sort
 *         schema: { type: string }
 *       - in: query
 *         name: order
 *         schema: { type: string, enum: [asc, desc] }
 *     responses:
 *       200:
 *         description: Paginated invoices
 *   post:
 *     tags: [AR Invoices]
 *     summary: Create invoice (admin)
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [locationId, items]
 *             properties:
 *               locationId: { type: string }
 *               invoiceDate: { type: string, format: date }
 *               dueDate: { type: string, format: date }
 *               notes: { type: string }
 *               items:
 *                 type: array
 *                 items:
 *                   type: object
 *                   properties:
 *                     name: { type: string }
 *                     quantity: { type: number }
 *                     unitPrice: { type: number }
 *                     taxable: { type: boolean }
 *                     taxPercentage: { type: number }
 *           example:
 *             locationId: "507f1f77bcf86cd799439011"
 *             items:
 *               - name: Monthly Fee
 *                 quantity: 1
 *                 unitPrice: 299
 *     responses:
 *       201:
 *         description: Created invoice
 */
router.get('/invoices', ar.listInvoices);
router.post('/invoices', roleMiddleware(['admin']), ar.createInvoice);

/**
 * @swagger
 * /api/ar/invoices/{id}:
 *   get:
 *     tags: [AR Invoices]
 *     summary: Get invoice detail (includes timeline)
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Invoice
 *   put:
 *     tags: [AR Invoices]
 *     summary: Update draft invoice
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     requestBody:
 *       content:
 *         application/json:
 *           schema: { type: object }
 *     responses:
 *       200:
 *         description: Updated
 *   delete:
 *     tags: [AR Invoices]
 *     summary: Soft-delete invoice
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Deleted
 */
router.get('/invoices/:id', ar.getInvoice);
router.put('/invoices/:id', roleMiddleware(['admin']), ar.updateInvoice);
router.delete('/invoices/:id', roleMiddleware(['admin']), ar.deleteInvoice);

/**
 * @swagger
 * /api/ar/invoices/{id}/approve:
 *   post:
 *     tags: [AR Invoices]
 *     summary: Approve invoice
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Approved
 */
router.post('/invoices/:id/approve', roleMiddleware(['admin']), ar.approveInvoice);

/**
 * @swagger
 * /api/ar/invoices/{id}/send:
 *   post:
 *     tags: [AR Invoices]
 *     summary: Send invoice email (+ PDF)
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Sent
 */
router.post('/invoices/:id/send', roleMiddleware(['admin']), ar.sendInvoice);

/**
 * @swagger
 * /api/ar/invoices/{id}/view:
 *   post:
 *     tags: [AR Invoices]
 *     summary: Mark invoice as viewed
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Viewed
 */
router.post('/invoices/:id/view', ar.viewInvoice);

/**
 * @swagger
 * /api/ar/invoices/{id}/duplicate:
 *   post:
 *     tags: [AR Invoices]
 *     summary: Duplicate invoice as draft
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       201:
 *         description: Duplicated
 */
router.post('/invoices/:id/duplicate', roleMiddleware(['admin']), ar.duplicateInvoice);

/**
 * @swagger
 * /api/ar/invoices/{id}/cancel:
 *   post:
 *     tags: [AR Invoices]
 *     summary: Cancel invoice
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Cancelled
 */
router.post('/invoices/:id/cancel', roleMiddleware(['admin']), ar.cancelInvoice);

/**
 * @swagger
 * /api/ar/invoices/{id}/void:
 *   post:
 *     tags: [AR Invoices]
 *     summary: Void invoice
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Voided
 */
router.post('/invoices/:id/void', roleMiddleware(['admin']), ar.voidInvoice);

/**
 * @swagger
 * /api/ar/invoices/{id}/pdf:
 *   get:
 *     tags: [AR Invoices]
 *     summary: Download invoice PDF
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: PDF binary
 *         content:
 *           application/pdf:
 *             schema:
 *               type: string
 *               format: binary
 */
router.get('/invoices/:id/pdf', ar.downloadInvoicePdf);

/**
 * @swagger
 * /api/ar/payments:
 *   get:
 *     tags: [AR Payments]
 *     summary: List payments
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: locationId
 *         schema: { type: string }
 *       - in: query
 *         name: invoiceId
 *         schema: { type: string }
 *       - in: query
 *         name: page
 *         schema: { type: integer }
 *     responses:
 *       200:
 *         description: Payments list
 *   post:
 *     tags: [AR Payments]
 *     summary: Record payment (admin, typically Zelle)
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [invoiceId, amount]
 *             properties:
 *               invoiceId: { type: string }
 *               amount: { type: number, example: 150 }
 *               paymentDate: { type: string, format: date }
 *               paymentMethod: { type: string, example: zelle }
 *               transactionReference: { type: string }
 *               notes: { type: string }
 *     responses:
 *       201:
 *         description: Payment recorded
 */
router.get('/payments', ar.listPayments);
router.post('/payments', roleMiddleware(['admin']), ar.recordPayment);

/**
 * @swagger
 * /api/ar/payments/{id}:
 *   delete:
 *     tags: [AR Payments]
 *     summary: Soft-delete payment and refresh invoice balance
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Deleted
 */
router.delete('/payments/:id', roleMiddleware(['admin']), ar.deletePayment);

// Partner self-reports "I sent payment" (pending admin verification) — access
// scoping enforced in the service via getInvoice(). Admin lists/reviews the queue.
router.post('/invoices/:id/payment-submissions', ar.submitInvoicePayment);
router.get('/payment-submissions', roleMiddleware(['admin', 'support']), ar.listPaymentSubmissions);
router.post(
  '/payment-submissions/:id/review',
  roleMiddleware(['admin']),
  ar.reviewPaymentSubmission,
);

/**
 * @swagger
 * /api/ar/credits:
 *   get:
 *     tags: [AR Credits]
 *     summary: List credits
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Credits list
 *   post:
 *     tags: [AR Credits]
 *     summary: Issue credit (admin)
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [locationId, amount]
 *             properties:
 *               locationId: { type: string }
 *               amount: { type: number }
 *               type: { type: string, enum: [credit_note, discount, refund, write_off] }
 *               reason: { type: string }
 *     responses:
 *       201:
 *         description: Credit created
 */
router.get('/credits', ar.listCredits);
router.post('/credits', roleMiddleware(['admin']), ar.createCredit);

/**
 * @swagger
 * /api/ar/credits/{id}/apply:
 *   post:
 *     tags: [AR Credits]
 *     summary: Apply credit to an invoice
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [invoiceId]
 *             properties:
 *               invoiceId: { type: string }
 *               amount: { type: number }
 *     responses:
 *       200:
 *         description: Applied
 */
router.post('/credits/:id/apply', roleMiddleware(['admin']), ar.applyCredit);

/**
 * @swagger
 * /api/ar/recurring:
 *   get:
 *     tags: [AR Recurring]
 *     summary: List recurring templates
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Templates
 *   post:
 *     tags: [AR Recurring]
 *     summary: Create recurring template
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [name, locationId, frequency, items]
 *             properties:
 *               name: { type: string }
 *               locationId: { type: string }
 *               frequency: { type: string, enum: [weekly, biweekly, monthly, quarterly, semi_annual, annual, custom] }
 *               startDate: { type: string, format: date }
 *               autoGenerate: { type: boolean }
 *               autoSend: { type: boolean }
 *               dueAfterDays: { type: integer }
 *               items:
 *                 type: array
 *                 items: { type: object }
 *     responses:
 *       201:
 *         description: Created
 */
router.get('/recurring', ar.listRecurring);
router.post('/recurring', roleMiddleware(['admin']), ar.createRecurring);

/**
 * @swagger
 * /api/ar/recurring/{id}:
 *   put:
 *     tags: [AR Recurring]
 *     summary: Update recurring template
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     requestBody:
 *       content:
 *         application/json:
 *           schema: { type: object }
 *     responses:
 *       200:
 *         description: Updated
 *   delete:
 *     tags: [AR Recurring]
 *     summary: Delete recurring template
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Deleted
 */
router.put('/recurring/:id', roleMiddleware(['admin']), ar.updateRecurring);
router.delete('/recurring/:id', roleMiddleware(['admin']), ar.deleteRecurring);

/**
 * @swagger
 * /api/ar/recurring/{id}/run:
 *   post:
 *     tags: [AR Recurring]
 *     summary: Generate invoice from template now
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       201:
 *         description: Invoice generated
 */
router.post('/recurring/:id/run', roleMiddleware(['admin']), ar.runRecurringNow);

/**
 * @swagger
 * /api/ar/statements:
 *   get:
 *     tags: [AR Statements]
 *     summary: List statements
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Statements
 *   post:
 *     tags: [AR Statements]
 *     summary: Generate statement for a period
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [locationId, periodStart, periodEnd]
 *             properties:
 *               locationId: { type: string }
 *               periodStart: { type: string, format: date }
 *               periodEnd: { type: string, format: date }
 *     responses:
 *       201:
 *         description: Statement generated
 */
router.get('/statements', ar.listStatements);
router.post('/statements', roleMiddleware(['admin']), ar.generateStatement);

/**
 * @swagger
 * /api/ar/statements/{id}/email:
 *   post:
 *     tags: [AR Statements]
 *     summary: Email statement to partner
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Emailed
 */
router.post('/statements/:id/email', roleMiddleware(['admin']), ar.emailStatement);

/**
 * @swagger
 * /api/ar/reports/{reportType}:
 *   get:
 *     tags: [AR Reports]
 *     summary: Run an AR report
 *     description: |
 *       Supported reportType values:
 *       outstanding_balance, invoice_register, payment_register, invoice_aging,
 *       credits, late_fees, partner_ledger, monthly_revenue, monthly_collections.
 *       Pass format=csv for CSV download.
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: reportType
 *         required: true
 *         schema: { type: string }
 *       - in: query
 *         name: locationId
 *         schema: { type: string }
 *       - in: query
 *         name: format
 *         schema: { type: string, enum: [json, csv] }
 *     responses:
 *       200:
 *         description: Report data or CSV
 */
router.get('/reports/:reportType', ar.getReport);

/**
 * @swagger
 * /api/ar/imports/templates/{importType}:
 *   get:
 *     tags: [AR Imports]
 *     summary: Download CSV template
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: importType
 *         required: true
 *         schema: { type: string, enum: [invoices, payments, partners, credits] }
 *     responses:
 *       200:
 *         description: CSV template
 */
router.get('/imports/templates/:importType', roleMiddleware(['admin']), ar.getImportTemplate);

/**
 * @swagger
 * /api/ar/imports:
 *   get:
 *     tags: [AR Imports]
 *     summary: List import jobs
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Jobs
 *   post:
 *     tags: [AR Imports]
 *     summary: Upload CSV text and create import job
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [importType, csvText]
 *             properties:
 *               importType: { type: string, enum: [invoices, payments, partners, credits] }
 *               fileName: { type: string }
 *               csvText: { type: string }
 *     responses:
 *       201:
 *         description: Job created with preview and auto mapping
 */
router.get('/imports', roleMiddleware(['admin']), ar.listImportJobs);
router.post('/imports', roleMiddleware(['admin']), ar.createImportJob);

/**
 * @swagger
 * /api/ar/imports/{id}:
 *   get:
 *     tags: [AR Imports]
 *     summary: Get import job
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Job detail
 */
router.get('/imports/:id', roleMiddleware(['admin']), ar.getImportJob);

/**
 * @swagger
 * /api/ar/imports/{id}/mapping:
 *   put:
 *     tags: [AR Imports]
 *     summary: Save column mapping
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               columnMapping: { type: object }
 *     responses:
 *       200:
 *         description: Mapping saved
 */
router.put('/imports/:id/mapping', roleMiddleware(['admin']), ar.updateImportMapping);

/**
 * @swagger
 * /api/ar/imports/{id}/validate:
 *   post:
 *     tags: [AR Imports]
 *     summary: Validate mapped rows
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Validation result
 */
router.post('/imports/:id/validate', roleMiddleware(['admin']), ar.validateImportJob);

/**
 * @swagger
 * /api/ar/imports/{id}/execute:
 *   post:
 *     tags: [AR Imports]
 *     summary: Execute import
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Import summary
 */
router.post('/imports/:id/execute', roleMiddleware(['admin']), ar.executeImportJob);

/**
 * @swagger
 * /api/ar/audit-logs:
 *   get:
 *     tags: [AR Audit]
 *     summary: List AR audit logs (admin)
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: page
 *         schema: { type: integer }
 *       - in: query
 *         name: search
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Audit logs
 */
router.get('/audit-logs', roleMiddleware(['admin', 'support']), ar.listAuditLogs);

/**
 * @swagger
 * /api/ar/jobs:
 *   get:
 *     tags: [AR Audit]
 *     summary: List background job runs
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Job runs
 */
router.get('/jobs', roleMiddleware(['admin', 'support']), ar.listJobRuns);

/**
 * @swagger
 * /api/ar/jobs/{jobName}/run:
 *   post:
 *     tags: [AR Audit]
 *     summary: Manually run a background job
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: jobName
 *         required: true
 *         schema:
 *           type: string
 *           enum:
 *             - daily_invoice_generation
 *             - reminder_scheduler
 *             - late_fee_scheduler
 *             - monthly_statement_generator
 *             - overdue_status_sync
 *     responses:
 *       200:
 *         description: Job result
 */
router.post('/jobs/:jobName/run', roleMiddleware(['admin']), ar.runJobManually);

export default router;
