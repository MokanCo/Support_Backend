import OnboardingRequest from '../models/OnboardingRequest.js';
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

export async function runOpeningDateJobs() {
  const requests = await OnboardingRequest.find({ status: { $in: ['in_progress', 'completed'] } });

  let processed = 0;
  let errors = 0;

  for (const req of requests) {
    if (!openingDateReached(req.location?.openingDate)) continue;
    try {
      await recalculateProgress(req._id);

      // Auto-create location and primary user if not already provisioned
      if (!req.locationId || !req.userId) {
        let locationId = req.locationId ? String(req.locationId) : null;
        let userId = req.userId ? String(req.userId) : null;

        if (!locationId) {
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
          req.locationId = locationId;
          await req.save(); // persist locationId immediately so re-runs don't create a second location
        }

        if (!userId) {
          const email = req.personal.email.toLowerCase().trim();
          const user = await userService.createUser({
            name: ownerName(req),
            email,
            role: 'partner',
            locationId,
            sendInvite: true,
          });
          req.userId = user.id;
          await req.save();
        }

        await logActivity(req._id, {
          eventType: 'provisioned',
          title: 'Location & User Created',
          description: 'Portal access auto-provisioned on opening date.',
          isPublic: true,
        });
      }

      // Always provision additional partners as long as locationId is known
      // (runs independently so it works even if primary user was created in a prior run)
      const locationId = req.locationId ? String(req.locationId) : null;
      if (locationId && Array.isArray(req.additionalPartners) && req.additionalPartners.length > 0) {
        for (const ap of req.additionalPartners) {
          const apEmail = ap?.email?.toLowerCase().trim();
          if (!apEmail) continue;
          await userService.createUser({
            name: `${ap.firstName ?? ''} ${ap.lastName ?? ''}`.trim(),
            email: apEmail,
            role: 'partner',
            locationId,
            sendInvite: true,
          });
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
