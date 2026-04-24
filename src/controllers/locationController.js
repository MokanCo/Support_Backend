import { asyncHandler } from '../utils/asyncHandler.js';
import { AppError } from '../utils/AppError.js';
import * as locationService from '../services/locationService.js';
import * as userService from '../services/userService.js';

export const createLocation = asyncHandler(async (req, res) => {
  const location = await locationService.createLocation(req.body);
  res.status(201).json({ location });
});

export const listLocations = asyncHandler(async (req, res) => {
  const locations = await locationService.listLocationsForUser(req.user);
  res.status(200).json({ locations });
});

export const getLocation = asyncHandler(async (req, res) => {
  const location = await locationService.getLocationById(req.params.id);
  if (req.user.role === 'partner') {
    if (!req.user.locationId || req.user.locationId !== location.id) {
      throw new AppError('Forbidden', 403);
    }
  }
  const forAssignment =
    req.query.forTicketAssignment === 'true' ||
    req.query.forTicketAssignment === '1';
  const users = forAssignment
    ? await userService.listUsersForTicketAssignment(location.id)
    : await userService.listUsersByLocationId(location.id);
  res.status(200).json({ location, users });
});
