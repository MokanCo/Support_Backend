import bcrypt from 'bcrypt';
import mongoose from 'mongoose';
import User from '../models/User.js';
import Location from '../models/Location.js';
import { AppError } from '../utils/AppError.js';

const SALT_ROUNDS = 12;

/**
 * @param {{ name: string; email: string; password: string; role: string; locationId?: string | null }} input
 */
export async function createUser(input) {
  const email = input.email.toLowerCase().trim();
  const exists = await User.findOne({ email });
  if (exists) {
    throw new AppError('Email already in use', 409);
  }

  if (input.role === 'partner') {
    if (!input.locationId) {
      throw new AppError('Partners require a locationId', 400);
    }
    const loc = await Location.findById(input.locationId);
    if (!loc) {
      throw new AppError('Location not found', 400);
    }
  }

  const password = await bcrypt.hash(input.password, SALT_ROUNDS);

  const user = await User.create({
    name: input.name.trim(),
    email,
    password,
    role: input.role,
    locationId: input.locationId ? new mongoose.Types.ObjectId(input.locationId) : null,
  });

  return sanitizeUser(user);
}

export async function listUsers() {
  const users = await User.find().sort({ createdAt: -1 }).lean();
  return users.map(sanitizeUserLean);
}

/** Users assigned to the given location (`locationId` matches). */
export async function listUsersByLocationId(locationId) {
  if (!mongoose.Types.ObjectId.isValid(locationId)) {
    return [];
  }
  const oid = new mongoose.Types.ObjectId(locationId);
  const users = await User.find({ locationId: oid })
    .select('-password')
    .sort({ createdAt: -1 })
    .lean();
  return users.map(sanitizeUserLean);
}

/**
 * Staff who can be assigned to tickets for this location: users at the site
 * plus support/admin with no location (global pool).
 */
export async function listUsersForTicketAssignment(locationId) {
  if (!mongoose.Types.ObjectId.isValid(locationId)) {
    return [];
  }
  const oid = new mongoose.Types.ObjectId(locationId);
  const users = await User.find({
    $or: [
      { locationId: oid, role: { $in: ['support', 'admin'] } },
      { locationId: null, role: { $in: ['support', 'admin'] } },
    ],
  })
    .select('-password')
    .sort({ name: 1 })
    .lean();
  return users.map(sanitizeUserLean);
}

/**
 * @param {string} id
 * @param {{ name?: string; email?: string; password?: string; role?: string; locationId?: string | null }} patch
 */
export async function updateUserById(id, patch) {
  const user = await User.findById(id);
  if (!user) {
    throw new AppError('User not found', 404);
  }

  if (patch.email) {
    const email = patch.email.toLowerCase().trim();
    const taken = await User.findOne({ email, _id: { $ne: user._id } });
    if (taken) {
      throw new AppError('Email already in use', 409);
    }
    user.email = email;
  }

  if (patch.name !== undefined) user.name = patch.name.trim();

  if (patch.password) {
    user.password = await bcrypt.hash(patch.password, SALT_ROUNDS);
  }

  if (patch.role !== undefined) {
    user.role = patch.role;
  }

  if (patch.locationId !== undefined) {
    if (patch.locationId === null || patch.locationId === '') {
      if (user.role === 'partner') {
        throw new AppError('Partners require a locationId', 400);
      }
      user.locationId = null;
    } else {
      const loc = await Location.findById(patch.locationId);
      if (!loc) {
        throw new AppError('Location not found', 400);
      }
      user.locationId = new mongoose.Types.ObjectId(patch.locationId);
    }
  }

  if (user.role === 'partner' && !user.locationId) {
    throw new AppError('Partners require a locationId', 400);
  }

  await user.save();
  return sanitizeUser(user);
}

function sanitizeUser(userDoc) {
  return {
    id: String(userDoc._id),
    name: userDoc.name,
    email: userDoc.email,
    role: userDoc.role,
    locationId: userDoc.locationId ? String(userDoc.locationId) : null,
    createdAt: userDoc.createdAt,
    updatedAt: userDoc.updatedAt,
  };
}

function sanitizeUserLean(u) {
  return {
    id: String(u._id),
    name: u.name,
    email: u.email,
    role: u.role,
    locationId: u.locationId ? String(u.locationId) : null,
    createdAt: u.createdAt,
    updatedAt: u.updatedAt,
  };
}
