import 'dotenv/config';
import http from 'http';
import app from './app.js';
import { connectDb } from './config/db.js';
import { attachSocketServer } from './realtime/socketServer.js';

const PORT = Number(process.env.PORT) || 5000;

async function bootstrap() {
  await connectDb();
  const server = http.createServer(app);
  attachSocketServer(server);
  server.listen(PORT, () => {
    // eslint-disable-next-line no-console
    console.log(`API listening on port ${PORT} (HTTP + Socket.IO)`);
  });
}

bootstrap().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('Failed to start server', err);
  process.exit(1);
});
