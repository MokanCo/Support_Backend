import { AppError } from '../utils/AppError.js';

/**
 * @param {readonly ('admin'|'support'|'partner')[]} allowed
 */
export function roleMiddleware(allowed) {
  return (req, _res, next) => {
    if (!req.user) {
      return next(new AppError('Not authenticated', 401));
    }
    if (!allowed.includes(req.user.role)) {
      return next(new AppError('Forbidden', 403));
    }
    next();
  };
}
