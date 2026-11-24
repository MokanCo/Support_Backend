import { AiAgentConfig } from '../models/receptionist.js';
import Location from '../models/Location.js';
import { AppError } from '../utils/AppError.js';
import { recordAudit } from './receptionistAuditService.js';

const FIELDS = [
  'agentName',
  'voice',
  'voiceSpeed',
  'language',
  'speakingStyle',
  'tone',
  'greeting',
  'maxCallDurationSec',
  'silenceTimeoutSec',
  'repeatHandling',
  'interruptionHandling',
  'unknownQuestionHandling',
  'escalationRules',
  'complaintHandling',
  'afterHoursBehavior',
  'aiEnabled',
];

function format(doc, scope, inheritsGlobal) {
  const row = doc.toObject ? doc.toObject() : doc;
  return {
    locationId: row.locationId ? String(row.locationId) : null,
    scope,
    inheritsGlobal,
    agentName: row.agentName,
    voice: row.voice,
    voiceSpeed: row.voiceSpeed,
    language: row.language,
    speakingStyle: row.speakingStyle,
    tone: row.tone,
    greeting: row.greeting,
    maxCallDurationSec: row.maxCallDurationSec,
    silenceTimeoutSec: row.silenceTimeoutSec,
    repeatHandling: row.repeatHandling,
    interruptionHandling: row.interruptionHandling,
    unknownQuestionHandling: row.unknownQuestionHandling,
    escalationRules: row.escalationRules,
    complaintHandling: row.complaintHandling,
    afterHoursBehavior: row.afterHoursBehavior,
    aiEnabled: Boolean(row.aiEnabled),
    updatedAt: row.updatedAt ?? null,
  };
}

async function globalConfig() {
  let doc = await AiAgentConfig.findOne({ locationId: null });
  if (!doc) doc = await AiAgentConfig.create({ locationId: null });
  return doc;
}

export async function getAgentSettings(locationId) {
  const globalDoc = await globalConfig();
  if (!locationId) return format(globalDoc, 'global', false);
  const location = await Location.findById(locationId).select('_id');
  if (!location) throw new AppError('Branch not found', 404);
  const branch = await AiAgentConfig.findOne({ locationId: location._id });
  if (!branch) return format(globalDoc, 'branch', true);
  return format(branch, 'branch', false);
}

export async function getEffectiveAgent(locationId) {
  const globalDoc = await globalConfig();
  if (!locationId) return globalDoc;
  const branch = await AiAgentConfig.findOne({ locationId });
  return branch || globalDoc;
}

export async function saveAgentSettings(input, user) {
  const locationId = input.locationId || null;
  let doc;
  if (!locationId) {
    doc = await globalConfig();
  } else {
    const location = await Location.findById(locationId).select('_id');
    if (!location) throw new AppError('Branch not found', 404);
    doc = await AiAgentConfig.findOne({ locationId: location._id });
    if (!doc) doc = new AiAgentConfig({ locationId: location._id });
  }
  for (const field of FIELDS) {
    if (input[field] !== undefined) doc[field] = input[field];
  }
  if (doc.greeting != null) doc.greeting = String(doc.greeting).trim();
  if (!doc.agentName || !String(doc.agentName).trim()) {
    throw new AppError('agentName is required', 400);
  }
  if (!doc.greeting) throw new AppError('greeting is required', 400);
  doc.updatedBy = user?.id ?? null;
  await doc.save();
  await recordAudit(user, 'update', 'agent-settings', doc._id, doc.locationId);
  return format(doc, locationId ? 'branch' : 'global', false);
}

export async function deleteBranchAgentSettings(locationId, user) {
  if (!locationId) throw new AppError('locationId is required to remove a branch override', 400);
  const doc = await AiAgentConfig.findOne({ locationId });
  if (!doc) throw new AppError('Branch override not found', 404);
  await doc.deleteOne();
  await recordAudit(user, 'delete', 'agent-settings', doc._id, locationId);
  return { ok: true };
}
