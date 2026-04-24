import mongoose from 'mongoose';
import { AppError } from '../utils/AppError.js';

/**
 * @param {unknown} err
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 */
// eslint-disable-next-line no-unused-vars
export function errorHandler(err, req, res, next) {
  if (res.headersSent) {
    return next(err);
  }

  if (err instanceof AppError) {
    return res.status(err.statusCode).json({ success: false, message: err.message });
  }

  if (err instanceof mongoose.Error.ValidationError) {
    const messages = Object.values(err.errors).map((e) => e.message);
    return res.status(400).json({ success: false, message: messages.join(', ') });
  }

  if (err instanceof mongoose.Error.CastError) {
    return res.status(400).json({ success: false, message: 'Invalid identifier' });
  }

  if (err && typeof err === 'object' && 'code' in err && err.code === 11000) {
    return res.status(409).json({ success: false, message: 'Duplicate value' });
  }

  const statusCode =
    err && typeof err === 'object' && 'statusCode' in err && typeof err.statusCode === 'number'
      ? err.statusCode
      : 500;

  const message =
    statusCode === 500 ? 'Internal server error' : String(err && err.message ? err.message : 'Error');

  if (statusCode === 500) {
    // eslint-disable-next-line no-console
    console.error(err);
  }

  return res.status(statusCode).json({ success: false, message });
}
