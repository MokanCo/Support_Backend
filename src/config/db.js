import mongoose from 'mongoose';

const MAX_ATTEMPTS = 5;
const RETRY_DELAY_MS = 3000;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function connectDb() {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    throw new Error('MONGODB_URI is not set');
  }
  mongoose.set('strictQuery', true);

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    try {
      await mongoose.connect(uri);
      return;
    } catch (err) {
      if (attempt === MAX_ATTEMPTS) throw err;
      console.warn(
        `MongoDB connection attempt ${attempt}/${MAX_ATTEMPTS} failed (${err.code ?? err.message}), retrying in ${RETRY_DELAY_MS}ms...`,
      );
      await sleep(RETRY_DELAY_MS);
    }
  }
}

export function getConnectionState() {
  return mongoose.connection.readyState;
}
