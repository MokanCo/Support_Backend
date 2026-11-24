import { body, param, query } from 'express-validator';
import { MAX_TICKET_LIST_PAGE_SIZE } from '../constants/pagination.js';
import { FORWARD_MODES, PHONE_PROVIDERS, WEEKDAYS } from '../models/BranchPhoneNumber.js';

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

export const phoneNumberIdValidators = [
  param('id').isMongoId().withMessage('Invalid phone number id'),
];

export const listPhoneNumberValidators = [
  query('page').optional().isInt({ min: 1 }).withMessage('page must be 1 or greater'),
  query('pageSize')
    .optional()
    .isInt({ min: 1, max: MAX_TICKET_LIST_PAGE_SIZE })
    .withMessage(`pageSize must be 1 to ${MAX_TICKET_LIST_PAGE_SIZE}`),
  query('sort')
    .optional()
    .isIn(['createdAt', 'updatedAt', 'existingPhoneNumber', 'aiEnabled'])
    .withMessage('sort is invalid'),
  query('order').optional().isIn(['asc', 'desc']).withMessage('order must be asc or desc'),
  query('search').optional().isString().isLength({ max: 120 }),
  query('locationId').optional().isMongoId().withMessage('Invalid locationId'),
  query('aiEnabled').optional().isIn(['true', 'false']).withMessage('aiEnabled must be true or false'),
];

function hoursValidator(value) {
  if (value == null) return true;
  if (typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('businessHours must be an object');
  }
  if (value.timezone != null && (typeof value.timezone !== 'string' || value.timezone.length > 80)) {
    throw new Error('timezone must be a string of at most 80 characters');
  }
  if (value.schedule == null) return true;
  if (!Array.isArray(value.schedule)) throw new Error('schedule must be an array');
  const seen = new Set();
  for (const row of value.schedule) {
    if (!row || typeof row !== 'object' || !WEEKDAYS.includes(row.day)) {
      throw new Error('schedule day is invalid');
    }
    if (seen.has(row.day)) throw new Error('schedule days must be unique');
    seen.add(row.day);
    if (row.closed != null && typeof row.closed !== 'boolean') {
      throw new Error('closed must be a boolean');
    }
    for (const key of ['open', 'close']) {
      if (row[key] == null || row[key] === '') continue;
      if (typeof row[key] !== 'string' || !TIME_RE.test(row[key])) {
        throw new Error(`${key} must be HH:mm`);
      }
    }
  }
  return true;
}

function forwardingValidator(value) {
  if (value == null) return true;
  if (typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('forwarding must be an object');
  }
  if (value.routingLive === true) {
    throw new Error('Production call routing cannot be enabled from this API');
  }
  if (value.mode != null && !FORWARD_MODES.includes(value.mode)) {
    throw new Error('forwarding.mode is invalid');
  }
  if (value.destination != null && typeof value.destination !== 'string') {
    throw new Error('forwarding.destination must be a string');
  }
  if (value.notes != null && (typeof value.notes !== 'string' || value.notes.length > 500)) {
    throw new Error('forwarding.notes must be 500 characters or fewer');
  }
  return true;
}

const writeFields = [
  body('existingPhoneNumber').optional().isString().trim().isLength({ max: 30 }),
  body('provider').optional().isIn(PHONE_PROVIDERS).withMessage('provider is invalid'),
  body('providerLabel').optional().isString().isLength({ max: 80 }),
  body('aiEnabled')
    .optional()
    .custom((value) => value === true || value === false)
    .withMessage('aiEnabled must be a boolean'),
  body('businessHours').optional().custom(hoursValidator),
  body('humanFallbackNumber').optional().isString().isLength({ max: 30 }),
  body('transferNumber').optional().isString().isLength({ max: 30 }),
  body('forwarding').optional().custom(forwardingValidator),
];

export const createPhoneNumberValidators = [
  body('locationId').isMongoId().withMessage('locationId is required'),
  ...writeFields,
];

export const updatePhoneNumberValidators = [
  ...phoneNumberIdValidators,
  body('locationId').optional().isMongoId().withMessage('Invalid locationId'),
  ...writeFields,
];
