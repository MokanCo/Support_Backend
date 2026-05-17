import mongoose from 'mongoose';
import { AppError } from '../utils/AppError.js';

function send(res, status, message) {
  return res.status(status).json({ success: false, error: message, message });
}

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
    return send(res, err.statusCode, err.message);
  }

  if (err instanceof mongoose.Error.ValidationError) {
    const message = Object.values(err.errors).map((e) => e.message).join(', ');
    return send(res, 400, message);
  }

  if (err instanceof mongoose.Error.CastError) {
    return send(res, 400, 'Invalid identifier');
  }

  if (err && typeof err === 'object' && 'code' in err && err.code === 11000) {
    return send(res, 409, 'Duplicate value');
  }

  const statusCode =
    err && typeof err === 'object' && 'statusCode' in err && typeof err.statusCode === 'number'
      ? err.statusCode
      : 500;

  const message =
    statusCode === 500
      ? 'Internal server error'
      : String(err && err.message ? err.message : 'Error');

  if (statusCode === 500) {
    // eslint-disable-next-line no-console
    console.error(err);
  }

  return send(res, statusCode, message);
}
