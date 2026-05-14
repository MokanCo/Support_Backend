import express from 'express';
import cors from 'cors';
import authRoutes from './routes/authRoutes.js';
import locationRoutes from './routes/locationRoutes.js';
import userRoutes from './routes/userRoutes.js';
import ticketRoutes from './routes/ticketRoutes.js';
import messageRoutes from './routes/messageRoutes.js';
import conversationRoutes from './routes/conversationRoutes.js';
import analyticsRoutes from './routes/analyticsRoutes.js';
import boardApiRoutes from './routes/boardApiRoutes.js';
import notificationRoutes from './routes/notificationRoutes.js';
import { errorHandler } from './middleware/errorHandler.js';
import { mountSwagger } from './config/swagger.js';

const app = express();

const frontendOrigin = process.env.FRONTEND_URL || 'http://localhost:3000';

app.use(
  cors({
    origin: frontendOrigin,
    credentials: true,
  }),
);
app.use(express.json({ limit: '1mb' }));

app.get('/health', (_req, res) => {
  res.json({ ok: true });
});

mountSwagger(app);

app.use('/api/auth', authRoutes);
app.use('/api/locations', locationRoutes);
app.use('/api/users', userRoutes);
app.use('/api/tickets', ticketRoutes);
app.use('/api/messages', messageRoutes);
app.use('/api/conversations', conversationRoutes);
app.use('/api/analytics', analyticsRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api', boardApiRoutes);

app.use((_req, _res, next) => {
  next(Object.assign(new Error('Not Found'), { statusCode: 404 }));
});

app.use(errorHandler);

export default app;
