/**
 * Wipes all application data from MongoDB for a fresh start.
 * Removes demo seed accounts, tickets, locations, boards, messages, and notifications.
 *
 * Usage: npm run clean-db
 * Requires MONGODB_URI in .env
 */
import 'dotenv/config';
import mongoose from 'mongoose';
import { connectDb } from '../src/config/db.js';
import Location from '../src/models/Location.js';
import User from '../src/models/User.js';
import Ticket from '../src/models/Ticket.js';
import Message from '../src/models/Message.js';
import TicketActivity from '../src/models/TicketActivity.js';
import TicketInternalNote from '../src/models/TicketInternalNote.js';
import UserNotification from '../src/models/UserNotification.js';
import TicketThreadRead from '../src/models/TicketThreadRead.js';
import Board from '../src/models/Board.js';
import BoardColumn from '../src/models/BoardColumn.js';
import BoardTask from '../src/models/BoardTask.js';
import BoardTaskAttachment from '../src/models/BoardTaskAttachment.js';
import TaskComment from '../src/models/TaskComment.js';
import Counter from '../src/models/Counter.js';

const DEMO_EMAIL_PATTERN = /@mokanco\.example$/i;

async function wipeCollection(name, model) {
  const res = await model.deleteMany({});
  const n = res.deletedCount ?? 0;
  // eslint-disable-next-line no-console
  console.log(`  ${name}: ${n} removed`);
  return n;
}

async function cleanDb() {
  await connectDb();

  // eslint-disable-next-line no-console
  console.log('Cleaning database (all portal data)…\n');

  const counts = {};

  counts.boardTaskAttachments = await wipeCollection('BoardTaskAttachment', BoardTaskAttachment);
  counts.taskComments = await wipeCollection('TaskComment', TaskComment);
  counts.boardTasks = await wipeCollection('BoardTask', BoardTask);
  counts.boardColumns = await wipeCollection('BoardColumn', BoardColumn);
  counts.boards = await wipeCollection('Board', Board);

  counts.messages = await wipeCollection('Message', Message);
  counts.ticketThreadReads = await wipeCollection('TicketThreadRead', TicketThreadRead);
  counts.ticketActivities = await wipeCollection('TicketActivity', TicketActivity);
  counts.ticketInternalNotes = await wipeCollection('TicketInternalNote', TicketInternalNote);
  counts.userNotifications = await wipeCollection('UserNotification', UserNotification);
  counts.tickets = await wipeCollection('Ticket', Ticket);

  counts.users = await wipeCollection('User', User);
  counts.locations = await wipeCollection('Location', Location);
  counts.counters = await wipeCollection('Counter', Counter);

  const demoUsersLeft = await User.countDocuments({ email: DEMO_EMAIL_PATTERN });
  const demoLocsLeft = await Location.countDocuments({ email: DEMO_EMAIL_PATTERN });

  // eslint-disable-next-line no-console
  console.log('\nDatabase is empty and ready for a fresh start.');
  if (demoUsersLeft > 0 || demoLocsLeft > 0) {
    // eslint-disable-next-line no-console
    console.warn('Warning: some @mokanco.example records may remain:', {
      demoUsersLeft,
      demoLocsLeft,
    });
  } else {
    // eslint-disable-next-line no-console
    console.log('No demo (@mokanco.example) users or locations remain.');
  }

  // eslint-disable-next-line no-console
  console.log('\nTotals:', counts);
  // eslint-disable-next-line no-console
  console.log('\nCreate your first admin in the app (Locations → Users) or run npm run seed for dev-only demo data.');

  await mongoose.disconnect();
}

cleanDb().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
