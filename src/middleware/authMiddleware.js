import { verifyToken } from '../utils/jwt.js';
import { AppError } from '../utils/AppError.js';
import User from '../models/User.js';

function extractBearerToken(authorization) {
  if (!authorization || typeof authorization !== 'string') {
    return null;
  }
  const match = authorization.match(/^\s*Bearer\s+(\S+)\s*$/i);
  return match ? match[1] : null;
}

/**
 * Attaches req.user with id, role, locationId (string|null).
 * Requires `Authorization: Bearer <jwt>`.
 */
export async function authMiddleware(req, _res, next) {
  try {
    const token = extractBearerToken(req.headers.authorization);

    if (!token) {
      throw new AppError('Missing or invalid Authorization header (expected: Bearer <token>)', 401);
    }

    const decoded = verifyToken(token);
    if (!decoded || typeof decoded !== 'object' || !decoded.sub) {
      throw new AppError('Invalid token', 401);
    }

    const user = await User.findById(decoded.sub).select('_id role locationId name email');
    if (!user) {
      throw new AppError('User no longer exists', 401);
    }

    req.user = {
      id: String(user._id),
      role: user.role,
      locationId: user.locationId ? String(user.locationId) : null,
      name: user.name,
      email: user.email,
    };
    next();
  } catch (e) {
    if (e && e.name === 'JsonWebTokenError') {
      return next(new AppError('Invalid token', 401));
    }
    if (e && e.name === 'TokenExpiredError') {
      return next(new AppError('Token expired', 401));
    }
    next(e);
  }
}
