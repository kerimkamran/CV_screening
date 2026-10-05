import { randomBytes, randomInt, scrypt, timingSafeEqual, type ScryptOptions } from 'node:crypto';

const N = 32768;
const R = 8;
const P = 1;
const KEYLEN = 32;

const derive = (pw: string, salt: Buffer, n: number, r: number, p: number) =>
  new Promise<Buffer>((resolve, reject) => {
    const opts: ScryptOptions = { N: n, r, p, maxmem: 128 * n * r + 1024 * 1024 };
    scrypt(pw.normalize('NFKC'), salt, KEYLEN, opts, (e, key) => (e ? reject(e) : resolve(key)));
  });

export async function hashPassword(pw: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await derive(pw, salt, N, R, P);
  return `scrypt$${N}$${R}$${P}$${salt.toString('base64')}$${key.toString('base64')}`;
}

/** Constant-time verify. Malformed stored hashes verify as false. */
export async function verifyPassword(pw: string, stored: string): Promise<boolean> {
  const [alg, n, r, p, salt, hash] = stored.split('$');
  if (alg !== 'scrypt' || !n || !r || !p || !salt || !hash) return false;
  const expected = Buffer.from(hash, 'base64');
  const actual = await derive(pw, Buffer.from(salt, 'base64'), Number(n), Number(r), Number(p));
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

/** Burned on unknown-email logins so response time does not reveal which emails exist. */
export const DUMMY_HASH =
  'scrypt$32768$8$1$AAAAAAAAAAAAAAAAAAAAAA==$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=';

// No 0/O/1/l/I: a password read off an email or screen must survive transcription.
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';

/** 16 characters, ~91 bits, from a CSPRNG. */
export function generatePassword(length = 16): string {
  let out = '';
  for (let i = 0; i < length; i++) out += ALPHABET[randomInt(ALPHABET.length)];
  return out;
}

/** Policy for user-chosen passwords. Length over composition rules (NIST 800-63B). */
export function passwordProblem(pw: string, email: string): string | null {
  if (pw.length < 12) return 'must be at least 12 characters';
  if (pw.length > 128) return 'must be at most 128 characters';
  if (
    pw.toLowerCase().includes(email.split('@')[0]!.toLowerCase()) &&
    email.split('@')[0]!.length >= 4
  )
    return 'must not contain your email name';
  if (/^(.)\1+$/.test(pw)) return 'is too repetitive';
  return null;
}
