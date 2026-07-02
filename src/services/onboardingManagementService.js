import crypto from 'crypto';
import mongoose from 'mongoose';
import OnboardingRequest, { ONBOARDING_STATUSES } from '../models/OnboardingRequest.js';
import OnboardingRequestTask from '../models/OnboardingRequestTask.js';
import OnboardingActivityLog from '../models/OnboardingActivityLog.js';
import OnboardingIdCounter from '../models/OnboardingIdCounter.js';
import { AppError } from '../utils/AppError.js';
import { MAX_TICKET_LIST_PAGE_SIZE } from '../constants/pagination.js';
import * as locationService from './locationService.js';
import * as userService from './userService.js';
import {
  instantiateRequestTasks,
  syncServiceTemplates,
  getActiveServiceMetaMap,
  buildServiceGroupsFromTasks,
  buildPreviewServiceGroups,
  reconcileRequestTasks,
} from './onboardingTemplateService.js';
import {
  sendOnboardingApprovalEmail,
  sendOnboardingCompletedEmail,
  sendOnboardingMilestoneEmail,
  sendOnboardingPublicCommentEmail,
} from './onboardingMailService.js';

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function buildTrackingUrl(token) {
  const base = (process.env.APP_URL || process.env.FRONTEND_URL || '').replace(/\/$/, '');
  if (!base) return `/onboarding/track?token=${encodeURIComponent(token)}`;
  return `${base}/onboarding/track?token=${encodeURIComponent(token)}`;
}

function ownerName(request) {
  return `${request.personal?.firstName ?? ''} ${request.personal?.lastName ?? ''}`.trim();
}

function formatRequestRow(doc) {
  return {
    id: String(doc._id),
    trackingId: doc.trackingId ?? null,
    trackingToken: doc.trackingToken,
    status: doc.status,
    ownerName: ownerName(doc),
    email: doc.personal?.email ?? '',
    phone: doc.personal?.phone ?? '',
    locationName: doc.location?.locationName ?? '',
    businessName: doc.businessName ?? '',
    website: doc.website ?? '',
    notes: doc.notes ?? '',
    personal: doc.personal,
    location: doc.location,
    selectedServices: doc.selectedServices ?? [],
    submittedAt: doc.submittedAt ?? doc.createdAt,
    approvedAt: doc.approvedAt ?? null,
    completedAt: doc.completedAt ?? null,
    progressPercent: doc.progressPercent ?? 0,
    reviewNotes: doc.reviewNotes ?? '',
    reviewedByName: doc.reviewedByName ?? '',
    reviewedAt: doc.reviewedAt ?? null,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  };
}

function formatTask(doc) {
  return {
    id: String(doc._id),
    requestId: String(doc.requestId),
    serviceSlug: doc.serviceSlug,
    serviceTitle: doc.serviceTitle,
    title: doc.title,
    sortOrder: doc.sortOrder,
    completed: Boolean(doc.completed),
    completedAt: doc.completedAt ?? null,
    completedByName: doc.completedByName ?? '',
    publicComment: doc.publicComment ?? '',
    internalNote: doc.internalNote ?? '',
    issueDescription: doc.issueDescription ?? '',
    resolution: doc.resolution ?? '',
    attachmentUrl: doc.attachmentUrl ?? '',
    updatedAt: doc.updatedAt,
  };
}

function formatActivity(doc) {
  return {
    id: String(doc._id),
    eventType: doc.eventType,
    title: doc.title,
    description: doc.description ?? '',
    isPublic: Boolean(doc.isPublic),
    serviceSlug: doc.serviceSlug ?? '',
    createdByName: doc.createdByName ?? '',
    createdAt: doc.createdAt,
  };
}

async function nextTrackingId() {
  const year = new Date().getFullYear();
  const counter = await OnboardingIdCounter.findOneAndUpdate(
    { year },
    { $inc: { seq: 1 } },
    { upsert: true, new: true },
  );
  const seq = String(counter.seq).padStart(6, '0');
  return `ONB-${year}-${seq}`;
}

export async function logActivity(requestId, payload) {
  return OnboardingActivityLog.create({
    requestId,
    eventType: payload.eventType,
    title: payload.title,
    description: payload.description ?? '',
    isPublic: payload.isPublic !== false,
    serviceSlug: payload.serviceSlug ?? '',
    createdBy: payload.createdBy ?? null,
    createdByName: payload.createdByName ?? '',
  });
}

export async function recalculateProgress(requestId) {
  const [total, completed] = await Promise.all([
    OnboardingRequestTask.countDocuments({ requestId }),
    OnboardingRequestTask.countDocuments({ requestId, completed: true }),
  ]);
  const progressPercent = total === 0 ? 0 : Math.round((completed / total) * 100);
  const request = await OnboardingRequest.findById(requestId);
  if (!request) return { progressPercent, total, completed };

  request.progressPercent = progressPercent;
  if (progressPercent === 100 && request.status === 'in_progress') {
    request.status = 'completed';
    request.completedAt = new Date();
    await logActivity(requestId, {
      eventType: 'completed',
      title: 'Onboarding Completed',
      description: 'All onboarding tasks have been completed.',
      isPublic: true,
    });
    try {
      await sendOnboardingCompletedEmail({
        to: request.personal.email,
        ownerName: ownerName(request),
        locationName: request.location.locationName,
        trackingId: request.trackingId,
        trackingUrl: buildTrackingUrl(request.trackingToken),
      });
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error('[onboardingManagement] completion email failed', e);
    }
  }
  await request.save();
  return { progressPercent, total, completed, status: request.status };
}

export async function listAdminRequests(query) {
  const page = Math.max(1, Number(query.page) || 1);
  const pageSize = Math.min(
    MAX_TICKET_LIST_PAGE_SIZE,
    Math.max(1, Number(query.pageSize) || 20),
  );
  const sortField = ['createdAt', 'submittedAt', 'updatedAt', 'status'].includes(query.sort)
    ? query.sort
    : 'submittedAt';
  const order = query.order === 'asc' ? 1 : -1;

  const filter = { status: { $ne: 'draft' } };
  if (query.status && ONBOARDING_STATUSES.includes(query.status) && query.status !== 'draft') {
    filter.status = query.status;
  }
  if (query.service) {
    filter.selectedServices = String(query.service).toLowerCase().trim();
  }

  const search = typeof query.search === 'string' ? query.search.trim() : '';
  if (search) {
    const rx = new RegExp(escapeRegex(search), 'i');
    filter.$or = [
      { trackingId: rx },
      { 'location.locationName': rx },
      { 'personal.firstName': rx },
      { 'personal.lastName': rx },
      { 'personal.email': rx },
      { businessName: rx },
    ];
  }

  const [items, total] = await Promise.all([
    OnboardingRequest.find(filter)
      .sort({ [sortField]: order })
      .skip((page - 1) * pageSize)
      .limit(pageSize)
      .lean(),
    OnboardingRequest.countDocuments(filter),
  ]);

  return {
    requests: items.map(formatRequestRow),
    total,
    page,
    pageSize,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
  };
}

export async function getAdminRequestDetail(id) {
  if (!mongoose.Types.ObjectId.isValid(id)) {
    throw new AppError('Invalid onboarding request id', 400);
  }
  const request = await OnboardingRequest.findById(id).lean();
  if (!request || request.status === 'draft') {
    throw new AppError('Onboarding request not found', 404);
  }

  await syncServiceTemplates();
  const metaMap = await getActiveServiceMetaMap();

  let tasks = [];
  let services = [];
  let serviceSections = [];

  if (['in_progress', 'completed'].includes(request.status)) {
    await reconcileRequestTasks(id, request.selectedServices);
    await recalculateProgress(id);
    tasks = await OnboardingRequestTask.find({ requestId: id })
      .sort({ serviceSlug: 1, sortOrder: 1 })
      .lean();
    const grouped = buildServiceGroupsFromTasks(tasks, metaMap, formatTask);
    services = grouped.services;
    serviceSections = grouped.serviceSections;
  } else if (request.status === 'pending' && request.selectedServices?.length) {
    const preview = await buildPreviewServiceGroups(request.selectedServices, metaMap);
    services = preview.services;
    serviceSections = preview.serviceSections;
  }

  const [activities, refreshed] = await Promise.all([
    OnboardingActivityLog.find({ requestId: id }).sort({ createdAt: -1 }).lean(),
    OnboardingRequest.findById(id).lean(),
  ]);

  const reqDoc = refreshed ?? request;
  const progressTasks = tasks.length
    ? tasks
    : services.flatMap((s) => s.tasks);

  return {
    request: formatRequestRow(reqDoc),
    trackingUrl: reqDoc.trackingId ? buildTrackingUrl(reqDoc.trackingToken) : null,
    services,
    serviceSections,
    activities: activities.map(formatActivity),
    progress: {
      percent: reqDoc.progressPercent ?? 0,
      totalTasks: progressTasks.length,
      completedTasks: progressTasks.filter((t) => t.completed).length,
    },
  };
}

export async function approveRequest(id, reviewer) {
  const request = await OnboardingRequest.findById(id);
  if (!request) throw new AppError('Onboarding request not found', 404);
  if (request.status !== 'pending') {
    throw new AppError('Only pending requests can be approved', 409);
  }

  await syncServiceTemplates();

  request.trackingId = await nextTrackingId();
  request.trackingToken = crypto.randomBytes(32).toString('hex');
  request.status = 'in_progress';
  request.approvedAt = new Date();
  request.reviewedAt = new Date();
  request.reviewedBy = reviewer.id;
  request.reviewedByName = reviewer.name ?? 'Admin';
  request.progressPercent = 0;

  const loc = await locationService.createLocation({
    name: request.location.locationName,
    email: request.location.locationEmail,
    phone: request.location.locationPhone,
    address: request.location.address,
    city: request.location.city,
    state: request.location.state,
    zip: request.location.zip,
  });
  request.locationId = loc.id;

  const fullName = ownerName(request);
  const user = await userService.createUser({
    name: fullName,
    email: request.personal.email,
    role: 'partner',
    locationId: loc.id,
    sendInvite: true,
  });
  request.userId = user.id;

  await request.save();

  await OnboardingRequestTask.deleteMany({ requestId: request._id });
  await instantiateRequestTasks(request._id, request.selectedServices);

  const trackingUrl = buildTrackingUrl(request.trackingToken);

  await logActivity(request._id, {
    eventType: 'approved',
    title: 'Request Approved',
    description: `Onboarding approved by ${reviewer.name ?? 'admin'}.`,
    isPublic: true,
    createdBy: reviewer.id,
    createdByName: reviewer.name ?? '',
  });
  await logActivity(request._id, {
    eventType: 'tracking_generated',
    title: 'Tracking Link Generated',
    description: `Tracking ID ${request.trackingId} assigned.`,
    isPublic: false,
    createdBy: reviewer.id,
    createdByName: reviewer.name ?? '',
  });

  try {
    await sendOnboardingApprovalEmail({
      to: request.personal.email,
      ownerName: fullName,
      locationName: request.location.locationName,
      trackingId: request.trackingId,
      trackingUrl,
    });
    await logActivity(request._id, {
      eventType: 'email_sent',
      title: 'Approval Email Sent',
      description: 'Customer notified with tracking link.',
      isPublic: false,
    });
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error('[onboardingManagement] approval email failed', e);
  }

  return getAdminRequestDetail(String(request._id));
}

export async function rejectRequest(id, reviewer, reviewNotes = '') {
  const request = await OnboardingRequest.findById(id);
  if (!request) throw new AppError('Onboarding request not found', 404);
  if (request.status !== 'pending') {
    throw new AppError('Only pending requests can be rejected', 409);
  }
  request.status = 'rejected';
  request.reviewNotes = reviewNotes.trim();
  request.reviewedAt = new Date();
  request.reviewedBy = reviewer.id;
  request.reviewedByName = reviewer.name ?? 'Admin';
  await request.save();
  await logActivity(request._id, {
    eventType: 'rejected',
    title: 'Request Rejected',
    description: reviewNotes.trim() || 'Request was rejected.',
    isPublic: false,
    createdBy: reviewer.id,
    createdByName: reviewer.name ?? '',
  });
  return { request: formatRequestRow(request) };
}

export async function updateRequestTask(requestId, taskId, patch, reviewer) {
  const task = await OnboardingRequestTask.findOne({
    _id: taskId,
    requestId,
  });
  if (!task) throw new AppError('Task not found', 404);

  const request = await OnboardingRequest.findById(requestId);
  if (!request) throw new AppError('Onboarding request not found', 404);
  if (!['in_progress', 'completed'].includes(request.status)) {
    throw new AppError('Tasks can only be updated for active onboardings', 409);
  }

  const prevCompleted = task.completed;
  const prevPublicComment = task.publicComment;

  if (patch.completed !== undefined) {
    task.completed = Boolean(patch.completed);
    if (task.completed) {
      task.completedAt = new Date();
      task.completedBy = reviewer.id;
      task.completedByName = reviewer.name ?? '';
    } else {
      task.completedAt = null;
      task.completedBy = null;
      task.completedByName = '';
    }
  }
  if (patch.publicComment !== undefined) task.publicComment = String(patch.publicComment).trim();
  if (patch.internalNote !== undefined) task.internalNote = String(patch.internalNote).trim();
  if (patch.issueDescription !== undefined) task.issueDescription = String(patch.issueDescription).trim();
  if (patch.resolution !== undefined) task.resolution = String(patch.resolution).trim();
  if (patch.attachmentUrl !== undefined) task.attachmentUrl = String(patch.attachmentUrl).trim();

  await task.save();

  if (patch.completed === true && !prevCompleted) {
    await logActivity(requestId, {
      eventType: 'task_completed',
      title: `${task.serviceTitle}: ${task.title}`,
      description: 'Task marked complete.',
      isPublic: true,
      serviceSlug: task.serviceSlug,
      createdBy: reviewer.id,
      createdByName: reviewer.name ?? '',
    });
    if (request.personal?.email) {
      try {
        await sendOnboardingMilestoneEmail({
          to: request.personal.email,
          ownerName: ownerName(request),
          locationName: request.location.locationName,
          milestone: `${task.serviceTitle} — ${task.title}`,
          trackingUrl: buildTrackingUrl(request.trackingToken),
        });
      } catch (e) {
        // eslint-disable-next-line no-console
        console.error('[onboardingManagement] milestone email failed', e);
      }
    }
  }

  if (
    patch.publicComment !== undefined
    && patch.publicComment.trim()
    && patch.publicComment.trim() !== prevPublicComment
  ) {
    await logActivity(requestId, {
      eventType: 'public_comment',
      title: `Comment on ${task.title}`,
      description: patch.publicComment.trim(),
      isPublic: true,
      serviceSlug: task.serviceSlug,
      createdBy: reviewer.id,
      createdByName: reviewer.name ?? '',
    });
    if (request.personal?.email) {
      try {
        await sendOnboardingPublicCommentEmail({
          to: request.personal.email,
          ownerName: ownerName(request),
          taskTitle: task.title,
          comment: patch.publicComment.trim(),
          trackingUrl: buildTrackingUrl(request.trackingToken),
        });
      } catch (e) {
        // eslint-disable-next-line no-console
        console.error('[onboardingManagement] comment email failed', e);
      }
    }
  }

  const progress = await recalculateProgress(requestId);
  return {
    task: formatTask(task),
    progress,
  };
}

export async function getPublicTracking(token) {
  const request = await OnboardingRequest.findOne({
    trackingToken: token.trim(),
    status: { $in: ['pending', 'in_progress', 'completed', 'rejected'] },
  }).lean();
  if (!request) throw new AppError('Onboarding not found', 404);

  await syncServiceTemplates();
  const metaMap = await getActiveServiceMetaMap();
  const isApproved = ['in_progress', 'completed'].includes(request.status);

  let tasks = [];
  let services = [];
  let serviceSections = [];

  if (isApproved) {
    await reconcileRequestTasks(request._id, request.selectedServices);
    await recalculateProgress(request._id);
    tasks = await OnboardingRequestTask.find({ requestId: request._id })
      .sort({ serviceSlug: 1, sortOrder: 1 })
      .lean();
    const grouped = buildServiceGroupsFromTasks(tasks, metaMap, (task) => ({
      id: String(task._id),
      title: task.title,
      completed: Boolean(task.completed),
      completedAt: task.completedAt ?? null,
      publicComment: task.publicComment ?? '',
    }));
    services = grouped.services;
    serviceSections = grouped.serviceSections;
  } else if (request.status === 'pending' && request.selectedServices?.length) {
    const preview = await buildPreviewServiceGroups(request.selectedServices, metaMap);
    services = preview.services.map((svc) => ({
      ...svc,
      tasks: svc.tasks.map((t) => ({
        id: t.id,
        title: t.title,
        completed: false,
        completedAt: null,
        publicComment: '',
      })),
    }));
    serviceSections = preview.serviceSections.map((sec) => ({
      title: sec.title,
      services: sec.services.map((svc) => ({
        ...svc,
        tasks: svc.tasks.map((t) => ({
          id: t.id,
          title: t.title,
          completed: false,
          completedAt: null,
          publicComment: '',
        })),
      })),
    }));
  }

  const activities = await OnboardingActivityLog.find({
    requestId: request._id,
    isPublic: true,
  })
    .sort({ createdAt: -1 })
    .lean();

  const totalTasks = tasks.length;
  const completedTasks = tasks.filter((t) => t.completed).length;
  const refreshed = await OnboardingRequest.findById(request._id).lean();
  const progressPercent = refreshed?.progressPercent ?? (totalTasks
    ? Math.round((completedTasks / totalTasks) * 100)
    : 0);

  return {
    request: {
      trackingId: request.trackingId ?? null,
      status: request.status,
      locationName: request.location.locationName,
      businessName: request.businessName || request.location.locationName,
      ownerName: ownerName(request),
      progressPercent,
      lastUpdated: refreshed?.updatedAt ?? request.updatedAt,
      submittedAt: request.submittedAt ?? request.createdAt,
      approvedAt: request.approvedAt ?? null,
    },
    services,
    serviceSections,
    activities: activities.map(formatActivity),
    progress: { percent: progressPercent, totalTasks, completedTasks },
  };
}

export { buildTrackingUrl, formatRequestRow };
