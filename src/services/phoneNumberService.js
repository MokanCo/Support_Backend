import BranchPhoneNumber, {
  FORWARD_MODES,
  FORWARDING_STATUSES,
  PHONE_PROVIDERS,
  WEEKDAYS,
} from '../models/BranchPhoneNumber.js';
import Location from '../models/Location.js';
import { AppError } from '../utils/AppError.js';
import { bandwidthConfigured } from './bandwidthAuth.js';
import { MAX_TICKET_LIST_PAGE_SIZE } from '../constants/pagination.js';

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const SIP_RE = /^(sips?:)?[^\s@]+@[^\s@]+$/i;
const LIST_SORT_FIELDS = ['createdAt', 'updatedAt', 'existingPhoneNumber', 'aiEnabled'];

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function normalizePhoneDigits(value) {
  return String(value ?? '').replace(/\D/g, '');
}

function requirePhone(value, label) {
  const raw = String(value ?? '').trim();
  const digits = normalizePhoneDigits(raw);
  if (!raw || digits.length < 10 || digits.length > 15) {
    throw new AppError(`${label} must contain 10 to 15 digits`, 400);
  }
  const e164 = digits.length === 10 ? `+1${digits}` : `+${digits}`;
  return { raw: e164, digits: normalizePhoneDigits(e164) };
}

function optionalPhone(value, label) {
  const raw = String(value ?? '').trim();
  if (!raw) return '';
  return requirePhone(raw, label).raw;
}

function applyProvider(input) {
  const provider = input.provider ?? 'unknown';
  if (!PHONE_PROVIDERS.includes(provider)) {
    throw new AppError('provider is invalid', 400);
  }
  const providerLabel = String(input.providerLabel ?? '').trim().slice(0, 80);
  if (provider === 'other' && !providerLabel) {
    throw new AppError('providerLabel is required when provider is other', 400);
  }
  return {
    provider,
    providerLabel: provider === 'other' ? providerLabel : '',
  };
}

function applyHours(input) {
  const source = input && typeof input === 'object' ? input : {};
  const timezone = String(source.timezone ?? 'America/New_York').trim() || 'America/New_York';
  if (timezone.length > 80) {
    throw new AppError('timezone is too long', 400);
  }
  const byDay = new Map();
  const rows = Array.isArray(source.schedule) ? source.schedule : [];
  for (const row of rows) {
    if (!row || !WEEKDAYS.includes(row.day)) {
      throw new AppError('schedule day is invalid', 400);
    }
    if (byDay.has(row.day)) {
      throw new AppError('schedule days must be unique', 400);
    }
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
    schedule: WEEKDAYS.map(
      (day) => byDay.get(day) ?? { day, closed: false, open: '', close: '' },
    ),
  };
}

function applyForwarding(input) {
  const source = input && typeof input === 'object' ? input : {};
  if (source.routingLive === true) {
    throw new AppError(
      'Production call routing cannot be enabled from this API. The carrier number was not changed.',
      400,
    );
  }
  const mode = source.mode ?? 'none';
  if (!FORWARD_MODES.includes(mode)) {
    throw new AppError('forwarding.mode is invalid', 400);
  }
  let destination = String(source.destination ?? '').trim();
  const notes = String(source.notes ?? '').trim().slice(0, 500);
  let status = source.status ?? (mode === 'none' ? 'not_configured' : 'pending');
  if (mode === 'none') {
    destination = '';
    status = 'not_configured';
  }
  if (!FORWARDING_STATUSES.includes(status)) {
    throw new AppError('forwarding.status is invalid', 400);
  }
  if (mode === 'forward') {
    destination = requirePhone(destination, 'Forwarding destination').raw;
  }
  if (mode === 'sip') {
    if (!SIP_RE.test(destination)) {
      throw new AppError('SIP destination must look like sip:user@host', 400);
    }
  }
  if (mode === 'manual' && destination.length > 120) {
    throw new AppError('Forwarding destination is too long', 400);
  }
  return { mode, status, destination, notes, routingLive: false };
}

function applyAiDestination(value) {
  const raw = String(value ?? '').trim();
  if (!raw) return { raw: '', digits: '' };
  return requirePhone(raw, 'AI destination number');
}

function formatPhoneNumber(doc, location) {
  const row = doc && typeof doc.toObject === 'function' ? doc.toObject() : doc;
  const hours = row.businessHours ?? {};
  const forwarding = row.forwarding ?? {};
  return {
    id: String(row._id),
    locationId: String(row.locationId),
    branchName: location?.name ?? '',
    branchPhone: location?.phone ?? '',
    branchIsDisabled: Boolean(location?.isDisabled),
    existingPhoneNumber: row.existingPhoneNumber,
    aiDestinationNumber: row.aiDestinationNumber ?? '',
    provider: row.provider,
    providerLabel: row.providerLabel ?? '',
    aiEnabled: Boolean(row.aiEnabled),
    businessHours: {
      timezone: hours.timezone || 'America/New_York',
      schedule: WEEKDAYS.map((day) => {
        const found = (hours.schedule ?? []).find((item) => item.day === day);
        return {
          day,
          closed: Boolean(found?.closed),
          open: found?.open ?? '',
          close: found?.close ?? '',
        };
      }),
    },
    humanFallbackNumber: row.humanFallbackNumber ?? '',
    transferNumber: row.transferNumber ?? '',
    forwarding: {
      mode: forwarding.mode || 'none',
      status: forwarding.status || 'not_configured',
      destination: forwarding.destination ?? '',
      notes: forwarding.notes ?? '',
      routingLive: false,
    },
    connectionStatus: 'not_connected',
    lastTestAt: row.lastTestAt ?? null,
    lastTestResult: row.lastTestResult || 'not_run',
    lastTestMessage: row.lastTestMessage ?? '',
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

async function locationsById(ids) {
  const docs = await Location.find({ _id: { $in: ids } })
    .select('name phone isDisabled')
    .lean();
  return new Map(docs.map((doc) => [String(doc._id), doc]));
}

async function requireLocation(id) {
  const location = await Location.findById(id);
  if (!location) throw new AppError('Branch not found', 404);
  return location;
}

export async function listPhoneNumbers(query) {
  const page = Math.max(1, Number(query.page) || 1);
  const pageSize = Math.min(
    MAX_TICKET_LIST_PAGE_SIZE,
    Math.max(1, Number(query.pageSize) || 10),
  );
  let sortField = typeof query.sort === 'string' ? query.sort : 'createdAt';
  if (!LIST_SORT_FIELDS.includes(sortField)) sortField = 'createdAt';
  const order = query.order === 'asc' ? 1 : -1;
  const filter = {};

  if (typeof query.locationId === 'string' && query.locationId.trim()) {
    filter.locationId = query.locationId.trim();
  }
  if (query.aiEnabled === 'true') filter.aiEnabled = true;
  if (query.aiEnabled === 'false') filter.aiEnabled = false;

  const search = typeof query.search === 'string' ? query.search.trim() : '';
  if (search) {
    const rx = new RegExp(escapeRegex(search), 'i');
    const matchedLocations = await Location.find({ name: rx }).select('_id').lean();
    filter.$or = [
      { existingPhoneNumber: rx },
      { aiDestinationNumber: rx },
      { humanFallbackNumber: rx },
      { transferNumber: rx },
      { providerLabel: rx },
      { locationId: { $in: matchedLocations.map((item) => item._id) } },
    ];
  }

  const [total, docs] = await Promise.all([
    BranchPhoneNumber.countDocuments(filter),
    BranchPhoneNumber.find(filter)
      .sort({ [sortField]: order })
      .skip((page - 1) * pageSize)
      .limit(pageSize)
      .lean(),
  ]);
  const locations = await locationsById(docs.map((doc) => doc.locationId));

  return {
    phoneNumbers: docs.map((doc) => formatPhoneNumber(doc, locations.get(String(doc.locationId)))),
    total,
    page,
    pageSize,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
  };
}

export async function getPhoneNumber(id) {
  const doc = await BranchPhoneNumber.findById(id);
  if (!doc) throw new AppError('Phone number not found', 404);
  const location = await Location.findById(doc.locationId).select('name phone isDisabled').lean();
  return formatPhoneNumber(doc, location);
}

export async function createPhoneNumber(input, user) {
  const location = await requireLocation(input.locationId);
  const sourceNumber = String(input.existingPhoneNumber ?? '').trim() || location.phone;
  const { raw, digits } = requirePhone(sourceNumber, 'Public branch number');
  const duplicate = await BranchPhoneNumber.findOne({ normalizedNumber: digits }).select('_id');
  if (duplicate) throw new AppError('This phone number is already configured', 409);
  const destination = applyAiDestination(input.aiDestinationNumber);

  const doc = await BranchPhoneNumber.create({
    locationId: location._id,
    existingPhoneNumber: raw,
    normalizedNumber: digits,
    aiDestinationNumber: destination.raw,
    normalizedAiDestination: destination.digits,
    ...applyProvider(input),
    aiEnabled: Boolean(input.aiEnabled),
    businessHours: applyHours(input.businessHours),
    humanFallbackNumber: optionalPhone(input.humanFallbackNumber, 'Human fallback number'),
    transferNumber: optionalPhone(input.transferNumber, 'Call transfer number'),
    forwarding: applyForwarding(input.forwarding),
    connectionStatus: 'not_connected',
    createdBy: user?.id ?? null,
    updatedBy: user?.id ?? null,
  });
  return formatPhoneNumber(doc, location);
}

export async function updatePhoneNumber(id, input, user) {
  const doc = await BranchPhoneNumber.findById(id);
  if (!doc) throw new AppError('Phone number not found', 404);

  const locationId = input.locationId ?? String(doc.locationId);
  const location = await requireLocation(locationId);

  if (input.existingPhoneNumber !== undefined || input.locationId !== undefined) {
    const sourceNumber =
      input.existingPhoneNumber !== undefined ? input.existingPhoneNumber : doc.existingPhoneNumber;
    const { raw, digits } = requirePhone(sourceNumber, 'Public branch number');
    const duplicate = await BranchPhoneNumber.findOne({
      normalizedNumber: digits,
      _id: { $ne: doc._id },
    }).select('_id');
    if (duplicate) throw new AppError('This phone number is already configured', 409);
    doc.existingPhoneNumber = raw;
    doc.normalizedNumber = digits;
  }

  doc.locationId = location._id;
  if (input.provider !== undefined || input.providerLabel !== undefined) {
    const next = applyProvider({
      provider: input.provider ?? doc.provider,
      providerLabel: input.providerLabel ?? doc.providerLabel,
    });
    doc.provider = next.provider;
    doc.providerLabel = next.providerLabel;
  }
  if (input.aiDestinationNumber !== undefined) {
    const destination = applyAiDestination(input.aiDestinationNumber);
    doc.aiDestinationNumber = destination.raw;
    doc.normalizedAiDestination = destination.digits;
  }
  if (input.aiEnabled !== undefined) doc.aiEnabled = Boolean(input.aiEnabled);
  if (input.businessHours !== undefined) doc.businessHours = applyHours(input.businessHours);
  if (input.humanFallbackNumber !== undefined) {
    doc.humanFallbackNumber = optionalPhone(input.humanFallbackNumber, 'Human fallback number');
  }
  if (input.transferNumber !== undefined) {
    doc.transferNumber = optionalPhone(input.transferNumber, 'Call transfer number');
  }
  if (input.forwarding !== undefined) doc.forwarding = applyForwarding(input.forwarding);
  doc.forwarding.routingLive = false;
  doc.connectionStatus = 'not_connected';
  doc.updatedBy = user?.id ?? null;
  await doc.save();
  return formatPhoneNumber(doc, location);
}

/**
 * Checks stored configuration only. Does not dial, forward, or update the location phone.
 */
export async function testPhoneNumber(id, user) {
  const doc = await BranchPhoneNumber.findById(id);
  if (!doc) throw new AppError('Phone number not found', 404);
  const location = await Location.findById(doc.locationId);
  let result = 'unavailable';
  let message = bandwidthConfigured()
    ? 'Bandwidth is configured on the server. This check does not place a call. Assign this number to the Bandwidth voice application to receive live calls.'
    : 'Bandwidth credentials are not on the server, so this number was not dialed.';
  if (!location) {
    result = 'invalid';
    message =
      'The assigned branch no longer exists. No call was placed and no carrier setting was changed.';
  } else if (location.isDisabled) {
    result = 'invalid';
    message =
      'The assigned branch is disabled. No call was placed and the carrier number was not changed.';
  }

  doc.connectionStatus = 'not_connected';
  doc.lastTestAt = new Date();
  doc.lastTestResult = result;
  doc.lastTestMessage = message;
  doc.forwarding.routingLive = false;
  doc.updatedBy = user?.id ?? null;
  await doc.save();

  return {
    phoneNumber: formatPhoneNumber(doc, location),
    test: {
      result,
      message,
      placedCall: false,
      routingChanged: false,
    },
  };
}

/**
 * Removes the receptionist configuration. Does not delete the location or change the carrier.
 */
export async function deletePhoneNumber(id) {
  const doc = await BranchPhoneNumber.findById(id);
  if (!doc) throw new AppError('Phone number not found', 404);
  await doc.deleteOne();
  return {
    ok: true,
    deletedId: String(doc._id),
    routingChanged: false,
  };
}
