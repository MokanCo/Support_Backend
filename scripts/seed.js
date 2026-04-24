import 'dotenv/config';
import bcrypt from 'bcrypt';
import mongoose from 'mongoose';
import { connectDb } from '../src/config/db.js';
import Location from '../src/models/Location.js';
import User from '../src/models/User.js';

const SALT_ROUNDS = 12;

const DEFAULT_PASSWORD = 'ChangeMe123!';

async function seed() {
  await connectDb();

  const location = await Location.findOneAndUpdate(
    { email: 'hq@mokanco.example' },
    {
      $set: {
        name: 'Mokanco HQ',
        email: 'hq@mokanco.example',
        phone: '+1-555-0100',
        address: '100 Support Way, Example City',
      },
    },
    { new: true, upsert: true, setDefaultsOnInsert: true },
  );

  const passwordHash = await bcrypt.hash(process.env.SEED_PASSWORD || DEFAULT_PASSWORD, SALT_ROUNDS);

  const users = [
    {
      email: 'admin@mokanco.example',
      name: 'System Admin',
      role: 'admin',
      locationId: null,
    },
    {
      email: 'support@mokanco.example',
      name: 'Support Agent',
      role: 'support',
      locationId: null,
    },
    {
      email: 'partner@mokanco.example',
      name: 'Partner User',
      role: 'partner',
      locationId: location._id,
    },
  ];

  for (const u of users) {
    // eslint-disable-next-line no-await-in-loop
    await User.findOneAndUpdate(
      { email: u.email },
      {
        $set: {
          name: u.name,
          email: u.email,
          password: passwordHash,
          role: u.role,
          locationId: u.locationId,
        },
      },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    );
  }

  // eslint-disable-next-line no-console
  console.log('Seed completed.');
  // eslint-disable-next-line no-console
  console.log('Location:', location.email, String(location._id));
  // eslint-disable-next-line no-console
  console.log('Default login password:', process.env.SEED_PASSWORD || DEFAULT_PASSWORD);
  // eslint-disable-next-line no-console
  console.log('Users:', users.map((x) => x.email).join(', '));

  await mongoose.disconnect();
}

seed().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
