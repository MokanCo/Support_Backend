import { asyncHandler } from '../utils/asyncHandler.js';
import { AppError } from '../utils/AppError.js';
import * as locationService from '../services/locationService.js';
import * as userService from '../services/userService.js';

export const createLocation = asyncHandler(async (req, res) => {
  const location = await locationService.createLocation(req.body);
  res.status(201).json({ location });
});

export const listLocations = asyncHandler(async (req, res) => {
  const payload = await locationService.listLocationsQuery(req.user, req.query);
  res.status(200).json(payload);
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

export const updateLocation = asyncHandler(async (req, res) => {
  const location = await locationService.updateLocationById(req.params.id, req.body);
  res.status(200).json({ location });
});

export const getDeleteImpact = asyncHandler(async (req, res) => {
  const impact = await locationService.getLocationDeleteImpact(req.params.id);
  res.status(200).json(impact);
});

export const bulkDeleteLocations = asyncHandler(async (req, res) => {
  const result = await locationService.bulkDeleteLocations(req.body.ids);
  res.status(200).json(result);
});

export const deleteLocation = asyncHandler(async (req, res) => {
  const result = await locationService.deleteLocationById(req.params.id);
  res.status(200).json(result);
});

export const makeLocationPrimary = asyncHandler(async (req, res) => {
  const location = await locationService.setLocationAsPrimary(req.params.id);
  res.status(200).json({ location });
});
