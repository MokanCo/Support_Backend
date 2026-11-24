import mongoose from 'mongoose';
import { Readable } from 'node:stream';
import { ReceptionistCall } from '../models/receptionist.js';
import Location from '../models/Location.js';
import { AppError } from '../utils/AppError.js';
import { MAX_TICKET_LIST_PAGE_SIZE } from '../constants/pagination.js';
import { getSettings } from './systemSettingsService.js';
import { bandwidthAccessToken } from './bandwidthAuth.js';
import { buildSummary } from './aiAnswerPolicy.js';

function formatCall(doc, branchName = '', { includeTurns = false } = {}) {
  const row = doc.toObject ? doc.toObject() : doc;
  return {
    id: String(row._id),
    from: row.from || '',
    to: row.to || '',
    locationId: row.locationId ? String(row.locationId) : null,
    branchName,
    startedAt: row.startedAt,
    endedAt: row.endedAt ?? null,
    durationSeconds: Number(row.durationSeconds) || 0,
    handling: row.handling,
    outcome: row.outcome,
    transferStatus: row.transferStatus,
    resolutionStatus: row.resolutionStatus,
    summary: row.summary || '',
    turns: includeTurns
      ? (row.turns ?? []).map((turn) => ({ speaker: turn.speaker, text: turn.text, at: turn.at }))
      : undefined,
    recordingAvailable: Boolean(row.recording?.sid),
    recordingDisclosed: Boolean(row.recordingDisclosed),
  };
}

async function branchNames(docs) {
  const ids = docs.map((doc) => doc.locationId).filter(Boolean);
  const locations = await Location.find({ _id: { $in: ids } }).select('name').lean();
  return new Map(locations.map((location) => [String(location._id), location.name]));
}

export async function applyRetention() {
  const settings = await getSettings();
  const days = Number(settings.retentionDays) || 30;
  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  await ReceptionistCall.updateMany(
    { startedAt: { $lt: cutoff }, $or: [{ 'recording.sid': { $ne: '' } }, { 'turns.0': { $exists: true } }] },
    {
      $set: {
        turns: [],
        summary: '',
        recording: { sid: '', url: '', contentType: '', durationSeconds: 0, storedAt: null },
      },
    },
  );
}

function dateFilter(query) {
  const filter = {};
  const from = query.from ? new Date(query.from) : null;
  const to = query.to ? new Date(query.to) : null;
  if (query.from && Number.isNaN(from?.getTime())) throw new AppError('from must be a date', 400);
  if (query.to && Number.isNaN(to?.getTime())) throw new AppError('to must be a date', 400);
  if (from || to) {
    filter.startedAt = {};
    if (from) filter.startedAt.$gte = from;
    if (to) {
      const end = new Date(to);
      if (String(query.to).length <= 10) end.setHours(23, 59, 59, 999);
      filter.startedAt.$lte = end;
    }
  }
  if (query.locationId) filter.locationId = query.locationId;
  if (query.outcome && query.outcome !== 'all') filter.outcome = query.outcome;
  if (query.hasRecording === 'true') filter['recording.sid'] = { $ne: '' };
  const search = typeof query.search === 'string' ? query.search.trim() : '';
  if (search) filter.from = new RegExp(search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
  return filter;
}

export async function listCalls(query) {
  await applyRetention();
  const page = Math.max(1, Number(query.page) || 1);
  const pageSize = Math.min(MAX_TICKET_LIST_PAGE_SIZE, Math.max(1, Number(query.pageSize) || 10));
  const filter = dateFilter(query);
  const [total, docs] = await Promise.all([
    ReceptionistCall.countDocuments(filter),
    ReceptionistCall.find(filter)
      .sort({ startedAt: -1 })
      .skip((page - 1) * pageSize)
      .limit(pageSize)
      .lean(),
  ]);
  const names = await branchNames(docs);
  return {
    calls: docs.map((doc) => formatCall(doc, names.get(String(doc.locationId)) ?? '')),
    total,
    page,
    pageSize,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
  };
}

export async function getCall(id) {
  if (!mongoose.isValidObjectId(id)) throw new AppError('Invalid call id', 400);
  const doc = await ReceptionistCall.findById(id);
  if (!doc) throw new AppError('Call not found', 404);
  let branchName = '';
  if (doc.locationId) {
    const location = await Location.findById(doc.locationId).select('name').lean();
    branchName = location?.name ?? '';
  }
  return formatCall(doc, branchName, { includeTurns: true });
}

export async function updateCallResolution(id, resolutionStatus) {
  if (!['pending', 'resolved', 'unresolved'].includes(resolutionStatus)) {
    throw new AppError('resolutionStatus is invalid', 400);
  }
  const doc = await ReceptionistCall.findById(id);
  if (!doc) throw new AppError('Call not found', 404);
  doc.resolutionStatus = resolutionStatus;
  if (!doc.summary) doc.summary = buildSummary(doc.turns);
  await doc.save();
  return getCall(id);
}

export async function getRecordingMeta(callId) {
  const call = await getCall(callId);
  if (!call.recordingAvailable) throw new AppError('No recording is stored for this call', 404);
  const doc = await ReceptionistCall.findById(callId).select('recording recordingDisclosed from to locationId durationSeconds outcome transferStatus summary').lean();
  return {
    callId: call.id,
    from: call.from,
    to: call.to,
    branchName: call.branchName,
    durationSeconds: doc.recording?.durationSeconds || call.durationSeconds,
    contentType: doc.recording?.contentType || 'audio/mpeg',
    disclosed: Boolean(doc.recordingDisclosed),
    outcome: call.outcome,
    transferStatus: call.transferStatus,
    summary: call.summary,
  };
}

export async function openRecordingStream(callId) {
  const doc = await ReceptionistCall.findById(callId);
  if (!doc?.recording?.sid || !doc.recording.url) throw new AppError('No recording is stored for this call', 404);
  const token = await bandwidthAccessToken();
  const user = process.env.BANDWIDTH_USERNAME;
  const pass = process.env.BANDWIDTH_PASSWORD;
  const authorization = token
    ? `Bearer ${token}`
    : user && pass
      ? `Basic ${Buffer.from(`${user}:${pass}`).toString('base64')}`
      : '';
  if (!authorization || !doc.recording.url) throw new AppError('Telephony credentials are not configured on the server', 503);
  const upstream = await fetch(doc.recording.url, {
    headers: { Authorization: authorization },
  });
  if (!upstream.ok || !upstream.body) throw new AppError('Recording could not be retrieved', 502);
  return {
    stream: Readable.fromWeb(upstream.body),
    contentType: upstream.headers.get('content-type') || 'audio/mpeg',
  };
}
