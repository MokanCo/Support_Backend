/** Bcrypt cost factor (10 ≈ 250ms on typical hardware; 12 is slower on small VPS). */
export const BCRYPT_ROUNDS = Math.min(
  14,
  Math.max(8, Number(process.env.BCRYPT_ROUNDS) || 10),
);
