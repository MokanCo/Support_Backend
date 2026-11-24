import { asyncHandler } from '../utils/asyncHandler.js';
import * as phoneNumberService from '../services/phoneNumberService.js';

export const listPhoneNumbers = asyncHandler(async (req, res) => {
  const payload = await phoneNumberService.listPhoneNumbers(req.query);
  res.status(200).json(payload);
});

export const getPhoneNumber = asyncHandler(async (req, res) => {
  const phoneNumber = await phoneNumberService.getPhoneNumber(req.params.id);
  res.status(200).json({ phoneNumber });
});

export const createPhoneNumber = asyncHandler(async (req, res) => {
  const phoneNumber = await phoneNumberService.createPhoneNumber(req.body, req.user);
  res.status(201).json({ phoneNumber });
});

export const updatePhoneNumber = asyncHandler(async (req, res) => {
  const phoneNumber = await phoneNumberService.updatePhoneNumber(req.params.id, req.body, req.user);
  res.status(200).json({ phoneNumber });
});

export const deletePhoneNumber = asyncHandler(async (req, res) => {
  const result = await phoneNumberService.deletePhoneNumber(req.params.id);
  res.status(200).json(result);
});

export const testPhoneNumber = asyncHandler(async (req, res) => {
  const result = await phoneNumberService.testPhoneNumber(req.params.id, req.user);
  res.status(200).json(result);
});
