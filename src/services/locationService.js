import Location from '../models/Location.js';
import { AppError } from '../utils/AppError.js';

/**
 * @param {{ name: string; email: string; phone: string; address: string }} input
 */
export async function createLocation(input) {
  const loc = await Location.create({
    name: input.name.trim(),
    email: input.email.toLowerCase().trim(),
    phone: input.phone.trim(),
    address: input.address.trim(),
  });
  return formatLocation(loc);
}

export async function listLocationsForUser(user) {
  if (user.role === 'partner') {
    if (!user.locationId) {
      throw new AppError('Partner account is missing a location', 403);
    }
    const loc = await Location.findById(user.locationId);
    if (!loc) {
      return [];
    }
    return [formatLocation(loc)];
  }
  const all = await Location.find().sort({ name: 1 });
  return all.map(formatLocation);
}

export async function getLocationById(id) {
  const loc = await Location.findById(id);
  if (!loc) {
    throw new AppError('Location not found', 404);
  }
  return formatLocation(loc);
}

function formatLocation(doc) {
  return {
    id: String(doc._id),
    name: doc.name,
    email: doc.email,
    phone: doc.phone,
    address: doc.address,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  };
}
