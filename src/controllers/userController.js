import { asyncHandler } from '../utils/asyncHandler.js';
import * as userService from '../services/userService.js';

export const createUser = asyncHandler(async (req, res) => {
  const user = await userService.createUser(req.body);
  res.status(201).json({ user });
});

export const listUsers = asyncHandler(async (_req, res) => {
  const users = await userService.listUsers();
  res.status(200).json({ users });
});

export const updateUser = asyncHandler(async (req, res) => {
  const user = await userService.updateUserById(req.params.id, req.body);
  res.status(200).json({ user });
});
