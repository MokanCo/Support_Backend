import crypto from 'crypto';
import OnboardingRequest from '../models/OnboardingRequest.js';
import Location from '../models/Location.js';
import { recalculateProgress, logActivity } from './onboardingManagementService.js';
import * as locationService from './locationService.js';
import * as userService from './userService.js';

function openingDateReached(openingDate) {
  if (!openingDate) return false;
  const opening = new Date(openingDate);
  if (Number.isNaN(opening.getTime())) return false;
  const today = new Date();
  today.setHours(23, 59, 59, 999);
  return opening <= today;
}

function ownerName(req) {
  return `${req.personal?.firstName ?? ''} ${req.personal?.lastName ?? ''}`.trim();
}

async function ensureTrackingToken(req) {
  if (req.trackingToken) return;
  const token = crypto.randomBytes(24).toString('hex');
  await OnboardingRequest.updateOne(
    { _id: req._id, $or: [{ trackingToken: null }, { trackingToken: { $exists: false } }, { trackingToken: '' }] },
    { $set: { trackingToken: token } },
  );
  req.trackingToken = token;
}

async function ensureLocation(req) {
  let locationId = req.locationId ? String(req.locationId) : null;
  if (locationId) {
    const existing = await Location.findById(locationId).select('_id').lean();
    if (existing) return locationId;
    // Stale reference — clear and recreate below
    locationId = null;
  }

  const loc = await locationService.createLocation({
    name: req.location.locationName,
    email: req.location.locationEmail,
    phone: req.location.locationPhone,
    address: req.location.address,
    city: req.location.city,
    state: req.location.state,
    zip: req.location.zip,
  });
  locationId = loc.id;
  await OnboardingRequest.updateOne({ _id: req._id }, { $set: { locationId } });
  req.locationId = locationId;
  return locationId;
}

export async function runOpeningDateJobs() {
  const requests = await OnboardingRequest.find({ status: { $in: ['in_progress', 'completed'] } });

  let processed = 0;
  let errors = 0;

  for (const req of requests) {
    if (!openingDateReached(req.location?.openingDate)) continue;
    try {
      await ensureTrackingToken(req);
      await recalculateProgress(req._id);

      let locationId = req.locationId ? String(req.locationId) : null;
      let userId = req.userId ? String(req.userId) : null;
      let provisioned = false;

      if (!locationId || !userId) {
        locationId = await ensureLocation(req);

        if (!userId) {
          const email = req.personal.email.toLowerCase().trim();
          const user = await userService.createUser({
            name: ownerName(req),
            email,
            role: 'partner',
            locationId,
            sendInvite: true,
          });
          userId = user.id;
          await OnboardingRequest.updateOne({ _id: req._id }, { $set: { userId } });
          req.userId = userId;
        }

        provisioned = true;
      } else {
        // Primary already set — still verify location exists for additional partners
        locationId = await ensureLocation(req);
      }

      if (provisioned) {
        await logActivity(req._id, {
          eventType: 'provisioned',
          title: 'Location & User Created',
          description: 'Portal access auto-provisioned on opening date.',
          isPublic: true,
        });
      }

      if (locationId && Array.isArray(req.additionalPartners) && req.additionalPartners.length > 0) {
        for (const ap of req.additionalPartners) {
          const apEmail = ap?.email?.toLowerCase().trim();
          if (!apEmail) continue;
          try {
            await userService.createUser({
              name: `${ap.firstName ?? ''} ${ap.lastName ?? ''}`.trim() || apEmail,
              email: apEmail,
              role: 'partner',
              locationId,
              sendInvite: true,
            });
          } catch (apErr) {
            // 409 = already created on a prior scheduler run — safe to skip
            if (apErr?.statusCode !== 409) {
              // eslint-disable-next-line no-console
              console.error(`[scheduler] additional partner ${apEmail} failed:`, apErr?.message ?? apErr);
            }
          }
        }
      }

      processed++;
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error(`[scheduler] job failed for ${req._id}:`, e?.message ?? e);
      errors++;
    }
  }

  return { processed, errors };
}
