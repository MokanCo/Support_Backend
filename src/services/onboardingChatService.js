import mongoose from 'mongoose';
import OnboardingMessage from '../models/OnboardingMessage.js';
import OnboardingRequest from '../models/OnboardingRequest.js';
import { AppError } from '../utils/AppError.js';
import {
  sendOnboardingChatNotificationEmail,
} from './onboardingMailService.js';
import { buildTrackingUrl } from './onboardingManagementService.js';

const CHAT_STATUSES = ['pending', 'in_progress', 'completed', 'rejected'];

function ownerName(request) {
  const p = request.personal;
  if (!p) return 'Customer';
  return `${p.firstName ?? ''} ${p.lastName ?? ''}`.trim() || 'Customer';
}

function formatMessage(doc) {
  const x = typeof doc.toObject === 'function' ? doc.toObject() : doc;
  return {
    id: String(x._id),
    requestId: String(x.requestId),
    senderType: x.senderType,
    senderId: x.senderId ? String(x.senderId) : null,
    senderName: x.senderName,
    text: x.text,
    createdAt: x.createdAt,
  };
}

async function findRequestByToken(token) {
  const request = await OnboardingRequest.findOne({
    trackingToken: token.trim(),
    status: { $in: CHAT_STATUSES },
  });
  if (!request) throw new AppError('Onboarding not found', 404);
  return request;
}

async function findRequestById(id) {
  const request = await OnboardingRequest.findById(id);
  if (!request) throw new AppError('Onboarding not found', 404);
  return request;
}

export async function listMessagesForToken(token) {
  const request = await findRequestByToken(token);
  const messages = await OnboardingMessage.find({ requestId: request._id })
    .sort({ createdAt: 1 })
    .lean();
  return { messages: messages.map(formatMessage) };
}

export async function createCustomerMessage(token, text) {
  const request = await findRequestByToken(token);
  if (request.status === 'rejected') {
    throw new AppError('Messaging is not available for rejected requests', 403);
  }

  const trimmed = text.trim();
  if (!trimmed) throw new AppError('Message text is required', 400);

  const doc = await OnboardingMessage.create({
    requestId: request._id,
    senderType: 'customer',
    senderId: null,
    senderName: ownerName(request),
    text: trimmed,
  });

  const row = formatMessage(doc);

  void sendOnboardingChatNotificationEmail({
    toAdmin: true,
    ownerName: ownerName(request),
    locationName: request.location?.locationName ?? 'Location',
    email: request.personal?.email ?? '',
    text: trimmed,
    requestId: String(request._id),
    trackingId: request.trackingId ?? '',
  }).catch((e) => {
    // eslint-disable-next-line no-console
    console.error('[onboardingChat] admin notify failed', e);
  });

  return { message: row };
}

export async function listMessagesForAdmin(requestId) {
  const request = await findRequestById(requestId);
  const messages = await OnboardingMessage.find({ requestId: request._id })
    .sort({ createdAt: 1 })
    .lean();
  return { messages: messages.map(formatMessage) };
}

export async function createAdminMessage(requestId, actor, text) {
  const request = await findRequestById(requestId);
  const trimmed = text.trim();
  if (!trimmed) throw new AppError('Message text is required', 400);

  const doc = await OnboardingMessage.create({
    requestId: request._id,
    senderType: 'admin',
    senderId: new mongoose.Types.ObjectId(actor.id),
    senderName: (actor.name || actor.email || 'Admin').trim(),
    text: trimmed,
  });

  const row = formatMessage(doc);
  const trackingUrl = buildTrackingUrl(request.trackingToken);

  void sendOnboardingChatNotificationEmail({
    toAdmin: false,
    to: request.personal?.email ?? '',
    ownerName: ownerName(request),
    locationName: request.location?.locationName ?? 'Location',
    text: trimmed,
    trackingUrl,
    trackingId: request.trackingId ?? '',
  }).catch((e) => {
    // eslint-disable-next-line no-console
    console.error('[onboardingChat] customer notify failed', e);
  });

  return { message: row };
}
