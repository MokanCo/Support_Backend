import crypto from 'crypto';
import OnboardingConfig from '../models/OnboardingConfig.js';
import OnboardingServiceOption from '../models/OnboardingServiceOption.js';
import OnboardingRequest, { ONBOARDING_STATUSES } from '../models/OnboardingRequest.js';
import { AppError } from '../utils/AppError.js';
import {
  sendOnboardingAdminNewRequestEmail,
} from './onboardingMailService.js';
import { logActivity, buildTrackingUrl as mgmtTrackingUrl } from './onboardingManagementService.js';
import { createOnboardingNewRequestNotification } from './notificationService.js';

function formatConfig(doc) {
  const subtitles = doc.stepSubtitles instanceof Map
    ? Object.fromEntries(doc.stepSubtitles)
    : doc.stepSubtitles || {};
  return {
    brandName: doc.brandName,
    welcomeTitle: doc.welcomeTitle,
    welcomeDescription: doc.welcomeDescription,
    wizardTitle: doc.wizardTitle,
    wizardSidebarTitle: doc.wizardSidebarTitle,
    wizardSidebarDescription: doc.wizardSidebarDescription,
    stepLabels: doc.stepLabels,
    welcomeSteps: doc.welcomeSteps,
    stepSubtitles: subtitles,
    successTitle: doc.successTitle,
    successDescription: doc.successDescription,
    successEmailNote: doc.successEmailNote,
    enabled: doc.enabled,
    updatedAt: doc.updatedAt,
  };
}

function formatServiceOption(doc) {
  return {
    id: String(doc._id),
    slug: doc.slug,
    title: doc.title,
    section: doc.section,
    iconKey: doc.iconKey,
    iconClass: doc.iconClass,
    sortOrder: doc.sortOrder,
    isActive: doc.isActive,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  };
}

function formatRequest(doc) {
  const d = doc && typeof doc.toObject === 'function' ? doc.toObject() : doc;
  return {
    id: String(d._id),
    trackingId: d.trackingId ?? null,
    trackingToken: d.trackingToken,
    status: d.status,
    personal: d.personal,
    location: d.location,
    businessName: d.businessName ?? '',
    website: d.website ?? '',
    notes: d.notes ?? '',
    selectedServices: d.selectedServices,
    submittedAt: d.submittedAt ?? null,
    progressPercent: d.progressPercent ?? 0,
    reviewNotes: d.reviewNotes || '',
    reviewedBy: d.reviewedBy ? String(d.reviewedBy) : null,
    reviewedByName: d.reviewedByName ?? '',
    reviewedAt: d.reviewedAt || null,
    approvedAt: d.approvedAt ?? null,
    completedAt: d.completedAt ?? null,
    locationId: d.locationId ? String(d.locationId) : null,
    userId: d.userId ? String(d.userId) : null,
    createdAt: d.createdAt,
    updatedAt: d.updatedAt,
  };
}

function buildSectionsFromOptions(options) {
  const sections = [];
  const sectionMap = new Map();
  for (const opt of options) {
    if (!sectionMap.has(opt.section)) {
      const section = { title: opt.section, services: [] };
      sectionMap.set(opt.section, section);
      sections.push(section);
    }
    sectionMap.get(opt.section).services.push({
      id: opt.slug,
      slug: opt.slug,
      title: opt.title,
      section: opt.section,
      iconKey: opt.iconKey,
      iconClass: opt.iconClass,
    });
  }
  return sections;
}

function normalizePersonal(input) {
  return {
    firstName: input.firstName.trim(),
    lastName: input.lastName.trim(),
    email: input.email.toLowerCase().trim(),
    phone: input.phone.trim(),
    address: input.address.trim(),
    city: (input.city || '').trim(),
    state: (input.state || '').trim(),
    zip: (input.zip || '').trim(),
  };
}

function normalizeLocation(input) {
  return {
    locationName: input.locationName.trim(),
    locationEmail: input.locationEmail.toLowerCase().trim(),
    locationPhone: input.locationPhone.trim(),
    openingDate: input.openingDate.trim(),
    address: input.address.trim(),
    city: (input.city || '').trim(),
    state: (input.state || '').trim(),
    zip: (input.zip || '').trim(),
  };
}

function buildTrackingUrl(token) {
  return mgmtTrackingUrl(token);
}

async function getActiveConfig() {
  const config = await OnboardingConfig.findOne({ key: 'default' });
  if (!config) {
    throw new AppError('Onboarding is not configured yet', 503);
  }
  if (!config.enabled) {
    throw new AppError('Onboarding is currently unavailable', 503);
  }
  return config;
}

export async function getPublicConfig() {
  const config = await getActiveConfig();
  return { config: formatConfig(config) };
}

export async function updateConfig(patch) {
  let config = await OnboardingConfig.findOne({ key: 'default' });
  if (!config) {
    config = new OnboardingConfig({ key: 'default' });
  }
  const allowed = [
    'brandName',
    'welcomeTitle',
    'welcomeDescription',
    'wizardTitle',
    'wizardSidebarTitle',
    'wizardSidebarDescription',
    'stepLabels',
    'welcomeSteps',
    'stepSubtitles',
    'successTitle',
    'successDescription',
    'successEmailNote',
    'enabled',
  ];
  for (const key of allowed) {
    if (patch[key] !== undefined) {
      if (key === 'stepSubtitles' && patch[key] && typeof patch[key] === 'object') {
        config.stepSubtitles = new Map(Object.entries(patch[key]));
      } else {
        config[key] = patch[key];
      }
    }
  }
  await config.save();
  return { config: formatConfig(config) };
}

export async function listPublicServices() {
  const options = await OnboardingServiceOption.find({ isActive: true })
    .sort({ section: 1, sortOrder: 1, title: 1 })
    .lean();
  return { sections: buildSectionsFromOptions(options) };
}

export async function listAllServices() {
  const options = await OnboardingServiceOption.find()
    .sort({ section: 1, sortOrder: 1, title: 1 })
    .lean();
  return { services: options.map(formatServiceOption) };
}

export async function createServiceOption(input) {
  const slug = input.slug.toLowerCase().trim();
  const exists = await OnboardingServiceOption.findOne({ slug });
  if (exists) {
    throw new AppError('Service slug already exists', 409);
  }
  const doc = await OnboardingServiceOption.create({
    slug,
    title: input.title.trim(),
    section: input.section.trim(),
    iconKey: input.iconKey.trim(),
    iconClass: input.iconClass.trim(),
    sortOrder: Number(input.sortOrder) || 0,
    isActive: input.isActive !== false,
  });
  return { service: formatServiceOption(doc) };
}

export async function updateServiceOption(id, patch) {
  const doc = await OnboardingServiceOption.findById(id);
  if (!doc) {
    throw new AppError('Service option not found', 404);
  }
  if (patch.slug !== undefined) {
    const slug = patch.slug.toLowerCase().trim();
    const taken = await OnboardingServiceOption.findOne({ slug, _id: { $ne: doc._id } });
    if (taken) {
      throw new AppError('Service slug already exists', 409);
    }
    doc.slug = slug;
  }
  if (patch.title !== undefined) doc.title = patch.title.trim();
  if (patch.section !== undefined) doc.section = patch.section.trim();
  if (patch.iconKey !== undefined) doc.iconKey = patch.iconKey.trim();
  if (patch.iconClass !== undefined) doc.iconClass = patch.iconClass.trim();
  if (patch.sortOrder !== undefined) doc.sortOrder = Number(patch.sortOrder) || 0;
  if (patch.isActive !== undefined) doc.isActive = Boolean(patch.isActive);
  await doc.save();
  return { service: formatServiceOption(doc) };
}

export async function deleteServiceOption(id) {
  const doc = await OnboardingServiceOption.findByIdAndDelete(id);
  if (!doc) {
    throw new AppError('Service option not found', 404);
  }
  return { ok: true };
}

async function validateSelectedServices(slugs, { allowEmpty = false } = {}) {
  const unique = [...new Set(slugs.map((s) => String(s).toLowerCase().trim()).filter(Boolean))];
  if (unique.length === 0) {
    if (allowEmpty) return [];
    throw new AppError('At least one service must be selected', 400);
  }
  const found = await OnboardingServiceOption.find({
    slug: { $in: unique },
    isActive: true,
  }).lean();
  if (found.length !== unique.length) {
    throw new AppError('One or more selected services are invalid', 400);
  }
  return unique;
}

async function findDraftByToken(token) {
  const request = await OnboardingRequest.findOne({
    trackingToken: token.trim(),
    status: 'draft',
  });
  if (!request) {
    throw new AppError('Draft onboarding request not found', 404);
  }
  return request;
}

/**
 * Create or refresh a draft request when the user enters the Services step.
 */
export async function createOrUpdateDraftRequest(input) {
  const config = await getActiveConfig();
  if (!config.enabled) {
    throw new AppError('Onboarding is currently unavailable', 503);
  }

  const personal = normalizePersonal(input.personal);
  const location = normalizeLocation(input.location);
  const additionalPartners = Array.isArray(input.additionalPartners)
    ? input.additionalPartners.map(normalizePersonal)
    : [];

  if (input.trackingToken) {
    const existing = await OnboardingRequest.findOne({
      trackingToken: input.trackingToken.trim(),
      status: 'draft',
    });
    if (existing) {
      existing.personal = personal;
      existing.additionalPartners = additionalPartners;
      existing.location = location;
      await existing.save();
      return {
        request: formatRequest(existing),
        trackingToken: existing.trackingToken,
      };
    }
  }

  const trackingToken = crypto.randomBytes(24).toString('hex');
  const request = await OnboardingRequest.create({
    trackingToken,
    status: 'draft',
    personal,
    additionalPartners,
    location,
    selectedServices: [],
  });

  return {
    request: formatRequest(request),
    trackingToken: request.trackingToken,
  };
}

/**
 * Save service selections immediately when the user toggles a service.
 */
export async function updateDraftServices(token, selectedServices) {
  const validated = await validateSelectedServices(selectedServices, { allowEmpty: true });
  const request = await OnboardingRequest.findOneAndUpdate(
    { trackingToken: token.trim(), status: 'draft' },
    { $set: { selectedServices: validated } },
    { new: true },
  );
  if (!request) {
    throw new AppError('Draft onboarding request not found', 404);
  }
  return { request: formatRequest(request) };
}

/**
 * Finalize a draft into a pending request (Confirm step).
 */
export async function finalizeOnboardingRequest(token) {
  const request = await findDraftByToken(token);
  const selectedServices = await validateSelectedServices(request.selectedServices);
  request.selectedServices = selectedServices;
  request.status = 'pending';
  request.submittedAt = new Date();
  await request.save();

  const ownerName = `${request.personal.firstName} ${request.personal.lastName}`.trim();
  const base = (process.env.APP_URL || process.env.FRONTEND_URL || '').replace(/\/$/, '');
  const reviewUrl = base
    ? `${base}/dashboard/onboardings/view?id=${encodeURIComponent(String(request._id))}`
    : '';

  await logActivity(request._id, {
    eventType: 'submitted',
    title: 'Request Submitted',
    description: 'Onboarding request submitted for review.',
    isPublic: true,
  });

  try {
    await sendOnboardingAdminNewRequestEmail({
      ownerName,
      locationName: request.location.locationName,
      email: request.personal.email,
      phone: request.personal.phone,
      services: request.selectedServices,
      reviewUrl,
    });
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error('[onboardingService] admin notification failed', e);
  }

  try {
    await createOnboardingNewRequestNotification({
      requestId: String(request._id),
      locationName: request.location.locationName,
      ownerName,
    });
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error('[onboardingService] onboarding socket notification failed', e);
  }

  return {
    request: formatRequest(request),
    message: 'Onboarding request submitted successfully. You will receive a tracking link once approved.',
  };
}

/**
 * @param {{
 *   personal: Record<string, string>;
 *   location: Record<string, string>;
 *   selectedServices: string[];
 * }} input
 */
export async function submitOnboardingRequest(input) {
  const config = await getActiveConfig();
  if (!config.enabled) {
    throw new AppError('Onboarding is currently unavailable', 503);
  }

  if (input.trackingToken) {
    return finalizeOnboardingRequest(input.trackingToken);
  }

  const selectedServices = await validateSelectedServices(input.selectedServices);
  const trackingToken = crypto.randomBytes(24).toString('hex');

  const request = await OnboardingRequest.create({
    trackingToken,
    status: 'pending',
    personal: normalizePersonal(input.personal),
    location: normalizeLocation(input.location),
    selectedServices,
    submittedAt: new Date(),
    notes: (input.notes || '').trim(),
    businessName: (input.businessName || '').trim(),
    website: (input.website || '').trim(),
  });

  const ownerName = `${request.personal.firstName} ${request.personal.lastName}`.trim();
  const base = (process.env.APP_URL || process.env.FRONTEND_URL || '').replace(/\/$/, '');
  const reviewUrl = base
    ? `${base}/dashboard/onboardings/view?id=${encodeURIComponent(String(request._id))}`
    : '';

  await logActivity(request._id, {
    eventType: 'submitted',
    title: 'Request Submitted',
    description: 'Onboarding request submitted for review.',
    isPublic: true,
  });

  try {
    await sendOnboardingAdminNewRequestEmail({
      ownerName,
      locationName: request.location.locationName,
      email: request.personal.email,
      phone: request.personal.phone,
      services: request.selectedServices,
      reviewUrl,
    });
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error('[onboardingService] admin notification failed', e);
  }

  try {
    await createOnboardingNewRequestNotification({
      requestId: String(request._id),
      locationName: request.location.locationName,
      ownerName,
    });
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error('[onboardingService] onboarding socket notification failed', e);
  }

  return {
    request: formatRequest(request),
    message: 'Onboarding request submitted successfully. You will receive a tracking link once approved.',
  };
}

export async function trackOnboardingRequest(token) {
  const { getPublicTracking } = await import('./onboardingManagementService.js');
  return getPublicTracking(token);
}

export async function listOnboardingRequests(query) {
  const { listAdminRequests } = await import('./onboardingManagementService.js');
  return listAdminRequests(query);
}

export async function getOnboardingRequestById(id) {
  const { getAdminRequestDetail } = await import('./onboardingManagementService.js');
  return getAdminRequestDetail(id);
}

export async function reviewOnboardingRequest(id, patch, reviewer) {
  const { approveRequest, rejectRequest } = await import('./onboardingManagementService.js');
  if (patch.status === 'approved' || patch.status === 'in_progress') {
    return approveRequest(id, reviewer);
  }
  if (patch.status === 'rejected') {
    return rejectRequest(id, reviewer, patch.reviewNotes);
  }
  throw new AppError('status must be approved or rejected', 400);
}

export { ONBOARDING_STATUSES };
