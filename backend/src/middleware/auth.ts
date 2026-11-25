import type { NextFunction, Request, Response } from 'express';
import { eq } from 'drizzle-orm';
import { db } from '../db/index.ts';
import { users } from '../db/schema.ts';
import { adminAuth } from '../lib/firebase-admin.ts';
import { verifyDbSession } from '../lib/auth-tokens.ts';
import { sendApiError } from '../lib/errors.ts';

export interface AuthenticatedUser {
  id: number;
  uid: string;
  email: string;
  name: string;
  role: 'ADMIN' | 'USER';
}

export interface AuthRequest extends Request {
  authUser?: AuthenticatedUser;
}

const OWNER_ADMIN_EMAIL = 'ayansamanta580@gmail.com';

export function resolveInitialRole(email: string): 'ADMIN' | 'USER' {
  const configuredAdmin = process.env.ADMIN_EMAIL?.trim().toLowerCase();
  const normalized = email.trim().toLowerCase();
  if (
    normalized === OWNER_ADMIN_EMAIL ||
    (configuredAdmin && normalized === configuredAdmin)
  ) {
    return 'ADMIN';
  }
  return 'USER';
}

export async function upsertFirebaseUser(
  uid: string,
  email: string,
  name?: string
): Promise<AuthenticatedUser> {
  const normalizedEmail = email.trim().toLowerCase();
  const displayName =
    name && name.trim().length > 0
      ? name.trim()
      : normalizedEmail.split('@')[0] || 'Operator';
  const defaultRole = resolveInitialRole(normalizedEmail);

  const existingByUid = await db
    .select()
    .from(users)
    .where(eq(users.uid, uid))
    .limit(1);

  if (existingByUid.length > 0) {
    const row = existingByUid[0];
    return {
      id: row.id,
      uid: row.uid,
      email: row.email,
      name: row.name,
      role: row.role === 'ADMIN' ? 'ADMIN' : 'USER',
    };
  }

  const existingByEmail = await db
    .select()
    .from(users)
    .where(eq(users.email, normalizedEmail))
    .limit(1);

  if (existingByEmail.length > 0) {
    const [updated] = await db
      .update(users)
      .set({ uid, name: displayName })
      .where(eq(users.id, existingByEmail[0].id))
      .returning();
    return {
      id: updated.id,
      uid: updated.uid,
      email: updated.email,
      name: updated.name,
      role: updated.role === 'ADMIN' ? 'ADMIN' : 'USER',
    };
  }

  const inserted = await db
    .insert(users)
    .values({
      uid,
      email: normalizedEmail,
      name: displayName,
      role: defaultRole,
    })
    .onConflictDoUpdate({
      target: users.uid,
      set: { email: normalizedEmail, name: displayName },
    })
    .returning();

  const row = inserted[0];
  return {
    id: row.id,
    uid: row.uid,
    email: row.email,
    name: row.name,
    role: row.role === 'ADMIN' ? 'ADMIN' : 'USER',
  };
}

export async function requireAuth(
  req: AuthRequest,
  res: Response,
  next: NextFunction
) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return sendApiError(
      res,
      401,
      'UNAUTHORIZED',
      'Authentication required. Provide a Bearer token.'
    );
  }

  const token = authHeader.slice('Bearer '.length).trim();
  if (!token) {
    return sendApiError(res, 401, 'UNAUTHORIZED', 'Missing Bearer token.');
  }

  // 1. Verify persistent PostgreSQL session token (email/password login or claimed admin)
  if (token.startsWith('rg.')) {
    try {
      const user = await verifyDbSession(token);
      if (!user) {
        return sendApiError(
          res,
          401,
          'UNAUTHORIZED',
          'Invalid or expired session token.'
        );
      }
      req.authUser = user;
      return next();
    } catch (err) {
      console.error('Database auth lookup error:', err);
      return sendApiError(
        res,
        500,
        'INTERNAL_SERVER_ERROR',
        'Failed to verify user session.'
      );
    }
  }

  // 2. Verify Firebase ID Token (Google Sign-In)
  try {
    const decoded = await adminAuth.verifyIdToken(token);
    const email = decoded.email || `${decoded.uid}@firebase.local`;
    const user = await upsertFirebaseUser(decoded.uid, email, decoded.name);
    req.authUser = user;
    return next();
  } catch {
    return sendApiError(
      res,
      401,
      'UNAUTHORIZED',
      'Invalid or expired authentication token.'
    );
  }
}

export function requireAdmin(
  req: AuthRequest,
  res: Response,
  next: NextFunction
) {
  if (!req.authUser) {
    return sendApiError(res, 401, 'UNAUTHORIZED', 'Authentication required.');
  }
  if (req.authUser.role !== 'ADMIN') {
    return sendApiError(
      res,
      403,
      'FORBIDDEN_ROLE',
      'Administrator privileges are required for this action.'
    );
  }
  return next();
}
