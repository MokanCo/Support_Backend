import bcrypt from 'bcrypt';
import User from '../models/User.js';

const SYSTEM_EMAIL = 'support-system@mokanco.internal';

/** Lazily created virtual sender for automated ticket messages (never used for login). */
export async function getSystemSenderUserId() {
  let u = await User.findOne({ email: SYSTEM_EMAIL }).select('_id');
  if (u) return u._id;
  const hash = await bcrypt.hash(`sys-${Date.now()}-${Math.random().toString(36)}`, 10);
  try {
    u = await User.create({
      name: 'Support',
      email: SYSTEM_EMAIL,
      password: hash,
      role: 'support',
      locationId: null,
    });
    return u._id;
  } catch (e) {
    if (e && typeof e === 'object' && 'code' in e && e.code === 11000) {
      const again = await User.findOne({ email: SYSTEM_EMAIL }).select('_id');
      if (again) return again._id;
    }
    throw e;
  }
}
