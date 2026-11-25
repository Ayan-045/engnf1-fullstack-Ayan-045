import crypto from 'node:crypto';
import { and, eq, gt } from 'drizzle-orm';
import { db } from '../db/index.ts';
import { sessions, users } from '../db/schema.ts';

export function hashPassword(password: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const salt = crypto.randomBytes(16).toString('hex');
    crypto.scrypt(password, salt, 64, (err, derivedKey) => {
      if (err) {
        reject(err);
        return;
      }
      resolve(`${salt}:${derivedKey.toString('hex')}`);
    });
  });
}

export function verifyPassword(
  password: string,
  storedHash: string
): Promise<boolean> {
  return new Promise((resolve, reject) => {
    const parts = storedHash.split(':');
    if (parts.length !== 2) {
      resolve(false);
      return;
    }
    const [salt, keyHex] = parts;
    const expectedBuffer = Buffer.from(keyHex, 'hex');
    crypto.scrypt(password, salt, 64, (err, derivedKey) => {
      if (err) {
        reject(err);
        return;
      }
      if (derivedKey.length !== expectedBuffer.length) {
        resolve(false);
        return;
      }
      resolve(crypto.timingSafeEqual(derivedKey, expectedBuffer));
    });
  });
}

function hashSessionToken(rawToken: string): string {
  return crypto.createHash('sha256').update(rawToken).digest('hex');
}

export async function createDbSession(
  userId: number,
  ttlSeconds = 60 * 60 * 24
): Promise<string> {
  const rawToken = `rg.${crypto.randomBytes(32).toString('base64url')}`;
  const tokenHash = hashSessionToken(rawToken);
  const expiresAt = new Date(Date.now() + ttlSeconds * 1000);

  await db.insert(sessions).values({
    tokenHash,
    userId,
    expiresAt,
  });

  return rawToken;
}

export async function verifyDbSession(rawToken: string) {
  if (!rawToken.startsWith('rg.')) {
    return null;
  }
  const tokenHash = hashSessionToken(rawToken);
  const now = new Date();

  const rows = await db
    .select({
      id: users.id,
      uid: users.uid,
      email: users.email,
      name: users.name,
      role: users.role,
    })
    .from(sessions)
    .innerJoin(users, eq(sessions.userId, users.id))
    .where(and(eq(sessions.tokenHash, tokenHash), gt(sessions.expiresAt, now)))
    .limit(1);

  if (rows.length === 0) {
    return null;
  }

  return {
    id: rows[0].id,
    uid: rows[0].uid,
    email: rows[0].email,
    name: rows[0].name,
    role: rows[0].role === 'ADMIN' ? ('ADMIN' as const) : ('USER' as const),
  };
}

export async function revokeDbSession(rawToken: string): Promise<void> {
  if (!rawToken.startsWith('rg.')) {
    return;
  }
  const tokenHash = hashSessionToken(rawToken);
  await db.delete(sessions).where(eq(sessions.tokenHash, tokenHash));
}
