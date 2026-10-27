import ArInvoice from '../../models/ArInvoice.js';
import ArPayment from '../../models/ArPayment.js';
import ArCredit from '../../models/ArCredit.js';
import Location from '../../models/Location.js';
import { AppError } from '../../utils/AppError.js';
import { assertCanViewAr, locationScopeFilter, money } from './arAccess.js';

function toCsv(rows, headers) {
  const esc = (v) => {
    const s = v == null ? '' : String(v);
    if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
    return s;
  };
  const lines = [headers.join(',')];
  for (const row of rows) {
    lines.push(headers.map((h) => esc(row[h])).join(','));
  }
  return lines.join('\n');
}

export const AR_REPORT_TYPES = [
  'outstanding_balance',
  'invoice_register',
  'payment_register',
  'invoice_aging',
  'credits',
  'late_fees',
  'partner_ledger',
  'monthly_revenue',
  'monthly_collections',
];

/** Short/legacy names used by clients, mapped to canonical report types. */
const REPORT_TYPE_ALIASES = {
  aging: 'invoice_aging',
  'invoice-aging': 'invoice_aging',
  outstanding: 'outstanding_balance',
  'outstanding-balance': 'outstanding_balance',
  revenue: 'monthly_revenue',
  'monthly-revenue': 'monthly_revenue',
  collections: 'monthly_collections',
  'monthly-collections': 'monthly_collections',
  invoices: 'invoice_register',
  'invoice-summary': 'invoice_register',
  'invoice-register': 'invoice_register',
  payments: 'payment_register',
  'payment-register': 'payment_register',
  'late-fees': 'late_fees',
  ledger: 'partner_ledger',
  'partner-ledger': 'partner_ledger',
};

export function normalizeReportType(rawType) {
  const key = String(rawType ?? '').trim().toLowerCase();
  const canonical = REPORT_TYPE_ALIASES[key] ?? key;
  if (!AR_REPORT_TYPES.includes(canonical)) {
    throw new AppError(
      `Unknown report type: ${rawType}. Supported types: ${AR_REPORT_TYPES.join(', ')}`,
      400,
    );
  }
  return canonical;
}

export async function runReport(actor, rawReportType, query = {}) {
  assertCanViewAr(actor);
  const reportType = normalizeReportType(rawReportType);
  const scope = locationScopeFilter(actor, query.locationId);
  const format = query.format === 'csv' ? 'csv' : 'json';

  if (reportType === 'outstanding_balance') {
    const invoices = await ArInvoice.find({
      isDeleted: { $ne: true },
      balanceDue: { $gt: 0 },
      status: { $nin: ['draft', 'cancelled', 'void'] },
      ...scope,
    })
      .populate('locationId', 'name')
      .sort({ dueDate: 1 })
      .lean();
    const rows = invoices.map((inv) => ({
      invoiceNumber: inv.invoiceNumber,
      partner: inv.locationId?.name || '',
      dueDate: inv.dueDate ? new Date(inv.dueDate).toISOString().slice(0, 10) : '',
      total: inv.total,
      amountPaid: inv.amountPaid,
      balanceDue: inv.balanceDue,
      status: inv.status,
    }));
    if (format === 'csv') {
      return {
        format: 'csv',
        filename: 'outstanding-balance.csv',
        content: toCsv(rows, [
          'invoiceNumber',
          'partner',
          'dueDate',
          'total',
          'amountPaid',
          'balanceDue',
          'status',
        ]),
      };
    }
    return { reportType, rows, totalBalance: money(rows.reduce((s, r) => s + Number(r.balanceDue), 0)) };
  }

  if (reportType === 'invoice_register') {
    const invoices = await ArInvoice.find({ isDeleted: { $ne: true }, ...scope })
      .populate('locationId', 'name')
      .sort({ invoiceDate: -1 })
      .limit(5000)
      .lean();
    const rows = invoices.map((inv) => ({
      invoiceNumber: inv.invoiceNumber,
      partner: inv.locationId?.name || '',
      invoiceDate: inv.invoiceDate ? new Date(inv.invoiceDate).toISOString().slice(0, 10) : '',
      dueDate: inv.dueDate ? new Date(inv.dueDate).toISOString().slice(0, 10) : '',
      total: inv.total,
      balanceDue: inv.balanceDue,
      status: inv.status,
    }));
    if (format === 'csv') {
      return {
        format: 'csv',
        filename: 'invoice-register.csv',
        content: toCsv(rows, [
          'invoiceNumber',
          'partner',
          'invoiceDate',
          'dueDate',
          'total',
          'balanceDue',
          'status',
        ]),
      };
    }
    return { reportType, rows };
  }

  if (reportType === 'payment_register') {
    const payments = await ArPayment.find({ isDeleted: { $ne: true }, ...scope })
      .populate('locationId', 'name')
      .populate('invoiceId', 'invoiceNumber')
      .sort({ paymentDate: -1 })
      .limit(5000)
      .lean();
    const rows = payments.map((p) => ({
      paymentDate: p.paymentDate ? new Date(p.paymentDate).toISOString().slice(0, 10) : '',
      partner: p.locationId?.name || '',
      invoiceNumber: p.invoiceId?.invoiceNumber || '',
      amount: p.amount,
      paymentMethod: p.paymentMethod,
      transactionReference: p.transactionReference || '',
    }));
    if (format === 'csv') {
      return {
        format: 'csv',
        filename: 'payment-register.csv',
        content: toCsv(rows, [
          'paymentDate',
          'partner',
          'invoiceNumber',
          'amount',
          'paymentMethod',
          'transactionReference',
        ]),
      };
    }
    return { reportType, rows };
  }

  if (reportType === 'invoice_aging') {
    const invoices = await ArInvoice.find({
      isDeleted: { $ne: true },
      balanceDue: { $gt: 0 },
      status: { $nin: ['draft', 'cancelled', 'void'] },
      ...scope,
    })
      .populate('locationId', 'name')
      .lean();
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const buckets = { current: 0, d30: 0, d60: 0, d90: 0, d90plus: 0 };
    const rows = invoices.map((inv) => {
      const due = new Date(inv.dueDate);
      due.setHours(0, 0, 0, 0);
      const days = Math.floor((today - due) / 86400000);
      let bucket = 'current';
      if (days > 90) bucket = 'd90plus';
      else if (days > 60) bucket = 'd90';
      else if (days > 30) bucket = 'd60';
      else if (days > 0) bucket = 'd30';
      buckets[bucket] += inv.balanceDue;
      return {
        invoiceNumber: inv.invoiceNumber,
        partner: inv.locationId?.name || '',
        dueDate: inv.dueDate ? new Date(inv.dueDate).toISOString().slice(0, 10) : '',
        daysPastDue: Math.max(0, days),
        balanceDue: inv.balanceDue,
        bucket,
      };
    });
    Object.keys(buckets).forEach((k) => {
      buckets[k] = money(buckets[k]);
    });
    if (format === 'csv') {
      return {
        format: 'csv',
        filename: 'invoice-aging.csv',
        content: toCsv(rows, [
          'invoiceNumber',
          'partner',
          'dueDate',
          'daysPastDue',
          'balanceDue',
          'bucket',
        ]),
      };
    }
    return { reportType, buckets, rows };
  }

  if (reportType === 'credits') {
    const credits = await ArCredit.find({ isDeleted: { $ne: true }, ...scope })
      .populate('locationId', 'name')
      .sort({ issuedDate: -1 })
      .limit(5000)
      .lean();
    const rows = credits.map((c) => ({
      partner: c.locationId?.name || '',
      type: c.type,
      amount: c.amount,
      remainingAmount: c.remainingAmount,
      reason: c.reason,
      issuedDate: c.issuedDate ? new Date(c.issuedDate).toISOString().slice(0, 10) : '',
      status: c.status,
    }));
    if (format === 'csv') {
      return {
        format: 'csv',
        filename: 'credits-report.csv',
        content: toCsv(rows, [
          'partner',
          'type',
          'amount',
          'remainingAmount',
          'reason',
          'issuedDate',
          'status',
        ]),
      };
    }
    return { reportType, rows };
  }

  if (reportType === 'late_fees') {
    const invoices = await ArInvoice.find({
      isDeleted: { $ne: true },
      lateFeeAmount: { $gt: 0 },
      ...scope,
    })
      .populate('locationId', 'name')
      .sort({ updatedAt: -1 })
      .limit(5000)
      .lean();
    const rows = invoices.map((inv) => ({
      invoiceNumber: inv.invoiceNumber,
      partner: inv.locationId?.name || '',
      lateFeeAmount: inv.lateFeeAmount,
      balanceDue: inv.balanceDue,
      status: inv.status,
    }));
    if (format === 'csv') {
      return {
        format: 'csv',
        filename: 'late-fees.csv',
        content: toCsv(rows, [
          'invoiceNumber',
          'partner',
          'lateFeeAmount',
          'balanceDue',
          'status',
        ]),
      };
    }
    return { reportType, rows };
  }

  if (reportType === 'partner_ledger') {
    if (!scope.locationId && !query.locationId) {
      throw new AppError('locationId is required for partner ledger', 400);
    }
    const locationId = scope.locationId || query.locationId;
    const loc = await Location.findById(locationId).lean();
    const [invoices, payments, credits] = await Promise.all([
      ArInvoice.find({ locationId, isDeleted: { $ne: true } }).sort({ invoiceDate: 1 }).lean(),
      ArPayment.find({ locationId, isDeleted: { $ne: true } }).sort({ paymentDate: 1 }).lean(),
      ArCredit.find({ locationId, isDeleted: { $ne: true } }).sort({ issuedDate: 1 }).lean(),
    ]);
    const entries = [
      ...invoices.map((i) => ({
        date: i.invoiceDate,
        type: 'invoice',
        ref: i.invoiceNumber,
        debit: i.total,
        credit: 0,
      })),
      ...payments.map((p) => ({
        date: p.paymentDate,
        type: 'payment',
        ref: p.transactionReference || String(p._id),
        debit: 0,
        credit: p.amount,
      })),
      ...credits.map((c) => ({
        date: c.issuedDate,
        type: 'credit',
        ref: c.reason || String(c._id),
        debit: 0,
        credit: c.amount,
      })),
    ].sort((a, b) => new Date(a.date) - new Date(b.date));
    let balance = 0;
    const rows = entries.map((e) => {
      balance = money(balance + e.debit - e.credit);
      return {
        date: e.date ? new Date(e.date).toISOString().slice(0, 10) : '',
        type: e.type,
        ref: e.ref,
        debit: e.debit,
        credit: e.credit,
        balance,
      };
    });
    if (format === 'csv') {
      return {
        format: 'csv',
        filename: 'partner-ledger.csv',
        content: toCsv(rows, ['date', 'type', 'ref', 'debit', 'credit', 'balance']),
      };
    }
    return {
      reportType,
      partner: loc?.name || '',
      locationId: String(locationId),
      rows,
      closingBalance: balance,
    };
  }

  if (reportType === 'monthly_revenue' || reportType === 'monthly_collections') {
    const months = Number(query.months) || 12;
    const start = new Date();
    start.setMonth(start.getMonth() - (months - 1));
    start.setDate(1);
    start.setHours(0, 0, 0, 0);
    if (reportType === 'monthly_revenue') {
      const agg = await ArInvoice.aggregate([
        {
          $match: {
            isDeleted: { $ne: true },
            status: { $nin: ['draft', 'cancelled', 'void'] },
            invoiceDate: { $gte: start },
            ...scope,
          },
        },
        {
          $group: {
            _id: { y: { $year: '$invoiceDate' }, m: { $month: '$invoiceDate' } },
            total: { $sum: '$total' },
          },
        },
        { $sort: { '_id.y': 1, '_id.m': 1 } },
      ]);
      const rows = agg.map((a) => ({
        year: a._id.y,
        month: a._id.m,
        total: money(a.total),
      }));
      if (format === 'csv') {
        return {
          format: 'csv',
          filename: 'monthly-revenue.csv',
          content: toCsv(rows, ['year', 'month', 'total']),
        };
      }
      return { reportType, rows };
    }
    const payScope = scope.locationId ? { locationId: scope.locationId } : {};
    const agg = await ArPayment.aggregate([
      {
        $match: {
          isDeleted: { $ne: true },
          paymentDate: { $gte: start },
          ...payScope,
        },
      },
      {
        $group: {
          _id: { y: { $year: '$paymentDate' }, m: { $month: '$paymentDate' } },
          total: { $sum: '$amount' },
        },
      },
      { $sort: { '_id.y': 1, '_id.m': 1 } },
    ]);
    const rows = agg.map((a) => ({
      year: a._id.y,
      month: a._id.m,
      total: money(a.total),
    }));
    if (format === 'csv') {
      return {
        format: 'csv',
        filename: 'monthly-collections.csv',
        content: toCsv(rows, ['year', 'month', 'total']),
      };
    }
    return { reportType, rows };
  }

  throw new AppError(`Unknown report type: ${reportType}`, 400);
}
