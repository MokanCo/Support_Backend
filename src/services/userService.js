import bcrypt from 'bcrypt';
import mongoose from 'mongoose';
import User from '../models/User.js';
import Location from '../models/Location.js';
import Ticket from '../models/Ticket.js';
import { AppError } from '../utils/AppError.js';
import { sendPortalInviteEmail } from './boardMailService.js';

const SALT_ROUNDS = 12;
export const INVITE_TEMP_PASSWORD = 'password123';

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

  const sendInvite = Boolean(input.sendInvite);
  const plainPassword = sendInvite ? INVITE_TEMP_PASSWORD : input.password;
  if (!plainPassword || String(plainPassword).length < 8) {
    throw new AppError('password must be at least 8 characters', 400);
  }

  const password = await bcrypt.hash(plainPassword, SALT_ROUNDS);

  const user = await User.create({
    name: input.name.trim(),
    email,
    password,
    role: input.role,
    locationId: input.locationId ? new mongoose.Types.ObjectId(input.locationId) : null,
    mustChangePassword: sendInvite,
  });

  if (sendInvite) {
    try {
      await sendPortalInviteEmail({
        to: email,
        name: user.name,
        email,
        temporaryPassword: INVITE_TEMP_PASSWORD,
      });
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error('[userService] portal invite email failed', e);
    }
  }

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
    isDisabled: { $ne: true },
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
    user.mustChangePassword = false;
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

  if (patch.isDisabled !== undefined) {
    user.isDisabled = Boolean(patch.isDisabled);
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
    isDisabled: Boolean(userDoc.isDisabled),
    mustChangePassword: Boolean(userDoc.mustChangePassword),
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
    isDisabled: Boolean(u.isDisabled),
    mustChangePassword: Boolean(u.mustChangePassword),
    createdAt: u.createdAt,
    updatedAt: u.updatedAt,
  };
}

export async function deleteUserById(id) {
  if (!mongoose.Types.ObjectId.isValid(id)) {
    throw new AppError('Invalid user id', 400);
  }
  const user = await User.findById(id);
  if (!user) {
    throw new AppError('User not found', 404);
  }
  const linked = await Ticket.exists({
    $or: [{ createdBy: user._id }, { assignedTo: user._id }],
  });
  if (linked) {
    throw new AppError('Cannot delete a user who is linked to tickets', 409);
  }
  await User.findByIdAndDelete(id);
  return { ok: true };
}
