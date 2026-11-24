import { ReceptionistSetting } from '../models/receptionist.js';
import { bandwidthConfigured, bandwidthWebhooksReady } from './bandwidthAuth.js';
import { AppError } from '../utils/AppError.js';
import { recordAudit } from './receptionistAuditService.js';

const SECRET_KEYS = [
  'apiKey',
  'api_key',
  'openaiApiKey',
  'openAiApiKey',
  'bandwidthUsername',
  'bandwidthPassword',
  'bandwidthWebhookPassword',
  'bandwidthWebhookUsername',
  'bandwidthAccountId',
  'bandwidthClientId',
  'bandwidthClientSecret',
  'clientId',
  'clientSecret',
  'authToken',
  'accountSid',
  'secret',
  'password',
  'token',
];

export function assertNoSecrets(body) {
  if (!body || typeof body !== 'object') return;
  for (const key of SECRET_KEYS) {
    if (Object.prototype.hasOwnProperty.call(body, key)) {
      throw new AppError('Provider secrets cannot be saved from the portal. Set them on the server only.', 400);
    }
  }
}

export async function getSettings() {
  const doc = await ReceptionistSetting.findOne({ key: 'default' });
  return doc || new ReceptionistSetting({ key: 'default' });
}

export function formatSettings(doc) {
  return {
    recordingEnabled: Boolean(doc.recordingEnabled),
    retentionDays: Number(doc.retentionDays) || 30,
    disclosureMessage: doc.disclosureMessage || '',
    notifyEmail: doc.notifyEmail || '',
    updatedAt: doc.updatedAt ?? null,
  };
}

export async function updateSettings(input, user) {
  assertNoSecrets(input);
  const doc = await getSettings();
  if (input.recordingEnabled !== undefined) doc.recordingEnabled = Boolean(input.recordingEnabled);
  if (input.retentionDays !== undefined) {
    const days = Number(input.retentionDays);
    if (!Number.isInteger(days) || days < 1 || days > 3650) {
      throw new AppError('retentionDays must be an integer from 1 to 3650', 400);
    }
    doc.retentionDays = days;
  }
  if (input.disclosureMessage !== undefined) {
    const message = String(input.disclosureMessage ?? '').trim();
    if (!message || message.length > 300) {
      throw new AppError('disclosureMessage must be 1 to 300 characters', 400);
    }
    doc.disclosureMessage = message;
  }
  if (input.notifyEmail !== undefined) {
    const email = String(input.notifyEmail ?? '').trim();
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      throw new AppError('notifyEmail must be a valid email or empty', 400);
    }
    doc.notifyEmail = email;
  }
  doc.updatedBy = user?.id ?? null;
  await doc.save();
  await recordAudit(user, 'update', 'settings', doc._id, null);
  return formatSettings(doc);
}

export function getHealth(settings) {
  return {
    telephony: {
      configured: bandwidthConfigured(),
      provider: 'bandwidth',
      webhooksReady: bandwidthWebhooksReady(),
    },
    openai: {
      configured: Boolean(process.env.OPENAI_API_KEY),
      model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
    },
    recording: {
      enabled: Boolean(settings.recordingEnabled),
      retentionDays: Number(settings.retentionDays) || 30,
    },
    database: 'connected',
    routingLive: false,
  };
}
