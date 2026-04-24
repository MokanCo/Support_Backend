import bcrypt from 'bcrypt';
import User from '../models/User.js';
import { AppError } from '../utils/AppError.js';
import { signToken } from '../utils/jwt.js';

export async function loginWithEmailPassword(email, password) {
  const user = await User.findOne({ email: email.toLowerCase().trim() }).select('+password');
  if (!user) {
    throw new AppError('Invalid credentials', 401);
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
    },
  };
}

export async function getMe(userId) {
  const user = await User.findById(userId).select('-password');
  if (!user) {
    throw new AppError('User not found', 404);
  }
  return {
    id: String(user._id),
    name: user.name,
    email: user.email,
    role: user.role,
    locationId: user.locationId ? String(user.locationId) : null,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  };
}
