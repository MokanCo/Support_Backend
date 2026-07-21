import 'dotenv/config';
import http from 'http';
import app from './app.js';
import { connectDb } from './config/db.js';
import { logMailProviderStatus } from './services/mailSender.js';
import { attachSocketServer } from './realtime/socketServer.js';
import { syncServiceTemplates } from './services/onboardingTemplateService.js';
import { runOpeningDateJobs } from './services/onboardingScheduler.js';

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
  void logMailProviderStatus();
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

  // Daily scheduler: auto-create location/user for requests whose opening date has arrived
  const SCHEDULER_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24 hours
  const runScheduler = async () => {
    try {
      const result = await runOpeningDateJobs();
      if (result.processed > 0) {
        // eslint-disable-next-line no-console
        console.log(`[scheduler] opening-date jobs: ${result.processed} processed, ${result.errors} errors`);
      }
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error('[scheduler] opening-date job failed', e);
    }
  };
  await runScheduler();
  setInterval(() => { void runScheduler(); }, SCHEDULER_INTERVAL_MS);

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
