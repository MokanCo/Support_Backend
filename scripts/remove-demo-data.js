/**
 * @deprecated Use `npm run clean-db` for a full fresh database wipe.
 * This file is kept for reference; clean-db.js clears all portal data.
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

const DEMO_USER_EMAILS = [
  'admin@mokanco.example',
  'support@mokanco.example',
  'partner@mokanco.example',
];

const DEMO_LOCATION_EMAIL = 'hq@mokanco.example';

async function removeDemoData() {
  await connectDb();

  const demoUsers = await User.find({
    email: { $in: DEMO_USER_EMAILS.map((e) => e.toLowerCase()) },
  }).select('_id email');

  let ticketsRemoved = 0;
  let messagesRemoved = 0;

  for (const u of demoUsers) {
    const uid = u._id;
    const ticketIds = await Ticket.find({
      $or: [{ createdBy: uid }, { assignedTo: uid }],
    }).distinct('_id');

    if (ticketIds.length) {
      const msg = await Message.deleteMany({ ticketId: { $in: ticketIds } });
      messagesRemoved += msg.deletedCount ?? 0;
      await TicketActivity.deleteMany({ ticket: { $in: ticketIds } });
      await TicketInternalNote.deleteMany({ ticket: { $in: ticketIds } });
      await UserNotification.deleteMany({ ticketId: { $in: ticketIds } });
      const t = await Ticket.deleteMany({ _id: { $in: ticketIds } });
      ticketsRemoved += t.deletedCount ?? 0;
    }

    await UserNotification.deleteMany({ userId: uid });
    await User.findByIdAndDelete(uid);
    // eslint-disable-next-line no-console
    console.log('Removed user:', u.email);
  }

  const demoLoc = await Location.findOne({
    email: DEMO_LOCATION_EMAIL.toLowerCase(),
  });
  if (demoLoc) {
    const remainingUsers = await User.countDocuments({ locationId: demoLoc._id });
    const remainingTickets = await Ticket.countDocuments({ locationId: demoLoc._id });
    if (remainingUsers === 0 && remainingTickets === 0) {
      await Location.findByIdAndDelete(demoLoc._id);
      // eslint-disable-next-line no-console
      console.log('Removed demo location:', DEMO_LOCATION_EMAIL);
    } else {
      // eslint-disable-next-line no-console
      console.warn(
        `Demo location ${DEMO_LOCATION_EMAIL} kept (${remainingUsers} users, ${remainingTickets} tickets still linked).`,
      );
    }
  }

  // eslint-disable-next-line no-console
  console.log('Done.', {
    usersRemoved: demoUsers.length,
    ticketsRemoved,
    messagesRemoved,
  });

  await mongoose.disconnect();
}

removeDemoData().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
