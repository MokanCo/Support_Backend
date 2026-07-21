/** Tracks dashboard socket connections per user for online indicators. */

/** @type {Map<string, number>} */
const connectionCounts = new Map();

/** @type {import('socket.io').Server | null} */
let io = null;

export function bindPresenceIo(server) {
  io = server;
}

export function markUserConnected(userId) {
  const id = String(userId);
  const next = (connectionCounts.get(id) ?? 0) + 1;
  connectionCounts.set(id, next);
  if (next === 1) {
    broadcastPresence(id, true);
  }
}

export function markUserDisconnected(userId) {
  const id = String(userId);
  const prev = connectionCounts.get(id) ?? 0;
  if (prev <= 1) {
    connectionCounts.delete(id);
    broadcastPresence(id, false);
  } else {
    connectionCounts.set(id, prev - 1);
  }
}

/** @returns {Set<string>} */
export function getOnlineUserIds() {
  return new Set(connectionCounts.keys());
}

export function isUserOnline(userId) {
  return connectionCounts.has(String(userId));
}

function broadcastPresence(userId, online) {
  if (!io) return;
  io.emit('presence:update', { userId: String(userId), online: Boolean(online) });
}
