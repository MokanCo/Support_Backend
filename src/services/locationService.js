import Location from '../models/Location.js';
import User from '../models/User.js';
import Ticket from '../models/Ticket.js';
import { AppError } from '../utils/AppError.js';
import { MAX_TICKET_LIST_PAGE_SIZE } from '../constants/pagination.js';

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const LIST_SORT_FIELDS = ['createdAt', 'updatedAt', 'name', 'email'];

/**
 * @param {{ name: string; email: string; phone: string; address: string; city?: string; state?: string; zip?: string }} input
 */
export async function createLocation(input) {
  const loc = await Location.create({
    name: input.name.trim(),
    email: input.email.toLowerCase().trim(),
    phone: input.phone.trim(),
    address: input.address.trim(),
    city: (input.city ?? '').trim(),
    state: (input.state ?? '').trim(),
    zip: (input.zip ?? '').trim(),
  });
  return formatLocation(loc);
}

/**
 * @param {{ role: string; locationId: string | null }} user
 * @param {Record<string, unknown>} query
 */
export async function listLocationsQuery(user, query) {
  if (user.role === 'partner') {
    if (!user.locationId) {
      throw new AppError('Partner account is missing a location', 403);
    }
    const loc = await Location.findById(user.locationId);
    if (!loc) {
      return {
        locations: [],
        total: 0,
        page: 1,
        pageSize: 10,
        totalPages: 1,
      };
    }
    return {
      locations: [formatLocation(loc)],
      total: 1,
      page: 1,
      pageSize: 1,
      totalPages: 1,
    };
  }

  const page = Math.max(1, Number(query.page) || 1);
  const pageSize = Math.min(
    MAX_TICKET_LIST_PAGE_SIZE,
    Math.max(1, Number(query.pageSize) || 20),
  );
  let sortField = typeof query.sort === 'string' ? query.sort : 'createdAt';
  if (!LIST_SORT_FIELDS.includes(sortField)) sortField = 'createdAt';
  const order = query.order === 'asc' ? 1 : -1;
  const sort = { [sortField]: order };

  const search = typeof query.search === 'string' ? query.search.trim() : '';
  /** @type {import('mongoose').FilterQuery<typeof Location>} */
  const filter = {};
  if (search) {
    const rx = new RegExp(escapeRegex(search), 'i');
    filter.$or = [
      { name: rx },
      { email: rx },
      { phone: rx },
      { address: rx },
      { city: rx },
      { state: rx },
      { zip: rx },
    ];
  }

  const [total, docs] = await Promise.all([
    Location.countDocuments(filter),
    Location.find(filter)
      .sort(sort)
      .skip((page - 1) * pageSize)
      .limit(pageSize)
      .lean(),
  ]);

  return {
    locations: docs.map((d) => formatLocation(d)),
    total,
    page,
    pageSize,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
  };
}

export async function getLocationById(id) {
  const loc = await Location.findById(id);
  if (!loc) {
    throw new AppError('Location not found', 404);
  }
  return formatLocation(loc);
}

/**
 * @param {string} id
 * @param {Record<string, unknown>} patch
 */
export async function updateLocationById(id, patch) {
  const loc = await Location.findById(id);
  if (!loc) {
    throw new AppError('Location not found', 404);
  }
  if (patch.name !== undefined) loc.name = String(patch.name).trim();
  if (patch.email !== undefined) loc.email = String(patch.email).toLowerCase().trim();
  if (patch.phone !== undefined) loc.phone = String(patch.phone).trim();
  if (patch.address !== undefined) loc.address = String(patch.address).trim();
  if (patch.city !== undefined) loc.city = String(patch.city ?? '').trim();
  if (patch.state !== undefined) loc.state = String(patch.state ?? '').trim();
  if (patch.zip !== undefined) loc.zip = String(patch.zip ?? '').trim();
  if (patch.isDisabled !== undefined) {
    loc.isDisabled = Boolean(patch.isDisabled);
  }
  await loc.save();
  return formatLocation(loc);
}

/**
 * Counts users and tickets tied to a location (for delete confirmation UI).
 */
export async function getLocationDeleteImpact(id) {
  const loc = await Location.findById(id);
  if (!loc) {
    throw new AppError('Location not found', 404);
  }
  const [userCount, ticketCount] = await Promise.all([
    User.countDocuments({ locationId: id }),
    Ticket.countDocuments({ locationId: id }),
  ]);
  return { userCount, ticketCount };
}

/**
 * Deletes a location and all users assigned to it. Fails if the location still has tickets.
 */
export async function deleteLocationById(id) {
  const loc = await Location.findById(id);
  if (!loc) {
    throw new AppError('Location not found', 404);
  }
  const ticketCount = await Ticket.countDocuments({ locationId: id });
  if (ticketCount > 0) {
    throw new AppError('Cannot delete a location that still has tickets', 409);
  }
  const userResult = await User.deleteMany({ locationId: id });
  await Location.findByIdAndDelete(id);
  return {
    ok: true,
    deletedUsers: userResult.deletedCount ?? 0,
  };
}

export async function bulkDeleteLocations(ids) {
  let deleted = 0;
  let deletedUsers = 0;
  for (const rawId of ids) {
    // eslint-disable-next-line no-await-in-loop
    const result = await deleteLocationById(rawId);
    deleted += 1;
    deletedUsers += result.deletedUsers ?? 0;
  }
  return { deleted, deletedUsers };
}

function formatLocation(doc) {
  const d = doc && typeof doc.toObject === 'function' ? doc.toObject() : doc;
  if (!d) return null;
  return {
    id: String(d._id),
    name: d.name,
    email: d.email,
    phone: d.phone,
    address: d.address,
    city: d.city ?? '',
    state: d.state ?? '',
    zip: d.zip ?? '',
    isDisabled: Boolean(d.isDisabled),
    createdAt: d.createdAt,
    updatedAt: d.updatedAt,
  };
}
