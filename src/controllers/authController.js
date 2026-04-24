import { asyncHandler } from '../utils/asyncHandler.js';
import * as authService from '../services/authService.js';

export const login = asyncHandler(async (req, res) => {
  const { email, password } = req.body;
  const { token, user } = await authService.loginWithEmailPassword(email, password);
  res.status(200).json({ user, token });
});

/** Stateless JWT: client drops the token; no server-side session. */
export const logout = asyncHandler(async (_req, res) => {
  res.status(200).json({ ok: true });
});

export const me = asyncHandler(async (req, res) => {
  const user = await authService.getMe(req.user.id);
  res.status(200).json({ user });
});
