/**
 * Daily scheduler: for any approved (in_progress) onboarding request whose opening
 * date has arrived, run recalculateProgress so the status is updated if all tasks
 * are already done. Location/user creation is admin-triggered via the Provision button.
 */
import OnboardingRequest from '../models/OnboardingRequest.js';
import { recalculateProgress } from './onboardingManagementService.js';

function openingDateReached(openingDate) {
  if (!openingDate) return false;
  const opening = new Date(openingDate);
  if (Number.isNaN(opening.getTime())) return false;
  const today = new Date();
  today.setHours(23, 59, 59, 999);
  return opening <= today;
}

export async function runOpeningDateJobs() {
  const requests = await OnboardingRequest.find({ status: 'in_progress' }).lean();

  let processed = 0;
  let errors = 0;

  for (const req of requests) {
    if (!openingDateReached(req.location?.openingDate)) continue;
    try {
      await recalculateProgress(req._id);
      processed++;
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error(`[scheduler] recalculate failed for ${req._id}:`, e?.message ?? e);
      errors++;
    }
  }

  return { processed, errors };
}
