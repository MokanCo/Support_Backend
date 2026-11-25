import { AppError } from '../utils/AppError.js';

const SMS_TIME_ZONE = 'America/New_York';

export function toE164(value) {
  const digits = String(value ?? '').replace(/\D/g, '');
  if (digits.length < 10 || digits.length > 15) return '';
  return digits.length === 10 ? `+1${digits}` : `+${digits}`;
}

function part(parts, type) {
  return parts.find((item) => item.type === type)?.value ?? '';
}

export function zonedDateKey(date, timeZone = SMS_TIME_ZONE) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  return `${part(parts, 'year')}-${part(parts, 'month')}-${part(parts, 'day')}`;
}

export function nextDateKey(dateKey) {
  const [year, month, day] = dateKey.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day + 1)).toISOString().slice(0, 10);
}

export function zonedDayStart(dateKey, timeZone = SMS_TIME_ZONE) {
  let cursor = new Date(`${dateKey}T12:00:00Z`);
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(cursor);
    const key = `${part(parts, 'year')}-${part(parts, 'month')}-${part(parts, 'day')}`;
    const seconds = Number(part(parts, 'hour')) * 3600 + Number(part(parts, 'minute')) * 60 + Number(part(parts, 'second'));
    const delta = Date.parse(`${dateKey}T00:00:00Z`) - Date.parse(`${key}T00:00:00Z`) - seconds * 1000;
    if (delta === 0) return cursor;
    cursor = new Date(cursor.getTime() + delta);
  }
  throw new AppError('Could not resolve the message date', 400);
}

function requireE164(value, label) {
  const e164 = toE164(value);
  if (!e164) throw new AppError(`${label} must contain 10 to 15 digits`, 400);
  return e164;
}

function mediaUrls(value) {
  if (value == null) return [];
  if (!Array.isArray(value)) throw new AppError('message.media must be an array', 400);
  if (value.length > 10) throw new AppError('message.media has too many attachments', 400);
  return value.map((item) => {
    const url = String(item ?? '').trim();
    if (!/^https:\/\/\S+$/i.test(url) || url.length > 2000) {
      throw new AppError('message.media contains an invalid URL', 400);
    }
    return url;
  });
}

function parseOne(event, index, env) {
  if (!event || typeof event !== 'object' || Array.isArray(event)) {
    throw new AppError(`events[${index}] must be an object`, 400);
  }
  if (event.type !== 'message-received') return null;
  const message = event.message;
  if (!message || typeof message !== 'object' || Array.isArray(message)) {
    throw new AppError('message is required', 400);
  }
  if (message.direction && message.direction !== 'in') return null;
  const expectedApp = String(env.BANDWIDTH_MESSAGING_APPLICATION_ID || '').trim();
  if (expectedApp && String(message.applicationId || '') !== expectedApp) {
    throw new AppError('message.applicationId does not match the messaging application', 400);
  }
  const bandwidthMessageId = String(message.id || '').trim();
  if (!bandwidthMessageId || bandwidthMessageId.length > 128) {
    throw new AppError('message.id is required', 400);
  }
  const toValue = Array.isArray(message.to) ? message.to[0] : message.to || event.to;
  const fromNumber = requireE164(message.from, 'message.from');
  const toNumber = requireE164(toValue, 'message.to');
  const attachments = mediaUrls(message.media);
  const messageText = message.text == null ? '' : String(message.text);
  if (messageText.length > 8000) throw new AppError('message.text is too long', 400);
  if (!messageText.trim() && attachments.length === 0) {
    throw new AppError('message.text or message.media is required', 400);
  }
  const receivedAt = new Date(message.time || event.time || '');
  if (Number.isNaN(receivedAt.getTime())) throw new AppError('message.time is required', 400);
  return {
    bandwidthMessageId,
    fromNumber,
    toNumber,
    messageText,
    receivedAt,
    mediaUrls: attachments,
  };
}

/**
 * Bandwidth messaging callbacks are a JSON array of events.
 * @param {unknown} body
 * @param {NodeJS.ProcessEnv} [env]
 */
export function parseMessageReceived(body, env = process.env) {
  if (!Array.isArray(body)) throw new AppError('Bandwidth SMS webhook body must be an array', 400);
  const events = [];
  body.forEach((event, index) => {
    const parsed = parseOne(event, index, env);
    if (parsed) events.push(parsed);
  });
  return events;
}
