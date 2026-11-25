import Location from '../models/Location.js';
import { BranchProfile } from '../models/receptionist.js';
import { AppError } from '../utils/AppError.js';
import { recordAudit } from './receptionistAuditService.js';
import { WEEKDAYS } from '../models/BranchPhoneNumber.js';

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

function addressOf(location) {
  return [location.address, [location.city, location.state].filter(Boolean).join(', '), location.zip]
    .map((part) => String(part ?? '').trim())
    .filter(Boolean)
    .join(', ');
}

function hoursOf(value) {
  const source = value && typeof value === 'object' ? value : {};
  const timezone = String(source.timezone ?? 'America/New_York').trim() || 'America/New_York';
  if (timezone.length > 80) throw new AppError('timezone is too long', 400);
  const rows = Array.isArray(source.schedule) ? source.schedule : [];
  const byDay = new Map();
  for (const row of rows) {
    if (!row || !WEEKDAYS.includes(row.day)) throw new AppError('schedule day is invalid', 400);
    if (byDay.has(row.day)) throw new AppError('schedule days must be unique', 400);
    const closed = Boolean(row.closed);
    const open = closed ? '' : String(row.open ?? '').trim();
    const close = closed ? '' : String(row.close ?? '').trim();
    if (open && !TIME_RE.test(open)) throw new AppError(`${row.day} open must be HH:mm`, 400);
    if (close && !TIME_RE.test(close)) throw new AppError(`${row.day} close must be HH:mm`, 400);
    if (!closed && open && close && open >= close) {
      throw new AppError(`${row.day} opening time must be before closing time`, 400);
    }
    byDay.set(row.day, { day: row.day, closed, open, close });
  }
  return {
    timezone,
    schedule: WEEKDAYS.map((day) => byDay.get(day) ?? { day, closed: false, open: '', close: '' }),
  };
}

function format(location, profile) {
  const hours = profile?.openingHours;
  return {
    locationId: String(location._id ?? location.id),
    name: location.name,
    address: addressOf(location),
    phone: location.phone ?? '',
    email: location.email ?? '',
    isDisabled: Boolean(location.isDisabled),
    openingHours: hoursOf(hours),
    holidayHours: profile?.holidayHours ?? '',
    services: profile?.services ?? '',
    policies: profile?.policies ?? '',
    faqs: profile?.faqs ?? '',
    updatedAt: profile?.updatedAt ?? null,
  };
}

export async function listBranchInfo(query) {
  const search = typeof query.search === 'string' ? query.search.trim() : '';
  const filter = {};
  if (search) {
    const rx = new RegExp(search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    filter.$or = [{ name: rx }, { phone: rx }, { address: rx }, { city: rx }, { email: rx }];
  }
  const locations = await Location.find(filter).sort({ name: 1 }).limit(200).lean();
  const profiles = await BranchProfile.find({
    locationId: { $in: locations.map((location) => location._id) },
  }).lean();
  const byId = new Map(profiles.map((profile) => [String(profile.locationId), profile]));
  return {
    branches: locations.map((location) => format(location, byId.get(String(location._id)))),
  };
}

export async function getBranchInfo(locationId) {
  const location = await Location.findById(locationId).lean();
  if (!location) throw new AppError('Branch not found', 404);
  const profile = await BranchProfile.findOne({ locationId: location._id }).lean();
  return format(location, profile);
}

export async function saveBranchInfo(locationId, input, user) {
  const location = await Location.findById(locationId);
  if (!location) throw new AppError('Branch not found', 404);
  const doc =
    (await BranchProfile.findOne({ locationId: location._id })) ||
    new BranchProfile({ locationId: location._id });
  if (input.openingHours !== undefined) doc.openingHours = hoursOf(input.openingHours);
  if (input.holidayHours !== undefined) doc.holidayHours = String(input.holidayHours ?? '').slice(0, 2000);
  if (input.services !== undefined) doc.services = String(input.services ?? '').slice(0, 4000);
  if (input.policies !== undefined) doc.policies = String(input.policies ?? '').slice(0, 4000);
  if (input.faqs !== undefined) doc.faqs = String(input.faqs ?? '').slice(0, 8000);
  doc.updatedBy = user?.id ?? null;
  await doc.save();
  await recordAudit(user, 'update', 'branch-profile', doc._id, location._id);
  return format(location, doc);
}
