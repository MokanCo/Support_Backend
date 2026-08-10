import ArRecurringTemplate from '../../models/ArRecurringTemplate.js';
import ArInvoice from '../../models/ArInvoice.js';
import ArBillingProfile from '../../models/ArBillingProfile.js';
import ArJobRun from '../../models/ArJobRun.js';
import Location from '../../models/Location.js';
import { generateFromTemplate } from './arRecurringService.js';
import { sendInvoiceEmail } from './arMailService.js';
import { pushTimeline, recalculateTotals } from './arInvoiceService.js';
import { getOrCreateSettings } from './arSettingsService.js';
import { generateStatement } from './arStatementService.js';
import { money } from './arAccess.js';

async function startJob(jobName) {
  return ArJobRun.create({ jobName, status: 'running', startedAt: new Date() });
}

async function finishJob(run, { processed = 0, success = 0, failure = 0, details = '', error = '' }) {
  run.status = error ? 'failed' : 'success';
  run.finishedAt = new Date();
  run.processedCount = processed;
  run.successCount = success;
  run.failureCount = failure;
  run.details = details;
  run.errorMessage = error;
  await run.save();
  return run;
}

function startOfDay(d = new Date()) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function endOfDay(d = new Date()) {
  const x = new Date(d);
  x.setHours(23, 59, 59, 999);
  return x;
}

/** Daily: generate invoices from due recurring templates. */
export async function runDailyInvoiceGeneration() {
  const run = await startJob('daily_invoice_generation');
  let processed = 0;
  let success = 0;
  let failure = 0;
  const todayEnd = endOfDay();

  try {
    const templates = await ArRecurringTemplate.find({
      isDeleted: { $ne: true },
      isActive: true,
      autoGenerate: true,
      nextRunDate: { $lte: todayEnd },
      $or: [{ endDate: null }, { endDate: { $gte: startOfDay() } }],
    });

    for (const tpl of templates) {
      processed += 1;
      try {
        // eslint-disable-next-line no-await-in-loop
        await generateFromTemplate(tpl);
        success += 1;
      } catch (e) {
        failure += 1;
        // eslint-disable-next-line no-console
        console.error('[arScheduler] generate failed', tpl._id, e?.message || e);
      }
    }
    await finishJob(run, { processed, success, failure, details: `templates=${templates.length}` });
  } catch (e) {
    await finishJob(run, {
      processed,
      success,
      failure,
      error: e?.message || String(e),
    });
  }
  return run;
}

/** Morning: send reminder emails based on due date offsets. */
export async function runReminderScheduler() {
  const run = await startJob('reminder_scheduler');
  const settings = await getOrCreateSettings();
  let processed = 0;
  let success = 0;
  let failure = 0;
  const today = startOfDay();

  try {
    const invoices = await ArInvoice.find({
      isDeleted: { $ne: true },
      status: { $in: ['sent', 'viewed', 'partially_paid', 'overdue'] },
      balanceDue: { $gt: 0 },
    });

    for (const inv of invoices) {
      processed += 1;
      try {
        // eslint-disable-next-line no-await-in-loop
        const profile = await ArBillingProfile.findOne({ locationId: inv.locationId }).lean();
        const reminderDays = profile?.reminderDays?.length
          ? profile.reminderDays
          : settings.defaultReminderDays;

        const due = startOfDay(inv.dueDate);
        const offsetDays = Math.round((today - due) / 86400000);
        if (!reminderDays.includes(offsetDays)) continue;
        if (inv.lastReminderDayOffset === offsetDays) continue;

        // eslint-disable-next-line no-await-in-loop
        const location = await Location.findById(inv.locationId).lean();
        const kind = offsetDays > 0 ? 'overdue' : 'reminder';
        // eslint-disable-next-line no-await-in-loop
        await sendInvoiceEmail({ invoice: inv, location, profile, kind });
        inv.lastReminderAt = new Date();
        inv.lastReminderDayOffset = offsetDays;
        pushTimeline(inv, {
          eventType: 'reminder_sent',
          title: 'Reminder Sent',
          description: `Reminder for day offset ${offsetDays}`,
          userName: 'System',
        });
        if (offsetDays > 0 && inv.status !== 'overdue' && inv.status !== 'partially_paid') {
          inv.status = 'overdue';
        }
        // eslint-disable-next-line no-await-in-loop
        await inv.save();
        success += 1;
      } catch (e) {
        failure += 1;
        // eslint-disable-next-line no-console
        console.error('[arScheduler] reminder failed', inv._id, e?.message || e);
      }
    }
    await finishJob(run, { processed, success, failure });
  } catch (e) {
    await finishJob(run, { processed, success, failure, error: e?.message || String(e) });
  }
  return run;
}

/** Nightly: apply late fees after grace period. */
export async function runLateFeeScheduler() {
  const run = await startJob('late_fee_scheduler');
  const settings = await getOrCreateSettings();
  let processed = 0;
  let success = 0;
  let failure = 0;
  const today = startOfDay();

  try {
    const invoices = await ArInvoice.find({
      isDeleted: { $ne: true },
      status: { $in: ['sent', 'viewed', 'partially_paid', 'overdue'] },
      balanceDue: { $gt: 0 },
      lateFeeAppliedAt: null,
    });

    for (const inv of invoices) {
      processed += 1;
      try {
        // eslint-disable-next-line no-await-in-loop
        const profile = await ArBillingProfile.findOne({ locationId: inv.locationId }).lean();
        const enabled = profile?.lateFeeEnabled ?? settings.lateFeeEnabled;
        if (!enabled) continue;

        const grace = Number(profile?.gracePeriodDays ?? settings.defaultGracePeriodDays) || 0;
        const due = startOfDay(inv.dueDate);
        const graceEnd = new Date(due);
        graceEnd.setDate(graceEnd.getDate() + grace);
        if (today <= graceEnd) continue;

        const feeType = profile?.lateFeeType || settings.lateFeeType || 'fixed';
        const feeAmt = Number(profile?.lateFeeAmount ?? settings.lateFeeAmount) || 0;
        let fee = feeType === 'percent' ? money((inv.balanceDue * feeAmt) / 100) : money(feeAmt);
        if (fee <= 0) continue;

        inv.lateFeeAmount = money(inv.lateFeeAmount + fee);
        inv.lateFeeAppliedAt = new Date();
        const totals = recalculateTotals(inv);
        Object.assign(inv, totals);
        inv.status = 'overdue';
        pushTimeline(inv, {
          eventType: 'late_fee',
          title: 'Late Fee Applied',
          description: `$${fee.toFixed(2)} late fee`,
          userName: 'System',
        });
        // eslint-disable-next-line no-await-in-loop
        await inv.save();

        // eslint-disable-next-line no-await-in-loop
        const location = await Location.findById(inv.locationId).lean();
        // eslint-disable-next-line no-await-in-loop
        await sendInvoiceEmail({ invoice: inv, location, profile, kind: 'late_fee' });
        success += 1;
      } catch (e) {
        failure += 1;
        // eslint-disable-next-line no-console
        console.error('[arScheduler] late fee failed', inv._id, e?.message || e);
      }
    }
    await finishJob(run, { processed, success, failure });
  } catch (e) {
    await finishJob(run, { processed, success, failure, error: e?.message || String(e) });
  }
  return run;
}

/** First of month: generate statements for all locations with AR activity. */
export async function runMonthlyStatementGenerator() {
  const run = await startJob('monthly_statement_generator');
  const now = new Date();
  if (now.getDate() !== 1) {
    await finishJob(run, { details: 'Skipped — not first of month' });
    return run;
  }

  let processed = 0;
  let success = 0;
  let failure = 0;
  const periodEnd = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59, 999);
  const periodStart = new Date(periodEnd.getFullYear(), periodEnd.getMonth(), 1);

  try {
    const locationIds = await ArInvoice.distinct('locationId', {
      isDeleted: { $ne: true },
      status: { $nin: ['draft', 'cancelled', 'void'] },
    });
    const actor = { id: null, name: 'System', role: 'admin' };

    for (const locationId of locationIds) {
      processed += 1;
      try {
        // eslint-disable-next-line no-await-in-loop
        const { statement } = await generateStatement(actor, {
          locationId: String(locationId),
          periodStart,
          periodEnd,
        });
        // eslint-disable-next-line no-await-in-loop
        const { emailStatement } = await import('./arStatementService.js');
        // eslint-disable-next-line no-await-in-loop
        await emailStatement(actor, statement.id);
        success += 1;
      } catch (e) {
        failure += 1;
        // eslint-disable-next-line no-console
        console.error('[arScheduler] statement failed', locationId, e?.message || e);
      }
    }
    await finishJob(run, { processed, success, failure });
  } catch (e) {
    await finishJob(run, { processed, success, failure, error: e?.message || String(e) });
  }
  return run;
}

/** Mark overdue invoices (status sync). */
export async function runOverdueStatusSync() {
  const today = startOfDay();
  const result = await ArInvoice.updateMany(
    {
      isDeleted: { $ne: true },
      status: { $in: ['sent', 'viewed'] },
      balanceDue: { $gt: 0 },
      dueDate: { $lt: today },
    },
    { $set: { status: 'overdue' } },
  );
  return { modified: result.modifiedCount || 0 };
}

let lastDailyKey = '';
let lastReminderKey = '';
let lastLateFeeKey = '';

/**
 * Lightweight tick called from server interval.
 * Runs each job at most once per calendar day (keyed by YYYY-MM-DD).
 */
export async function runArSchedulerTick() {
  const dayKey = new Date().toISOString().slice(0, 10);
  const hour = new Date().getHours();

  try {
    await runOverdueStatusSync();
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error('[arScheduler] overdue sync failed', e);
  }

  // Invoice generation — once per day after 01:00
  if (hour >= 1 && lastDailyKey !== dayKey) {
    lastDailyKey = dayKey;
    await runDailyInvoiceGeneration();
    await runMonthlyStatementGenerator();
  }

  // Reminders — once per day after 08:00
  if (hour >= 8 && lastReminderKey !== dayKey) {
    lastReminderKey = dayKey;
    await runReminderScheduler();
  }

  // Late fees — once per day after 22:00
  if (hour >= 22 && lastLateFeeKey !== dayKey) {
    lastLateFeeKey = dayKey;
    await runLateFeeScheduler();
  }
}
