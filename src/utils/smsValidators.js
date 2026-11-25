import { param, query } from 'express-validator';
import { MAX_TICKET_LIST_PAGE_SIZE } from '../constants/pagination.js';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export const listSmsValidators = [
  query('page').optional().isInt({ min: 1 }).withMessage('page must be 1 or greater'),
  query('pageSize')
    .optional()
    .isInt({ min: 1, max: MAX_TICKET_LIST_PAGE_SIZE })
    .withMessage(`pageSize must be 1 to ${MAX_TICKET_LIST_PAGE_SIZE}`),
  query('search').optional().isString().isLength({ max: 40 }),
  query('status').optional().isIn(['all', 'received', 'read']).withMessage('status is invalid'),
  query('from').optional().matches(DATE_RE).withMessage('from must be YYYY-MM-DD'),
  query('to').optional().matches(DATE_RE).withMessage('to must be YYYY-MM-DD'),
];

export const smsIdValidators = [param('id').isMongoId().withMessage('Invalid message id')];

export const smsPhoneValidators = [
  param('phoneNumber').custom((value) => {
    const digits = String(value ?? '').replace(/\D/g, '');
    if (digits.length < 10 || digits.length > 15) {
      throw new Error('phoneNumber must contain 10 to 15 digits');
    }
    return true;
  }),
];
