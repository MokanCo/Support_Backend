import { body, param, query } from 'express-validator';
import { MAX_TICKET_LIST_PAGE_SIZE } from '../constants/pagination.js';
import { USER_ROLES } from '../models/User.js';
import { TICKET_STATUSES, TICKET_PRIORITIES } from '../models/Ticket.js';

export const loginValidators = [
  body('email').isEmail().withMessage('Valid email is required').normalizeEmail(),
  body('password').isString().notEmpty().withMessage('Password is required'),
];

export const createLocationValidators = [
  body('name').isString().trim().notEmpty().withMessage('name is required'),
  body('email').isEmail().withMessage('Valid email is required').normalizeEmail(),
  body('phone').isString().trim().notEmpty().withMessage('phone is required'),
  body('address').isString().trim().notEmpty().withMessage('address is required'),
  body('city').optional().isString().trim(),
  body('state').optional().isString().trim(),
  body('zip').optional().isString().trim(),
];

export const locationIdParamValidators = [
  param('id').isMongoId().withMessage('Invalid location id'),
];

export const listLocationsQueryValidators = [
  query('page').optional().isInt({ min: 1 }),
  query('pageSize').optional().isInt({ min: 1, max: MAX_TICKET_LIST_PAGE_SIZE }),
  query('sort').optional().isString(),
  query('order').optional().isIn(['asc', 'desc']),
  query('search').optional().isString(),
];

export const updateLocationValidators = [
  ...locationIdParamValidators,
  body('name').optional().isString().trim().notEmpty(),
  body('email').optional().isEmail().normalizeEmail(),
  body('phone').optional().isString().trim().notEmpty(),
  body('address').optional().isString().trim().notEmpty(),
  body('city').optional().isString().trim(),
  body('state').optional().isString().trim(),
  body('zip').optional().isString().trim(),
  body('isDisabled').optional().isBoolean(),
];

export const bulkLocationIdsValidators = [
  body('ids').isArray({ min: 1 }).withMessage('ids must be a non-empty array'),
  body('ids.*').isMongoId().withMessage('Each id must be a valid Mongo id'),
];

export const createUserValidators = [
  body('name').isString().trim().notEmpty().withMessage('name is required'),
  body('email').isEmail().withMessage('Valid email is required').normalizeEmail(),
  body('sendInvite').optional().isBoolean().withMessage('sendInvite must be boolean'),
  body('password').custom((value, { req }) => {
    if (req.body?.sendInvite === true || req.body?.sendInvite === 'true') {
      return true;
    }
    if (typeof value !== 'string' || value.length < 8) {
      throw new Error('password must be at least 8 characters');
    }
    return true;
  }),
  body('role').isIn(USER_ROLES).withMessage(`role must be one of: ${USER_ROLES.join(', ')}`),
  body('locationId').optional({ values: 'null' }).isMongoId().withMessage('Invalid locationId'),
];

export const changePasswordValidators = [
  body('currentPassword').isString().notEmpty().withMessage('currentPassword is required'),
  body('newPassword')
    .isString()
    .isLength({ min: 8 })
    .withMessage('newPassword must be at least 8 characters'),
];

export const updateUserValidators = [
  param('id').isMongoId().withMessage('Invalid user id'),
  body('name').optional().isString().trim().notEmpty().withMessage('name cannot be empty'),
  body('email').optional().isEmail().withMessage('Valid email is required').normalizeEmail(),
  body('password')
    .optional()
    .isString()
    .isLength({ min: 8 })
    .withMessage('password must be at least 8 characters'),
  body('role').optional().isIn(USER_ROLES).withMessage(`role must be one of: ${USER_ROLES.join(', ')}`),
  body('locationId').optional({ values: 'null' }).custom((value) => {
    if (value === null || value === '') return true;
    return typeof value === 'string' && /^[a-f\d]{24}$/i.test(value);
  }),
  body('isDisabled').optional().isBoolean().withMessage('isDisabled must be boolean'),
];

export const createTicketValidators = [
  body('title').isString().trim().notEmpty().withMessage('title is required'),
  body('description').optional().isString(),
  body('category').isString().trim().notEmpty().withMessage('category is required'),
  body('status').optional().isIn(TICKET_STATUSES).withMessage(`status must be one of: ${TICKET_STATUSES.join(', ')}`),
  body('priority')
    .optional()
    .isIn(TICKET_PRIORITIES)
    .withMessage(`priority must be one of: ${TICKET_PRIORITIES.join(', ')}`),
  body('progress').optional().isInt({ min: 0, max: 100 }).withMessage('progress must be an integer 0–100'),
  body('deadline').optional().isISO8601().toDate().withMessage('deadline must be a valid ISO date'),
  // Partners omit this; server uses JWT `locationId`. Admin/support must send a valid id.
  body('locationId').optional({ values: 'falsy' }).isMongoId().withMessage('Invalid locationId'),
  body('assignedTo').optional({ values: 'null' }).isMongoId().withMessage('Invalid assignedTo'),
];

const deadlineOrNull = body('deadline')
  .optional({ values: 'null' })
  .custom((value) => value === null || value === '' || !Number.isNaN(Date.parse(String(value))))
  .withMessage('deadline must be a valid ISO date or null');

export const updateTicketValidators = [
  param('id').isMongoId().withMessage('Invalid ticket id'),
  body('title').optional().isString().trim().notEmpty(),
  body('description').optional().isString(),
  body('category').optional().isString().trim().notEmpty(),
  body('status').optional().isIn(TICKET_STATUSES),
  body('priority').optional().isIn(TICKET_PRIORITIES),
  body('progress').optional().isInt({ min: 0, max: 100 }),
  deadlineOrNull,
  body('locationId').optional().isMongoId(),
  body('assignedTo').optional({ values: 'null' }).isMongoId(),
  body('resolution')
    .optional()
    .isString()
    .isLength({ max: 20000 })
    .withMessage('resolution must be a string at most 20000 characters'),
];

export const ticketIdParamValidators = [param('id').isMongoId().withMessage('Invalid ticket id')];

export const ticketInternalNoteCreateValidators = [
  ...ticketIdParamValidators,
  body('body').isString().trim().notEmpty().isLength({ max: 20000 }).withMessage('body is required'),
];

export const ticketInternalNoteUpdateValidators = [
  param('id').isMongoId().withMessage('Invalid ticket id'),
  param('noteId').isMongoId().withMessage('Invalid note id'),
  body('body').optional().isString().trim().notEmpty().isLength({ max: 20000 }),
];

export const ticketInternalNoteDeleteValidators = [
  param('id').isMongoId().withMessage('Invalid ticket id'),
  param('noteId').isMongoId().withMessage('Invalid note id'),
];

export const deleteUserValidators = [param('id').isMongoId().withMessage('Invalid user id')];

export const listTicketsQueryValidators = [
  query('newQueue').optional().isIn(['0', '1']),
  query('status').optional().isIn(TICKET_STATUSES),
  query('locationId').optional().isMongoId(),
  query('priority').optional().isIn(TICKET_PRIORITIES),
  query('overdue').optional().isIn(['0', '1']),
  query('search').optional().isString(),
  query('page').optional().isInt({ min: 1 }),
  query('pageSize').optional().isInt({ min: 1, max: MAX_TICKET_LIST_PAGE_SIZE }),
  query('sort').optional().isString(),
  query('order').optional().isIn(['asc', 'desc']),
];

export const bulkTicketIdsValidators = [
  body('ids').isArray({ min: 1 }).withMessage('ids must be a non-empty array'),
  body('ids.*').isMongoId().withMessage('Each id must be a valid Mongo id'),
];

export const bulkDeleteTicketValidators = [...bulkTicketIdsValidators];

export const bulkUpdateTicketValidators = [
  ...bulkTicketIdsValidators,
  body('updates').isObject().withMessage('updates must be an object'),
  body('updates.title').optional().isString().trim().notEmpty(),
  body('updates.description').optional().isString(),
  body('updates.category').optional().isString().trim().notEmpty(),
  body('updates.status').optional().isIn(TICKET_STATUSES),
  body('updates.priority').optional().isIn(TICKET_PRIORITIES),
  body('updates.progress').optional().isInt({ min: 0, max: 100 }),
  body('updates.deadline')
    .optional({ values: 'null' })
    .custom((value) => value === null || value === '' || !Number.isNaN(Date.parse(String(value))))
    .withMessage('updates.deadline must be a valid ISO date or null'),
  body('updates.locationId').optional().isMongoId(),
  body('updates.assignedTo').optional({ values: 'null' }).isMongoId(),
  body('updates.resolution')
    .optional()
    .isString()
    .isLength({ max: 20000 })
    .withMessage('updates.resolution must be a string at most 20000 characters'),
];

export const createMessageValidators = [
  body('ticketId').isMongoId().withMessage('Invalid ticketId'),
  body('text').isString().trim().notEmpty().isLength({ max: 10000 }).withMessage('text is required'),
];

export const listMessagesValidators = [
  query('ticketId').isMongoId().withMessage('ticketId query parameter must be a valid Mongo id'),
];

export const markThreadReadValidators = [
  body('ticketId').isMongoId().withMessage('Invalid ticketId'),
];

export const contactFormValidators = [
  body('name').isString().trim().notEmpty().isLength({ max: 120 }).withMessage('name is required'),
  body('email').isEmail().withMessage('Valid email is required').normalizeEmail(),
  body('subject')
    .optional()
    .isString()
    .trim()
    .isLength({ max: 200 })
    .withMessage('subject must be at most 200 characters'),
  body('message').isString().trim().notEmpty().isLength({ max: 10000 }).withMessage('message is required'),
  body('adminEmail')
    .optional()
    .isEmail()
    .withMessage('adminEmail must be a valid email')
    .normalizeEmail(),
];
