import mongoose from 'mongoose';
import { ReceptionistCall } from '../models/receptionist.js';
import Location from '../models/Location.js';
import { AppError } from '../utils/AppError.js';
import { applyRetention } from './callService.js';
import { getHealth, getSettings, formatSettings } from './systemSettingsService.js';

function range(query) {
  const match = {};
  if (query.from) {
    const from = new Date(query.from);
    if (Number.isNaN(from.getTime())) throw new AppError('from must be a date', 400);
    match.startedAt = { ...(match.startedAt || {}), $gte: from };
  }
  if (query.to) {
    const to = new Date(query.to);
    if (Number.isNaN(to.getTime())) throw new AppError('to must be a date', 400);
    if (String(query.to).length <= 10) to.setHours(23, 59, 59, 999);
    match.startedAt = { ...(match.startedAt || {}), $lte: to };
  }
  if (query.locationId) {
    if (!mongoose.isValidObjectId(query.locationId)) throw new AppError('Invalid locationId', 400);
    match.locationId = new mongoose.Types.ObjectId(query.locationId);
  }
  return match;
}

function rate(part, total) {
  if (!total) return 0;
  return Math.round((part / total) * 1000) / 10;
}

export async function buildAnalytics(query) {
  await applyRetention();
  const match = range(query);
  const [totals, byDay, byHour, byOutcome, byBranch, questions, complaints, recent] = await Promise.all([
    ReceptionistCall.aggregate([
      { $match: match },
      {
        $group: {
          _id: null,
          total: { $sum: 1 },
          ai: { $sum: { $cond: [{ $eq: ['$handling', 'ai'] }, 1, 0] } },
          transferred: { $sum: { $cond: [{ $eq: ['$outcome', 'transferred'] }, 1, 0] } },
          missed: { $sum: { $cond: [{ $eq: ['$outcome', 'missed'] }, 1, 0] } },
          resolved: { $sum: { $cond: [{ $eq: ['$resolutionStatus', 'resolved'] }, 1, 0] } },
          unresolved: { $sum: { $cond: [{ $eq: ['$resolutionStatus', 'unresolved'] }, 1, 0] } },
          duration: { $sum: '$durationSeconds' },
          durationCount: { $sum: { $cond: [{ $gt: ['$durationSeconds', 0] }, 1, 0] } },
        },
      },
    ]),
    ReceptionistCall.aggregate([
      { $match: match },
      {
        $group: {
          _id: { $dateToString: { format: '%Y-%m-%d', date: '$startedAt', timezone: 'America/New_York' } },
          total: { $sum: 1 },
          ai: { $sum: { $cond: [{ $eq: ['$handling', 'ai'] }, 1, 0] } },
          human: { $sum: { $cond: [{ $eq: ['$handling', 'human'] }, 1, 0] } },
        },
      },
      { $sort: { _id: 1 } },
    ]),
    ReceptionistCall.aggregate([
      { $match: match },
      {
        $group: {
          _id: { $hour: { date: '$startedAt', timezone: 'America/New_York' } },
          total: { $sum: 1 },
        },
      },
      { $sort: { _id: 1 } },
    ]),
    ReceptionistCall.aggregate([
      { $match: match },
      { $group: { _id: '$outcome', total: { $sum: 1 } } },
      { $sort: { total: -1 } },
    ]),
    ReceptionistCall.aggregate([
      { $match: match },
      {
        $group: {
          _id: '$locationId',
          total: { $sum: 1 },
          transferred: { $sum: { $cond: [{ $eq: ['$outcome', 'transferred'] }, 1, 0] } },
          missed: { $sum: { $cond: [{ $eq: ['$outcome', 'missed'] }, 1, 0] } },
        },
      },
      { $sort: { total: -1 } },
      { $limit: 20 },
    ]),
    ReceptionistCall.aggregate([
      { $match: match },
      { $unwind: '$turns' },
      { $match: { 'turns.speaker': 'caller' } },
      { $group: { _id: { $toLower: { $substrCP: ['$turns.text', 0, 80] } }, total: { $sum: 1 } } },
      { $sort: { total: -1 } },
      { $limit: 8 },
    ]),
    ReceptionistCall.aggregate([
      { $match: match },
      { $unwind: '$turns' },
      { $match: { 'turns.speaker': 'caller', 'turns.text': /complaint|refund|angry|upset|terrible|frustrated/i } },
      { $group: { _id: { $substrCP: ['$turns.text', 0, 120] }, total: { $sum: 1 } } },
      { $sort: { total: -1 } },
      { $limit: 8 },
    ]),
    ReceptionistCall.find(match).sort({ startedAt: -1 }).limit(8).lean(),
  ]);

  const row = totals[0] || { total: 0, ai: 0, transferred: 0, missed: 0, resolved: 0, unresolved: 0, duration: 0, durationCount: 0 };
  const ids = byBranch.map((item) => item._id).filter(Boolean);
  const locations = await Location.find({ _id: { $in: ids } }).select('name').lean();
  const names = new Map(locations.map((location) => [String(location._id), location.name]));
  const recentNames = await Location.find({
    _id: { $in: recent.map((call) => call.locationId).filter(Boolean) },
  }).select('name').lean();
  const recentNameMap = new Map(recentNames.map((location) => [String(location._id), location.name]));
  const settings = await getSettings();

  return {
    kpis: {
      total: row.total,
      answeredByAi: row.ai,
      transferred: row.transferred,
      missed: row.missed,
      averageDurationSeconds: row.durationCount ? Math.round(row.duration / row.durationCount) : 0,
      resolved: row.resolved,
      unresolved: row.unresolved,
      aiAnswerRate: rate(row.ai, row.total),
      missedRate: rate(row.missed, row.total),
      transferRate: rate(row.transferred, row.total),
      resolvedRate: rate(row.resolved, row.total),
      unresolvedRate: rate(row.unresolved, row.total),
    },
    charts: {
      volume: byDay.map((item) => ({ date: item._id, total: item.total, ai: item.ai, human: item.human })),
      outcomes: byOutcome.map((item) => ({ outcome: item._id, total: item.total })),
      branches: byBranch.map((item) => ({
        locationId: item._id ? String(item._id) : null,
        branchName: names.get(String(item._id)) || 'Unassigned',
        total: item.total,
        transferred: item.transferred,
        missed: item.missed,
      })),
      hours: byHour.map((item) => ({ hour: item._id, total: item.total })),
    },
    questions: questions.filter((item) => item._id).map((item) => ({ text: item._id, total: item.total })),
    complaints: complaints.filter((item) => item._id).map((item) => ({ text: item._id, total: item.total })),
    recentCalls: recent.map((call) => ({
      id: String(call._id),
      from: call.from,
      branchName: recentNameMap.get(String(call.locationId)) || '',
      startedAt: call.startedAt,
      durationSeconds: call.durationSeconds || 0,
      handling: call.handling,
      outcome: call.outcome,
      transferStatus: call.transferStatus,
      resolutionStatus: call.resolutionStatus,
    })),
    service: getHealth(settings),
    settings: formatSettings(settings),
  };
}

export async function exportAnalyticsCsv(query) {
  const match = range(query);
  const calls = await ReceptionistCall.find(match).sort({ startedAt: -1 }).limit(5000).lean();
  const locations = await Location.find({
    _id: { $in: calls.map((call) => call.locationId).filter(Boolean) },
  }).select('name').lean();
  const names = new Map(locations.map((location) => [String(location._id), location.name]));
  const header = ['from', 'to', 'branch', 'startedAt', 'durationSeconds', 'handling', 'outcome', 'transferStatus', 'resolutionStatus', 'summary'];
  const lines = [header.join(',')];
  for (const call of calls) {
    const values = [
      call.from,
      call.to,
      names.get(String(call.locationId)) || '',
      call.startedAt ? new Date(call.startedAt).toISOString() : '',
      call.durationSeconds || 0,
      call.handling,
      call.outcome,
      call.transferStatus,
      call.resolutionStatus,
      call.summary || '',
    ];
    lines.push(values.map((value) => `"${String(value).replace(/"/g, '""')}"`).join(','));
  }
  return lines.join('\n');
}
