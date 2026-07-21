import { asyncHandler } from '../utils/asyncHandler.js';
import { runInBackground } from '../utils/backgroundTasks.js';
import { dispatchEmail } from '../services/mailSender.js';
import { sendPortalInviteEmail } from '../services/boardMailService.js';
import * as userService from '../services/userService.js';

function wantsInvite(body) {
  return body?.sendInvite === true || body?.sendInvite === 'true';
}

export const createUser = asyncHandler(async (req, res) => {
  const sendInvite = wantsInvite(req.body);
  const user = await userService.createUser(req.body);

  res.status(201).json({ user });

  if (sendInvite) {
    const invitePayload = {
      to: user.email,
      name: user.name,
      email: user.email,
      temporaryPassword: userService.INVITE_TEMP_PASSWORD,
    };
    runInBackground('portal-invite-email', () => sendPortalInviteEmail(invitePayload));
  }
});

export const listUsers = asyncHandler(async (_req, res) => {
  const users = await userService.listUsers();
  res.status(200).json({ users });
});

export const listOnlineUsers = asyncHandler(async (_req, res) => {
  const onlineUserIds = userService.listOnlineUserIds();
  res.status(200).json({ onlineUserIds });
});

export const updateUser = asyncHandler(async (req, res) => {
  const user = await userService.updateUserById(req.params.id, req.body);
  res.status(200).json({ user });
});

export const deleteUser = asyncHandler(async (req, res) => {
  const result = await userService.deleteUserById(req.params.id);
  res.status(200).json(result);
});

export const mailTest = asyncHandler(async (req, res) => {
  const to = typeof req.body?.to === 'string' && req.body.to.trim()
    ? req.body.to.trim()
    : req.user.email;
  await dispatchEmail({
    to,
    subject: 'Mokanco portal — mail test',
    text: `Mail test OK from ${process.env.RENDER_SERVICE_NAME || 'local'} at ${new Date().toISOString()}`,
  });
  res.status(200).json({ ok: true, to });
});

