import ReceptionistSmsMessage from '../models/ReceptionistSmsMessage.js';
import { AppError } from '../utils/AppError.js';
import { emitSmsInbound } from '../realtime/messageHub.js';
import { nextDateKey, parseMessageReceived, toE164, zonedDateKey, zonedDayStart } from './smsPayload.js';

const SMS_TIME_ZONE = 'America/New_York';

function formatSms(row) {
  const receivedAt = row.receivedAt instanceof Date ? row.receivedAt : new Date(row.receivedAt);
  const createdAt = row.createdAt instanceof Date ? row.createdAt : row.createdAt ? new Date(row.createdAt) : receivedAt;
  const updatedAt = row.updatedAt instanceof Date ? row.updatedAt : row.updatedAt ? new Date(row.updatedAt) : createdAt;
  return {
    id: String(row.id || row._id),
    bandwidthMessageId: row.bandwidthMessageId,
    fromNumber: row.fromNumber,
    toNumber: row.toNumber,
    messageText: row.messageText ?? '',
    direction: row.direction,
    status: row.status,
    receivedAt: receivedAt.toISOString(),
    mediaUrls: Array.isArray(row.mediaUrls) ? row.mediaUrls : [],
    createdAt: createdAt.toISOString(),
    updatedAt: updatedAt.toISOString(),
  };
}

function digits(value) {
  return String(value ?? '').replace(/\D/g, '');
}

function pageArgs(query) {
  const page = Math.max(1, Number(query.page) || 1);
  const pageSize = Math.min(200, Math.max(1, Number(query.pageSize) || 20));
  return { page, pageSize };
}

function dateRange(query) {
  const range = {};
  if (query.from) range.start = zonedDayStart(String(query.from), SMS_TIME_ZONE);
  if (query.to) range.end = zonedDayStart(nextDateKey(String(query.to)), SMS_TIME_ZONE);
  return range;
}

export function matchesSmsQuery(row, query) {
  if (query.status && query.status !== 'all' && row.status !== query.status) return false;
  const needle = digits(query.search);
  if (needle) {
    const hay = `${digits(row.fromNumber)}${digits(row.toNumber)}`;
    if (!hay.includes(needle) && !digits(row.fromNumber).includes(needle) && !digits(row.toNumber).includes(needle)) {
      return false;
    }
  }
  const range = dateRange(query);
  const received = new Date(row.receivedAt);
  if (range.start && received < range.start) return false;
  if (range.end && received >= range.end) return false;
  return true;
}

function mongoListFilter(query) {
  const filter = {};
  if (query.status && query.status !== 'all') filter.status = query.status;
  const needle = digits(query.search);
  if (needle) {
    const pattern = needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    filter.$or = [{ fromNumber: { $regex: pattern } }, { toNumber: { $regex: pattern } }];
  }
  const range = dateRange(query);
  if (range.start || range.end) {
    filter.receivedAt = {};
    if (range.start) filter.receivedAt.$gte = range.start;
    if (range.end) filter.receivedAt.$lt = range.end;
  }
  return filter;
}

function phoneFilter(phoneNumber) {
  const e164 = toE164(phoneNumber);
  if (!e164) throw new AppError('phoneNumber must contain 10 to 15 digits', 400);
  return e164;
}

export function createMemorySmsRepo() {
  const rows = [];
  let sequence = 0;
  return {
    async insertInbound(event) {
      if (rows.some((row) => row.bandwidthMessageId === event.bandwidthMessageId)) {
        return { duplicate: true, message: formatSms(rows.find((row) => row.bandwidthMessageId === event.bandwidthMessageId)) };
      }
      sequence += 1;
      const now = new Date();
      const saved = {
        id: String(sequence).padStart(24, '0'),
        bandwidthMessageId: event.bandwidthMessageId,
        fromNumber: event.fromNumber,
        toNumber: event.toNumber,
        messageText: event.messageText,
        direction: 'inbound',
        status: 'received',
        receivedAt: event.receivedAt,
        readAt: null,
        mediaUrls: event.mediaUrls,
        createdAt: now,
        updatedAt: now,
      };
      rows.push(saved);
      return { duplicate: false, message: formatSms(saved) };
    },
    async list(query) {
      const { page, pageSize } = pageArgs(query);
      const matched = rows
        .filter((row) => matchesSmsQuery(row, query))
        .sort((left, right) => new Date(right.receivedAt) - new Date(left.receivedAt));
      const slice = matched.slice((page - 1) * pageSize, page * pageSize);
      return {
        messages: slice.map(formatSms),
        total: matched.length,
        page,
        pageSize,
        totalPages: Math.max(1, Math.ceil(matched.length / pageSize)),
      };
    },
    async conversation(phoneNumber) {
      const e164 = phoneFilter(phoneNumber);
      const messages = rows
        .filter((row) => row.fromNumber === e164 || row.toNumber === e164)
        .sort((left, right) => new Date(left.receivedAt) - new Date(right.receivedAt))
        .map(formatSms);
      return { phoneNumber: e164, messages };
    },
    async overview(now = new Date()) {
      const start = zonedDayStart(zonedDateKey(now, SMS_TIME_ZONE), SMS_TIME_ZONE);
      const end = zonedDayStart(nextDateKey(zonedDateKey(now, SMS_TIME_ZONE)), SMS_TIME_ZONE);
      const inbound = rows.filter((row) => row.direction === 'inbound');
      return {
        totalInbound: inbound.length,
        unread: inbound.filter((row) => row.status === 'received').length,
        today: inbound.filter((row) => {
          const received = new Date(row.receivedAt);
          return received >= start && received < end;
        }).length,
      };
    },
    async markRead(id) {
      const row = rows.find((item) => item.id === String(id));
      if (!row) return null;
      if (row.status !== 'read') {
        row.status = 'read';
        row.readAt = new Date();
        row.updatedAt = row.readAt;
      }
      return formatSms(row);
    },
  };
}

const mongoSmsRepo = {
  async insertInbound(event) {
    try {
      const doc = await ReceptionistSmsMessage.create({
        bandwidthMessageId: event.bandwidthMessageId,
        fromNumber: event.fromNumber,
        toNumber: event.toNumber,
        messageText: event.messageText,
        direction: 'inbound',
        status: 'received',
        receivedAt: event.receivedAt,
        mediaUrls: event.mediaUrls,
      });
      return { duplicate: false, message: formatSms(doc) };
    } catch (error) {
      if (error && error.code === 11000) {
        const existing = await ReceptionistSmsMessage.findOne({ bandwidthMessageId: event.bandwidthMessageId });
        return { duplicate: true, message: existing ? formatSms(existing) : null };
      }
      throw error;
    }
  },
  async list(query) {
    const { page, pageSize } = pageArgs(query);
    const filter = mongoListFilter(query);
    const [docs, total] = await Promise.all([
      ReceptionistSmsMessage.find(filter)
        .sort({ receivedAt: -1 })
        .skip((page - 1) * pageSize)
        .limit(pageSize),
      ReceptionistSmsMessage.countDocuments(filter),
    ]);
    return {
      messages: docs.map(formatSms),
      total,
      page,
      pageSize,
      totalPages: Math.max(1, Math.ceil(total / pageSize)),
    };
  },
  async conversation(phoneNumber) {
    const e164 = phoneFilter(phoneNumber);
    const docs = await ReceptionistSmsMessage.find({
      $or: [{ fromNumber: e164 }, { toNumber: e164 }],
    }).sort({ receivedAt: 1 });
    return { phoneNumber: e164, messages: docs.map(formatSms) };
  },
  async overview(now = new Date()) {
    const start = zonedDayStart(zonedDateKey(now, SMS_TIME_ZONE), SMS_TIME_ZONE);
    const end = zonedDayStart(nextDateKey(zonedDateKey(now, SMS_TIME_ZONE)), SMS_TIME_ZONE);
    const [totalInbound, unread, today] = await Promise.all([
      ReceptionistSmsMessage.countDocuments({ direction: 'inbound' }),
      ReceptionistSmsMessage.countDocuments({ direction: 'inbound', status: 'received' }),
      ReceptionistSmsMessage.countDocuments({
        direction: 'inbound',
        receivedAt: { $gte: start, $lt: end },
      }),
    ]);
    return { totalInbound, unread, today };
  },
  async markRead(id) {
    const doc = await ReceptionistSmsMessage.findById(id);
    if (!doc) return null;
    if (doc.status !== 'read') {
      doc.status = 'read';
      doc.readAt = new Date();
      await doc.save();
    }
    return formatSms(doc);
  },
};

function repoOf(options) {
  return options.repo ?? mongoSmsRepo;
}

export async function ingestInbound(body, options = {}) {
  const events = parseMessageReceived(body, options.env ?? process.env);
  const repo = repoOf(options);
  const notify = options.notify ?? emitSmsInbound;
  let saved = 0;
  let duplicates = 0;
  for (const event of events) {
    const outcome = await repo.insertInbound(event);
    if (outcome.duplicate) {
      duplicates += 1;
      console.info('[sms] duplicate ignored', { messageId: event.bandwidthMessageId });
      continue;
    }
    saved += 1;
    try {
      await notify(outcome.message);
    } catch (error) {
      console.error('[sms] notify failed', {
        messageId: event.bandwidthMessageId,
        message: error instanceof Error ? error.message : 'unknown error',
      });
    }
  }
  return { received: true, saved, duplicates };
}

export async function listSmsMessages(query, options = {}) {
  return repoOf(options).list(query);
}

export async function getSmsConversation(phoneNumber, options = {}) {
  return repoOf(options).conversation(phoneNumber);
}

export async function getSmsOverview(options = {}) {
  return repoOf(options).overview(options.now ?? new Date());
}

export async function markSmsRead(id, options = {}) {
  const message = await repoOf(options).markRead(id);
  if (!message) throw new AppError('Message not found', 404);
  return message;
}
