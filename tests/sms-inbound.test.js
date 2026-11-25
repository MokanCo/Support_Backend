import assert from 'node:assert/strict';
import http from 'node:http';
import { describe, it } from 'node:test';
import express from 'express';
import { errorHandler } from '../src/middleware/errorHandler.js';
import { createSmsRouter } from '../src/routes/smsRoutes.js';
import { messagingRejectionReason } from '../src/services/smsAuth.js';
import { parseMessageReceived, zonedDayStart } from '../src/services/smsPayload.js';
import {
  createMemorySmsRepo,
  getSmsConversation,
  getSmsOverview,
  ingestInbound,
  markSmsRead,
} from '../src/services/smsService.js';
import { emitSmsInbound, setSocketIo } from '../src/realtime/messageHub.js';

const env = {
  API_PUBLIC_URL: 'https://api-docs-staging.mokanco.com',
  BANDWIDTH_MESSAGING_USERNAME: 'sms-user',
  BANDWIDTH_MESSAGING_PASSWORD: 'sms-pass',
  BANDWIDTH_MESSAGING_APPLICATION_ID: 'app-1',
  BANDWIDTH_WEBHOOK_USERNAME: 'moka-voice',
  BANDWIDTH_WEBHOOK_PASSWORD: 'voice-pass',
};

function basic(user, pass) {
  return `Basic ${Buffer.from(`${user}:${pass}`).toString('base64')}`;
}

function callback(id = '14762070468292kw2fuqty55yp2b2', overrides = {}) {
  return [
    {
      type: 'message-received',
      time: '2026-11-25T15:04:00.000Z',
      description: 'Incoming message received',
      to: '+13376040529',
      message: {
        id,
        owner: '+13376040529',
        applicationId: 'app-1',
        time: '2026-11-25T15:04:00.000Z',
        segmentCount: 1,
        direction: 'in',
        to: ['+13376040529'],
        from: '+15556667777',
        text: 'Hello from Bandwidth',
        media: ['https://messaging.bandwidth.com/api/v2/users/1/media/abc'],
        ...overrides,
      },
    },
  ];
}

function appFor(repo, notify) {
  const app = express();
  app.use(express.json());
  app.use('/api/ai-receptionist/sms', createSmsRouter({ env, repo, notify }));
  app.use(errorHandler);
  return app;
}

async function request(app, { method = 'POST', path = '/api/ai-receptionist/sms/inbound', headers = {}, body }) {
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  try {
    const response = await fetch(`http://127.0.0.1:${port}${path}`, {
      method,
      headers: { 'Content-Type': 'application/json', ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await response.text();
    return { status: response.status, body: text ? JSON.parse(text) : null };
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

describe('Bandwidth inbound SMS', () => {
  it('rejects a webhook without messaging basic auth', async () => {
    const response = await request(appFor(createMemorySmsRepo(), () => {}), { body: callback() });
    assert.equal(response.status, 401);
  });

  it('does not accept the voice webhook password', () => {
    const reason = messagingRejectionReason(
      { get: () => basic('moka-voice', 'voice-pass') },
      env,
    );
    assert.equal(reason, 'authorization_mismatch');
  });

  it('rejects a payload that is not a Bandwidth event array', async () => {
    const response = await request(appFor(createMemorySmsRepo(), () => {}), {
      headers: { Authorization: basic('sms-user', 'sms-pass') },
      body: { from: '+15556667777', to: '+13376040529', text: 'no' },
    });
    assert.equal(response.status, 400);
  });

  it('rejects a message-received event with no id or text', () => {
    assert.throws(
      () => parseMessageReceived(callback('x', { id: '', text: '   ', media: [] }), env),
      /message\.id is required/,
    );
    assert.throws(
      () => parseMessageReceived(callback('x', { text: '   ', media: [] }), env),
      /message\.text or message\.media is required/,
    );
  });

  it('stores a valid callback, ignores a duplicate, and notifies once', async () => {
    const repo = createMemorySmsRepo();
    const notices = [];
    const app = appFor(repo, (message) => {
      notices.push(message);
    });
    const headers = { Authorization: basic('sms-user', 'sms-pass') };
    const first = await request(app, { headers, body: callback() });
    const second = await request(app, { headers, body: callback() });
    assert.equal(first.status, 200);
    assert.deepEqual(first.body, { received: true, saved: 1, duplicates: 0 });
    assert.deepEqual(second.body, { received: true, saved: 0, duplicates: 1 });
    assert.equal(notices.length, 1);
    assert.equal(notices[0].fromNumber, '+15556667777');
    assert.equal(notices[0].toNumber, '+13376040529');
    assert.equal(notices[0].messageText, 'Hello from Bandwidth');
    assert.equal(notices[0].mediaUrls.length, 1);
    assert.equal(notices[0].status, 'received');

    const conversation = await getSmsConversation('+15556667777', { repo });
    assert.equal(conversation.messages.length, 1);
    const overview = await getSmsOverview({ repo, now: new Date('2026-11-25T16:00:00.000Z') });
    assert.equal(overview.totalInbound, 1);
    assert.equal(overview.unread, 1);
    assert.equal(overview.today, 1);

    await markSmsRead(notices[0].id, { repo });
    const after = await getSmsOverview({ repo, now: new Date('2026-11-25T16:00:00.000Z') });
    assert.equal(after.unread, 0);
    assert.equal(after.totalInbound, 1);
  });

  it('emits an sms:inbound event to admin dashboard sockets', async () => {
    const emitted = [];
    setSocketIo({
      to(room) {
        return {
          emit(event, payload) {
            emitted.push({ room, event, payload });
          },
        };
      },
    });
    const message = { id: '1', fromNumber: '+15556667777', messageText: 'Hello' };
    await emitSmsInbound(message, async () => ['admin-1']);
    setSocketIo(null);
    assert.equal(emitted.length, 1);
    assert.equal(emitted[0].room, 'user:admin-1');
    assert.equal(emitted[0].event, 'sms:inbound');
    assert.equal(emitted[0].payload.message.messageText, 'Hello');
  });

  it('uses America/New_York midnight for today', () => {
    assert.equal(zonedDayStart('2026-11-25').toISOString(), '2026-11-25T05:00:00.000Z');
  });

  it('ignores delivery receipts and does not save them', async () => {
    const result = await ingestInbound(
      [{ type: 'message-delivered', time: '2026-11-25T15:05:00.000Z', message: { id: 'other' } }],
      { env, repo: createMemorySmsRepo(), notify() { throw new Error('should not notify'); } },
    );
    assert.deepEqual(result, { received: true, saved: 0, duplicates: 0 });
  });
});
