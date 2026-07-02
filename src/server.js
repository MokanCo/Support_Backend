import 'dotenv/config';
import http from 'http';
import app from './app.js';
import { connectDb } from './config/db.js';
import { attachSocketServer } from './realtime/socketServer.js';
import { syncServiceTemplates } from './services/onboardingTemplateService.js';

const PORT = Number(process.env.PORT) || 5000;

async function bootstrap() {
  await connectDb();
  try {
    const result = await syncServiceTemplates();
    // eslint-disable-next-line no-console
    console.log(`[onboarding] synced ${result.synced} service templates`);
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error('[onboarding] template sync failed', e);
  }
  const server = http.createServer(app);
  attachSocketServer(server);

  await new Promise((resolve, reject) => {
    server.once('error', (err) => {
      if (err.code === 'EADDRINUSE') {
        // eslint-disable-next-line no-console
        console.error(`Port ${PORT} is already in use. Stop the other process or set PORT in .env.`);
      }
      reject(err);
    });
    server.listen(PORT, () => {
      server.removeListener('error', reject);
      // eslint-disable-next-line no-console
      console.log(`API listening on port ${PORT} (HTTP + Socket.IO)`);
      resolve();
    });
  });

  const shutdown = () => {
    server.close(() => process.exit(0));
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

bootstrap().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('Failed to start server', err);
  process.exit(1);
});
