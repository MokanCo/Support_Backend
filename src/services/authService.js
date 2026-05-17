import bcrypt from 'bcrypt';
import User from '../models/User.js';
import Location from '../models/Location.js';
import { AppError } from '../utils/AppError.js';
import { signToken } from '../utils/jwt.js';

export async function loginWithEmailPassword(email, password) {
  const user = await User.findOne({ email: email.toLowerCase().trim() }).select('+password');
  if (!user) {
    throw new AppError('Invalid credentials', 401);
  }
  if (user.isDisabled) {
    throw new AppError('This account has been disabled', 403);
  }
  if (user.locationId) {
    const loc = await Location.findById(user.locationId).select('isDisabled');
    if (loc?.isDisabled) {
      throw new AppError('This location has been disabled. Contact your administrator.', 403);
    }
  }
  const ok = await bcrypt.compare(password, user.password);
  if (!ok) {
    throw new AppError('Invalid credentials', 401);
  }

  const token = signToken({
    sub: String(user._id),
    role: user.role,
    email: user.email,
    ...(user.locationId ? { locationId: String(user.locationId) } : {}),
  });

  return {
    token,
    user: {
      id: String(user._id),
      name: user.name,
      email: user.email,
      role: user.role,
      locationId: user.locationId ? String(user.locationId) : null,
      isDisabled: Boolean(user.isDisabled),
      mustChangePassword: Boolean(user.mustChangePassword),
    },
  };
}

export async function changeOwnPassword(userId, currentPassword, newPassword) {
  const user = await User.findById(userId).select('+password');
  if (!user) {
    throw new AppError('User not found', 404);
  }
  if (user.isDisabled) {
    throw new AppError('This account has been disabled', 403);
  }

  const current = String(currentPassword ?? '');
  const next = String(newPassword ?? '').trim();
  if (next.length < 8) {
    throw new AppError('New password must be at least 8 characters', 400);
  }
  if (next === 'password123') {
    throw new AppError('Choose a password other than the temporary default', 400);
  }

  const ok = await bcrypt.compare(current, user.password);
  if (!ok) {
    throw new AppError('Current password is incorrect', 400);
  }

  const sameAsCurrent = await bcrypt.compare(next, user.password);
  if (sameAsCurrent) {
    throw new AppError('New password must be different from your current password', 400);
  }

  user.password = await bcrypt.hash(next, 12);
  user.mustChangePassword = false;
  await user.save();

  return getMe(userId);
}

export async function getMe(userId) {
  const user = await User.findById(userId).select('-password');
  if (!user) {
    throw new AppError('User not found', 404);
  }

  let location = null;
  if (user.locationId) {
    const loc = await Location.findById(user.locationId).select('name email phone address isDisabled');
    if (loc) {
      location = {
        id: String(loc._id),
        name: loc.name ?? '',
        email: loc.email ?? '',
        phone: loc.phone ?? '',
        address: loc.address ?? '',
        isDisabled: Boolean(loc.isDisabled),
      };
    }
  }

  return {
    user: {
      id: String(user._id),
      name: user.name,
      email: user.email,
      role: user.role,
      locationId: user.locationId ? String(user.locationId) : null,
      isDisabled: Boolean(user.isDisabled),
      mustChangePassword: Boolean(user.mustChangePassword),
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
    },
    location,
  };
}
