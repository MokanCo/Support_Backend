import mongoose from 'mongoose';
import BranchPhoneNumber from '../models/BranchPhoneNumber.js';
import { ReceptionistCall } from '../models/receptionist.js';
import { normalizePhoneDigits } from './phoneNumberService.js';
import { getSettings } from './systemSettingsService.js';
import { getEffectiveAgent } from './agentSettingsService.js';
import { answerQuestion } from './aiAnswerService.js';
import { buildSummary, escapeXml, isWithinBusinessHours } from './aiAnswerPolicy.js';
import { bandwidthCallbackAuthAttributes } from './bandwidthAuth.js';

function publicUrl(path) {
  const base = (process.env.API_PUBLIC_URL || '').replace(/\/$/, '');
  return base ? `${base}${path}` : '';
}

function xmlResponse(inner) {
  return `<?xml version="1.0" encoding="UTF-8"?><Response>${inner}</Response>`;
}

function speak(text) {
  return `<SpeakSentence voice="julie">${escapeXml(text)}</SpeakSentence>`;
}

function hangup(text) {
  return xmlResponse(`${text ? speak(text) : ''}<Hangup/>`);
}

function callKey(call) {
  return call.id || call._id;
}

function gather(call, prompt, settings) {
  const id = callKey(call);
  const action = publicUrl(`/api/ai-receptionist/voice/gather?callId=${id}`);
  if (!action) return hangup('The receptionist is not available right now.');
  const auth = bandwidthCallbackAuthAttributes(escapeXml);
  const recording = settings.recordingEnabled
    ? `<StartRecording recordingAvailableUrl="${escapeXml(publicUrl(`/api/ai-receptionist/voice/recording?callId=${id}`))}" recordingAvailableMethod="POST"${auth}/>`
    : '';
  const timeout = Math.min(30, Math.max(3, Number(settings.silenceTimeoutSec) || 8));
  return xmlResponse(
    `${recording}${speak(prompt)}<Gather input="speech" speechModel="phone_call" language="en-US" profanityFilter="false" speechTimeout="${timeout}" gatherUrl="${escapeXml(action)}" gatherMethod="POST"${auth}/>`,
  );
}

async function loadPhone(call) {
  if (!call.phoneNumberId) return null;
  return BranchPhoneNumber.findById(call.phoneNumberId);
}

function toE164(number) {
  const digits = normalizePhoneDigits(number);
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length >= 11 && digits.length <= 15) return `+${digits}`;
  return '';
}

function dial(call, number, prompt) {
  const destination = toE164(number);
  const action = publicUrl(`/api/ai-receptionist/voice/dial-status?callId=${callKey(call)}`);
  if (!action || !destination) return hangup(`${prompt} No branch number is available.`);
  const auth = bandwidthCallbackAuthAttributes(escapeXml);
  return xmlResponse(
    `${speak(prompt)}<Transfer transferCompleteUrl="${escapeXml(action)}" transferCompleteMethod="POST" callTimeout="20"${auth}><PhoneNumber>${escapeXml(destination)}</PhoneNumber></Transfer>`,
  );
}

async function findCall(callId, body) {
  if (callId && mongoose.Types.ObjectId.isValid(String(callId))) {
    const byId = await ReceptionistCall.findById(callId);
    if (byId) return byId;
  }
  const sid = String(body?.callId || '');
  if (!sid) return null;
  return ReceptionistCall.findOne({ callSid: sid });
}

export function durationSeconds(body) {
  const raw = body?.duration;
  if (raw != null && /^\d+(\.\d+)?$/.test(String(raw))) return Math.round(Number(raw));
  const match = String(raw || '').match(/^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?$/i);
  if (match && (match[1] || match[2] || match[3])) {
    return Math.round(Number(match[1] || 0) * 3600 + Number(match[2] || 0) * 60 + Number(match[3] || 0));
  }
  const end = Date.parse(body?.endTime || '');
  const start = Date.parse(body?.answerTime || body?.startTime || '');
  if (Number.isFinite(end) && Number.isFinite(start) && end >= start) return Math.round((end - start) / 1000);
  return 0;
}

export async function handleInbound(body) {
  const callSid = String(body.callId || '');
  if (callSid) {
    const existing = await ReceptionistCall.findOne({ callSid });
    if (existing) {
      const settings = await getSettings();
      return gather(existing, 'How else can I help?', settings);
    }
  }

  const to = String(body.to || '');
  const from = String(body.from || '');
  const digits = normalizePhoneDigits(to);
  const phone = digits ? await BranchPhoneNumber.findOne({ normalizedNumber: digits }) : null;
  const settings = await getSettings();
  const agent = await getEffectiveAgent(phone?.locationId);

  if (!phone) {
    await ReceptionistCall.create({
      callSid,
      from,
      to,
      normalizedTo: digits,
      startedAt: new Date(),
      endedAt: new Date(),
      handling: 'missed',
      outcome: 'missed',
      resolutionStatus: 'unresolved',
      summary: 'The called number is not configured for the receptionist.',
    });
    return hangup('This number is not set up with the receptionist.');
  }

  const aiOn = Boolean(phone.aiEnabled && agent.aiEnabled);
  const call = await ReceptionistCall.create({
    callSid,
    from,
    to,
    normalizedTo: digits,
    locationId: phone.locationId,
    phoneNumberId: phone._id,
    startedAt: new Date(),
    handling: aiOn ? 'ai' : 'human',
    outcome: 'in_progress',
    recordingDisclosed: Boolean(settings.recordingEnabled && aiOn),
  });

  if (!aiOn) {
    call.transferStatus = 'requested';
    await call.save();
    return dial(
      call,
      phone.transferNumber || phone.humanFallbackNumber,
      'The receptionist is not answering this line. I will try the branch team.',
    );
  }

  const hours = isWithinBusinessHours(phone.businessHours);
  const disclosure = settings.recordingEnabled ? `${settings.disclosureMessage} ` : '';
  if (hours.known && !hours.open) {
    call.turns.push({ speaker: 'ai', text: agent.afterHoursBehavior, at: new Date() });
    call.transferStatus = 'requested';
    await call.save();
    return dial(call, phone.transferNumber || phone.humanFallbackNumber, `${disclosure}${agent.afterHoursBehavior}`);
  }

  const greeting = `${disclosure}This is ${agent.agentName}. ${agent.greeting}`;
  call.turns.push({ speaker: 'ai', text: greeting, at: new Date() });
  await call.save();
  return gather(call, greeting, { ...settings.toObject?.() ?? settings, silenceTimeoutSec: agent.silenceTimeoutSec });
}

export async function handleGather(callId, body) {
  const call = await findCall(callId, body);
  if (!call) return hangup('This call is no longer available.');
  const phone = await loadPhone(call);
  const agent = await getEffectiveAgent(call.locationId);
  const settings = await getSettings();
  const speech = String(body.text || '').trim().slice(0, 2000);

  if (!speech) {
    call.silenceCount += 1;
    await call.save();
    if (call.silenceCount >= 2) {
      return finishUnheard(call, phone, agent);
    }
    return gather(call, 'I did not catch that. Could you repeat it?', {
      ...settings,
      silenceTimeoutSec: agent.silenceTimeoutSec,
      recordingEnabled: false,
    });
  }

  call.turns.push({ speaker: 'caller', text: speech, at: new Date() });
  const elapsed = (Date.now() - new Date(call.startedAt).getTime()) / 1000;
  if (elapsed > (agent.maxCallDurationSec || 600)) {
    call.outcome = 'unresolved';
    call.resolutionStatus = 'unresolved';
    call.summary = buildSummary(call.turns);
    call.transferStatus = 'requested';
    await call.save();
    return dial(call, phone?.transferNumber || phone?.humanFallbackNumber, 'This call has reached its time limit. I will connect you with the branch.');
  }

  const answer = await answerQuestion(speech, call.locationId);
  call.turns.push({ speaker: 'ai', text: answer.text.slice(0, 2000), at: new Date() });
  call.summary = buildSummary(call.turns);
  if (answer.transfer) {
    call.transferStatus = 'requested';
    call.outcome = 'unresolved';
    await call.save();
    return dial(call, phone?.transferNumber || phone?.humanFallbackNumber, answer.text);
  }
  call.outcome = 'answered';
  call.resolutionStatus = 'resolved';
  await call.save();
  return gather(call, answer.text, { recordingEnabled: false, silenceTimeoutSec: agent.silenceTimeoutSec });
}

function finishUnheard(call, phone, agent) {
  call.outcome = 'missed';
  call.handling = 'missed';
  call.resolutionStatus = 'unresolved';
  call.endedAt = new Date();
  call.summary = buildSummary(call.turns) || 'The caller was silent.';
  return call.save().then(() =>
    dial(call, phone?.humanFallbackNumber || phone?.transferNumber, agent.unknownQuestionHandling || 'I could not hear you. I will try the branch team.'),
  );
}

export async function handleDialStatus(callId, body) {
  const call = await findCall(callId, body);
  if (!call) return hangup();
  const phone = await loadPhone(call);
  const cause = String(body.cause || '');
  if (cause === 'hangup') {
    call.transferStatus = 'completed';
    call.outcome = 'transferred';
    call.handling = 'human';
    call.resolutionStatus = 'resolved';
    call.endedAt = new Date();
    call.summary = buildSummary(call.turns);
    await call.save();
    return hangup();
  }
  const fallback = phone?.humanFallbackNumber || '';
  const tried = phone?.transferNumber || '';
  if (!call.fallbackUsed && fallback && fallback !== tried) {
    call.fallbackUsed = true;
    call.transferStatus = 'failed';
    await call.save();
    return dial(call, fallback, 'I could not reach that person. I will try the fallback number.');
  }
  call.transferStatus = 'failed';
  call.outcome = 'unresolved';
  call.resolutionStatus = 'unresolved';
  call.endedAt = new Date();
  call.summary = buildSummary(call.turns);
  await call.save();
  return hangup('I could not reach the branch team. Please call again later.');
}

export async function handleCallStatus(body) {
  const call = await ReceptionistCall.findOne({ callSid: String(body.callId || '') });
  if (!call) return;
  const cause = String(body.cause || 'hangup');
  call.endedAt = call.endedAt || new Date();
  call.durationSeconds = durationSeconds(body) || call.durationSeconds;
  if (call.outcome === 'in_progress') {
    if (cause === 'hangup') {
      call.outcome = call.turns.some((turn) => turn.speaker === 'caller') ? 'answered' : 'missed';
      if (call.outcome === 'missed') call.handling = 'missed';
    } else {
      call.outcome = 'missed';
      call.handling = 'missed';
    }
  }
  call.summary = call.summary || buildSummary(call.turns);
  await call.save();
}

export async function handleRecording(callId, body) {
  const settings = await getSettings();
  if (!settings.recordingEnabled) return;
  const call = await findCall(callId, body);
  if (!call || !call.recordingDisclosed) return;
  const status = String(body.status || 'complete');
  if (status === 'error' || !body.recordingId || !body.mediaUrl) return;
  const format = String(body.fileFormat || 'mp3').toLowerCase();
  call.recording = {
    sid: String(body.recordingId || ''),
    url: String(body.mediaUrl || ''),
    contentType: format === 'wav' ? 'audio/wav' : 'audio/mpeg',
    durationSeconds: durationSeconds(body),
    storedAt: new Date(),
  };
  await call.save();
}
