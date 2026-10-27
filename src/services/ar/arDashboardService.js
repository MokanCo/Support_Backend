import ArInvoice from '../../models/ArInvoice.js';
import ArPayment from '../../models/ArPayment.js';
import { assertCanViewAr, locationScopeFilter, money } from './arAccess.js';

function startOfMonth(d = new Date()) {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}
function startOfYear(d = new Date()) {
  return new Date(d.getFullYear(), 0, 1);
}
function daysAgo(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  d.setHours(0, 0, 0, 0);
  return d;
}

export async function getArDashboard(actor, query = {}) {
  assertCanViewAr(actor);
  const scope = locationScopeFilter(actor, query.locationId);
  const base = { isDeleted: { $ne: true }, ...scope };
  const openStatuses = ['sent', 'viewed', 'partially_paid', 'overdue', 'scheduled'];

  const [
    outstandingAgg,
    overdueAgg,
    collectedMonth,
    collectedYear,
    statusCounts,
    monthlyRevenue,
    monthlyCollections,
  ] = await Promise.all([
    ArInvoice.aggregate([
      { $match: { ...base, status: { $in: openStatuses } } },
      { $group: { _id: null, total: { $sum: '$balanceDue' } } },
    ]),
    ArInvoice.aggregate([
      { $match: { ...base, status: 'overdue' } },
      { $group: { _id: null, total: { $sum: '$balanceDue' }, count: { $sum: 1 } } },
    ]),
    ArPayment.aggregate([
      {
        $match: {
          isDeleted: { $ne: true },
          paymentDate: { $gte: startOfMonth() },
          ...(scope.locationId ? { locationId: scope.locationId } : {}),
        },
      },
      { $group: { _id: null, total: { $sum: '$amount' } } },
    ]),
    ArPayment.aggregate([
      {
        $match: {
          isDeleted: { $ne: true },
          paymentDate: { $gte: startOfYear() },
          ...(scope.locationId ? { locationId: scope.locationId } : {}),
        },
      },
      { $group: { _id: null, total: { $sum: '$amount' } } },
    ]),
    ArInvoice.aggregate([
      { $match: base },
      { $group: { _id: '$status', count: { $sum: 1 } } },
    ]),
    ArInvoice.aggregate([
      {
        $match: {
          ...base,
          status: { $nin: ['draft', 'cancelled', 'void'] },
          invoiceDate: { $gte: daysAgo(365) },
        },
      },
      {
        $group: {
          _id: {
            y: { $year: '$invoiceDate' },
            m: { $month: '$invoiceDate' },
          },
          total: { $sum: '$total' },
        },
      },
      { $sort: { '_id.y': 1, '_id.m': 1 } },
    ]),
    ArPayment.aggregate([
      {
        $match: {
          isDeleted: { $ne: true },
          paymentDate: { $gte: daysAgo(365) },
          ...(scope.locationId ? { locationId: scope.locationId } : {}),
        },
      },
      {
        $group: {
          _id: {
            y: { $year: '$paymentDate' },
            m: { $month: '$paymentDate' },
          },
          total: { $sum: '$amount' },
        },
      },
      { $sort: { '_id.y': 1, '_id.m': 1 } },
    ]),
  ]);

  const byStatus = Object.fromEntries(statusCounts.map((s) => [s._id, s.count]));
  const totalInvoices = Object.values(byStatus).reduce((a, b) => a + b, 0);

  const agingBuckets = { current: 0, d30: 0, d60: 0, d90: 0, d90plus: 0 };
  const openInvoices = await ArInvoice.find({
    ...base,
    status: { $in: openStatuses },
    balanceDue: { $gt: 0 },
  })
    .select('dueDate balanceDue')
    .lean();

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  for (const inv of openInvoices) {
    const due = new Date(inv.dueDate);
    due.setHours(0, 0, 0, 0);
    const days = Math.floor((today - due) / 86400000);
    const bal = money(inv.balanceDue);
    if (days <= 0) agingBuckets.current += bal;
    else if (days <= 30) agingBuckets.d30 += bal;
    else if (days <= 60) agingBuckets.d60 += bal;
    else if (days <= 90) agingBuckets.d90 += bal;
    else agingBuckets.d90plus += bal;
  }

  const outstanding = money(outstandingAgg[0]?.total || 0);
  const overdueBalance = money(overdueAgg[0]?.total || 0);

  return {
    kpis: {
      outstandingBalance: outstanding,
      currentBalance: money(agingBuckets.current),
      overdueBalance,
      collectedThisMonth: money(collectedMonth[0]?.total || 0),
      collectedThisYear: money(collectedYear[0]?.total || 0),
      totalInvoices,
      paidInvoices: byStatus.paid || 0,
      partiallyPaid: byStatus.partially_paid || 0,
      overdueInvoices: byStatus.overdue || overdueAgg[0]?.count || 0,
      draftInvoices: byStatus.draft || 0,
    },
    charts: {
      monthlyRevenue: monthlyRevenue.map((r) => ({
        year: r._id.y,
        month: r._id.m,
        total: money(r.total),
      })),
      monthlyCollections: monthlyCollections.map((r) => ({
        year: r._id.y,
        month: r._id.m,
        total: money(r.total),
      })),
      statusDistribution: statusCounts.map((s) => ({
        status: s._id,
        count: s.count,
      })),
      aging: agingBuckets,
    },
  };
}
