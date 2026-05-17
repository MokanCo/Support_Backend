import { Server } from 'socket.io';
import jwt from 'jsonwebtoken';
import mongoose from 'mongoose';
import Ticket from '../models/Ticket.js';
import User from '../models/User.js';
import { assertCanAccessTicket } from '../services/accessService.js';
import { getJwtSecret } from '../utils/jwt.js';
import { setSocketIo } from './messageHub.js';
import { bindPresenceIo, markUserConnected, markUserDisconnected } from './presence.js';
import { buildTicketChatHeaderState } from '../services/ticketChatHeaderService.js';

function extractToken(socket) {
  const fromAuth = socket.handshake.auth?.token;
  if (typeof fromAuth === 'string' && fromAuth.trim()) return fromAuth.trim();
  const h = socket.handshake.headers?.authorization;
  if (typeof h === 'string') {
    const m = h.match(/^\s*Bearer\s+(\S+)\s*$/i);
    if (m) return m[1];
  }
  return null;
}

/**
 * @param {import('http').Server} httpServer
 */
export function attachSocketServer(httpServer) {
  const frontendOrigin = process.env.FRONTEND_URL || 'http://localhost:3000';

  const io = new Server(httpServer, {
    path: '/socket.io',
    cors: {
      origin: frontendOrigin,
      credentials: true,
    },
    transports: ['websocket', 'polling'],
  });

  setSocketIo(io);
  bindPresenceIo(io);

  io.use((socket, next) => {
    try {
      const token = extractToken(socket);
      if (!token) {
        next(new Error('Unauthorized'));
        return;
      }
      const decoded = jwt.verify(token, getJwtSecret());
      const sub = decoded && typeof decoded === 'object' ? decoded.sub : null;
      if (!sub) {
        next(new Error('Unauthorized'));
        return;
      }
      socket.data.userId = String(sub);
      next();
    } catch {
      next(new Error('Unauthorized'));
    }
  });

  io.on('connection', (socket) => {
    const userId = socket.data.userId;
    markUserConnected(userId);
    void socket.join(`user:${userId}`);

    const join = async (ticketId, cb) => {
      try {
        if (!ticketId || !mongoose.Types.ObjectId.isValid(String(ticketId))) {
          cb?.({ ok: false, error: 'Invalid ticketId' });
          return;
        }
        const user = await User.findById(socket.data.userId)
          .select('_id role locationId name email')
          .lean();
        if (!user) {
          cb?.({ ok: false, error: 'User not found' });
          return;
        }
        const actor = {
          id: String(user._id),
          role: user.role,
          locationId: user.locationId ? String(user.locationId) : null,
          name: user.name,
          email: user.email,
        };
        const ticket = await Ticket.findById(ticketId);
        assertCanAccessTicket(actor, ticket);
        const tid = String(ticketId);
        await socket.join(`ticket:${tid}`);
        let chatHeader;
        try {
          chatHeader = await buildTicketChatHeaderState(actor, tid);
        } catch {
          chatHeader = undefined;
        }
        cb?.({ ok: true, chatHeader });
      } catch (e) {
        cb?.({ ok: false, error: e?.message ?? 'Forbidden' });
      }
    };

    socket.on('join_ticket', ({ ticketId } = {}, cb) => {
      void join(ticketId, cb);
    });

    socket.on('leave_ticket', ({ ticketId } = {}) => {
      if (ticketId) void socket.leave(`ticket:${String(ticketId)}`);
    });

    socket.on('disconnect', () => {
      markUserDisconnected(userId);
    });
  });

  return io;
}
