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

const personalInfoValidators = [
  body('personal.firstName').isString().trim().notEmpty().withMessage('personal.firstName is required'),
  body('personal.lastName').isString().trim().notEmpty().withMessage('personal.lastName is required'),
  body('personal.email').isEmail().withMessage('Valid personal.email is required').normalizeEmail(),
  body('personal.phone').isString().trim().notEmpty().withMessage('personal.phone is required'),
  body('personal.address').isString().trim().notEmpty().withMessage('personal.address is required'),
  body('personal.city').isString().trim().notEmpty().withMessage('personal.city is required'),
  body('personal.state').isString().trim().notEmpty().withMessage('personal.state is required'),
  body('personal.zip').isString().trim().notEmpty().withMessage('personal.zip is required'),
];

const locationInfoValidators = [
  body('location.locationName').isString().trim().notEmpty().withMessage('location.locationName is required'),
  body('location.locationEmail').isEmail().withMessage('Valid location.locationEmail is required').normalizeEmail(),
  body('location.locationPhone').isString().trim().notEmpty().withMessage('location.locationPhone is required'),
  body('location.openingDate')
    .isString()
    .trim()
    .matches(/^\d{4}-\d{2}-\d{2}$/)
    .withMessage('location.openingDate must be YYYY-MM-DD'),
  body('location.address').isString().trim().notEmpty().withMessage('location.address is required'),
  body('location.city').isString().trim().notEmpty().withMessage('location.city is required'),
  body('location.state').isString().trim().notEmpty().withMessage('location.state is required'),
  body('location.zip').isString().trim().notEmpty().withMessage('location.zip is required'),
];

export const submitOnboardingValidators = [
  ...personalInfoValidators,
  ...locationInfoValidators,
  body('trackingToken').optional().isString().trim().isLength({ min: 16, max: 128 }),
  body('selectedServices')
    .optional()
    .isArray({ min: 1 })
    .withMessage('selectedServices must be a non-empty array when provided'),
  body('selectedServices.*').optional().isString().trim().notEmpty(),
];

export const draftOnboardingValidators = [
  ...personalInfoValidators,
  ...locationInfoValidators,
  body('trackingToken').optional().isString().trim().isLength({ min: 16, max: 128 }),
];

export const onboardingTrackingTokenValidators = [
  param('token').isString().trim().isLength({ min: 16, max: 128 }).withMessage('Invalid tracking token'),
];

export const updateDraftServicesValidators = [
  ...onboardingTrackingTokenValidators,
  body('selectedServices').isArray().withMessage('selectedServices must be an array'),
  body('selectedServices.*').isString().trim().notEmpty().withMessage('Each service id must be a string'),
];

export const onboardingRequestIdValidators = [
  param('id').isMongoId().withMessage('Invalid onboarding request id'),
];

export const listOnboardingRequestsValidators = [
  query('status').optional().isIn(['pending', 'in_progress', 'completed', 'rejected']),
  query('service').optional().isString().trim(),
  query('search').optional().isString().trim(),
  query('sort').optional().isIn(['createdAt', 'submittedAt', 'updatedAt', 'status']),
  query('order').optional().isIn(['asc', 'desc']),
  query('page').optional().isInt({ min: 1 }),
  query('pageSize').optional().isInt({ min: 1, max: MAX_TICKET_LIST_PAGE_SIZE }),
];

export const updateOnboardingTaskValidators = [
  param('id').isMongoId().withMessage('Invalid request id'),
  param('taskId').isMongoId().withMessage('Invalid task id'),
  body('completed').optional().isBoolean(),
  body('publicComment').optional().isString().trim().isLength({ max: 5000 }),
  body('internalNote').optional().isString().trim().isLength({ max: 5000 }),
  body('issueDescription').optional().isString().trim().isLength({ max: 5000 }),
  body('resolution').optional().isString().trim().isLength({ max: 5000 }),
  body('attachmentUrl').optional().isString().trim().isLength({ max: 2000 }),
];

export const rejectOnboardingValidators = [
  ...onboardingRequestIdValidators,
  body('reviewNotes').optional().isString().trim().isLength({ max: 2000 }),
];

export const reviewOnboardingValidators = [
  ...onboardingRequestIdValidators,
  body('status').isIn(['approved', 'rejected', 'in_progress']).withMessage('status must be approved, in_progress, or rejected'),
  body('reviewNotes').optional().isString().trim().isLength({ max: 2000 }),
];

export const updateOnboardingConfigValidators = [
  body('brandName').optional().isString().trim().isLength({ max: 120 }),
  body('welcomeTitle').optional().isString().trim().isLength({ max: 200 }),
  body('welcomeDescription').optional().isString().trim().isLength({ max: 2000 }),
  body('wizardTitle').optional().isString().trim().isLength({ max: 200 }),
  body('wizardSidebarTitle').optional().isString().trim().isLength({ max: 200 }),
  body('wizardSidebarDescription').optional().isString().trim().isLength({ max: 2000 }),
  body('stepLabels').optional().isArray({ min: 1, max: 10 }),
  body('stepLabels.*').optional().isString().trim().notEmpty(),
  body('welcomeSteps').optional().isArray({ min: 1, max: 10 }),
  body('welcomeSteps.*.num').optional().isInt({ min: 1, max: 20 }),
  body('welcomeSteps.*.label').optional().isString().trim().notEmpty(),
  body('stepSubtitles').optional().isObject(),
  body('successTitle').optional().isString().trim().isLength({ max: 200 }),
  body('successDescription').optional().isString().trim().isLength({ max: 2000 }),
  body('successEmailNote').optional().isString().trim().isLength({ max: 2000 }),
  body('enabled').optional().isBoolean(),
];

export const createOnboardingServiceValidators = [
  body('slug').isString().trim().notEmpty().isLength({ max: 60 }).withMessage('slug is required'),
  body('title').isString().trim().notEmpty().isLength({ max: 120 }).withMessage('title is required'),
  body('section').isString().trim().notEmpty().isLength({ max: 120 }).withMessage('section is required'),
  body('iconKey').isString().trim().notEmpty().withMessage('iconKey is required'),
  body('iconClass').isString().trim().notEmpty().withMessage('iconClass is required'),
  body('sortOrder').optional().isInt({ min: 0, max: 9999 }),
  body('isActive').optional().isBoolean(),
];

export const updateOnboardingServiceValidators = [
  param('id').isMongoId().withMessage('Invalid service id'),
  body('slug').optional().isString().trim().notEmpty().isLength({ max: 60 }),
  body('title').optional().isString().trim().notEmpty().isLength({ max: 120 }),
  body('section').optional().isString().trim().notEmpty().isLength({ max: 120 }),
  body('iconKey').optional().isString().trim().isLength({ max: 40 }),
  body('iconClass').optional().isString().trim().isLength({ max: 120 }),
  body('sortOrder').optional().isInt({ min: 0, max: 9999 }),
  body('isActive').optional().isBoolean(),
];

export const deleteOnboardingServiceValidators = [
  param('id').isMongoId().withMessage('Invalid service id'),
];
