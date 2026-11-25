import crypto from 'node:crypto';
import { Router } from 'express';
import { and, eq, isNotNull } from 'drizzle-orm';
import { db } from '../db/index.ts';
import { users } from '../db/schema.ts';
import {
  createDbSession,
  hashPassword,
  revokeDbSession,
  verifyPassword,
} from '../lib/auth-tokens.ts';
import { handleRouteError, sendApiError } from '../lib/errors.ts';
import { adminAuth } from '../lib/firebase-admin.ts';
import {
  type AuthRequest,
  requireAuth,
  upsertFirebaseUser,
} from '../middleware/auth.ts';

const router = Router();

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

async function hasClaimedAdminPassword(): Promise<boolean> {
  const rows = await db
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.role, 'ADMIN'), isNotNull(users.passwordHash)))
    .limit(1);
  return rows.length > 0;
}

router.get('/setup-status', async (_req, res) => {
  try {
    const envPasscodeSet = Boolean(
      process.env.ADMIN_PASSCODE && process.env.ADMIN_PASSCODE.trim().length > 0
    );
    const claimed = await hasClaimedAdminPassword();
    res.json({
      needsAdminSetup: !envPasscodeSet && !claimed,
    });
  } catch (err) {
    handleRouteError(res, err);
  }
});

router.post('/claim-admin', async (req, res) => {
  try {
    const envPasscodeSet = Boolean(
      process.env.ADMIN_PASSCODE && process.env.ADMIN_PASSCODE.trim().length > 0
    );
    if (envPasscodeSet) {
      return sendApiError(
        res,
        409,
        'ADMIN_ALREADY_CONFIGURED',
        'Admin credentials are configured via server environment.'
      );
    }

    const { email, name, password } = req.body ?? {};
    if (
      typeof email !== 'string' ||
      !isValidEmail(email.trim()) ||
      typeof password !== 'string' ||
      password.length < 8
    ) {
      return sendApiError(
        res,
        422,
        'VALIDATION_ERROR',
        'Provide a valid admin email and a password of at least 8 characters.'
      );
    }

    const normalizedEmail = email.trim().toLowerCase();
    const displayName =
      typeof name === 'string' && name.trim().length > 0
        ? name.trim()
        : 'Operations Admin';

    const result = await db.transaction(async (tx) => {
      const existingClaimed = await tx
        .select({ id: users.id })
        .from(users)
        .where(and(eq(users.role, 'ADMIN'), isNotNull(users.passwordHash)))
        .limit(1);

      if (existingClaimed.length > 0) {
        return { conflict: true as const };
      }

      const passwordHash = await hashPassword(password);
      const existingByEmail = await tx
        .select()
        .from(users)
        .where(eq(users.email, normalizedEmail))
        .limit(1);

      if (existingByEmail.length > 0) {
        const [updated] = await tx
          .update(users)
          .set({
            name: displayName,
            role: 'ADMIN',
            passwordHash,
          })
          .where(eq(users.id, existingByEmail[0].id))
          .returning();
        return { conflict: false as const, user: updated };
      }

      const [created] = await tx
        .insert(users)
        .values({
          uid: `local:${crypto.randomUUID()}`,
          email: normalizedEmail,
          name: displayName,
          role: 'ADMIN',
          passwordHash,
        })
        .returning();
      return { conflict: false as const, user: created };
    });

    if (result.conflict) {
      return sendApiError(
        res,
        409,
        'ADMIN_ALREADY_CLAIMED',
        'An admin account has already been claimed.'
      );
    }

    const token = await createDbSession(result.user.id);

    res.status(201).json({
      token,
      user: {
        id: result.user.id,
        uid: result.user.uid,
        email: result.user.email,
        name: result.user.name,
        role: 'ADMIN',
      },
    });
  } catch (err) {
    handleRouteError(res, err);
  }
});

router.post('/register', async (req, res) => {
  try {
    const { email, name, password } = req.body ?? {};
    if (
      typeof email !== 'string' ||
      !isValidEmail(email.trim()) ||
      typeof name !== 'string' ||
      name.trim().length < 2 ||
      typeof password !== 'string' ||
      password.length < 8
    ) {
      return sendApiError(
        res,
        422,
        'VALIDATION_ERROR',
        'Valid email, name (min 2 chars), and password (min 8 chars) are required.'
      );
    }

    const normalizedEmail = email.trim().toLowerCase();
    const existing = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.email, normalizedEmail))
      .limit(1);

    if (existing.length > 0) {
      return sendApiError(
        res,
        409,
        'EMAIL_ALREADY_EXISTS',
        'An account with this email already exists.'
      );
    }

    const passwordHash = await hashPassword(password);
    const [created] = await db
      .insert(users)
      .values({
        uid: `local:${crypto.randomUUID()}`,
        email: normalizedEmail,
        name: name.trim(),
        role: 'USER',
        passwordHash,
      })
      .returning();

    const token = await createDbSession(created.id);

    res.status(201).json({
      token,
      user: {
        id: created.id,
        uid: created.uid,
        email: created.email,
        name: created.name,
        role: 'USER',
      },
    });
  } catch (err) {
    handleRouteError(res, err);
  }
});

router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body ?? {};
    if (
      typeof email !== 'string' ||
      !isValidEmail(email.trim()) ||
      typeof password !== 'string' ||
      password.length === 0
    ) {
      return sendApiError(
        res,
        422,
        'VALIDATION_ERROR',
        'Email and password are required.'
      );
    }

    const normalizedEmail = email.trim().toLowerCase();
    const rows = await db
      .select()
      .from(users)
      .where(eq(users.email, normalizedEmail))
      .limit(1);

    if (rows.length === 0) {
      return sendApiError(
        res,
        401,
        'INVALID_CREDENTIALS',
        'Invalid email or password.'
      );
    }

    const user = rows[0];

    // Optional server-configured ADMIN_PASSCODE overrides admin login when set
    const configuredPasscode = process.env.ADMIN_PASSCODE?.trim();
    const isAdminEnvMatch =
      user.role === 'ADMIN' &&
      configuredPasscode &&
      configuredPasscode.length > 0 &&
      password.length === configuredPasscode.length &&
      crypto.timingSafeEqual(
        Buffer.from(password),
        Buffer.from(configuredPasscode)
      );

    if (!isAdminEnvMatch) {
      if (!user.passwordHash) {
        return sendApiError(
          res,
          401,
          'INVALID_CREDENTIALS',
          'This account uses Google Sign-In or has not set a password yet.'
        );
      }
      const valid = await verifyPassword(password, user.passwordHash);
      if (!valid) {
        return sendApiError(
          res,
          401,
          'INVALID_CREDENTIALS',
          'Invalid email or password.'
        );
      }
    }

    const role = user.role === 'ADMIN' ? 'ADMIN' : 'USER';
    const token = await createDbSession(user.id);

    res.json({
      token,
      user: {
        id: user.id,
        uid: user.uid,
        email: user.email,
        name: user.name,
        role,
      },
    });
  } catch (err) {
    handleRouteError(res, err);
  }
});

router.post('/firebase', async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    const headerToken =
      authHeader && authHeader.startsWith('Bearer ')
        ? authHeader.slice('Bearer '.length).trim()
        : undefined;
    const idToken = headerToken || req.body?.idToken;

    if (typeof idToken !== 'string' || !idToken) {
      return sendApiError(
        res,
        401,
        'UNAUTHORIZED',
        'Firebase ID token is required.'
      );
    }

    let decoded;
    try {
      decoded = await adminAuth.verifyIdToken(idToken);
    } catch {
      return sendApiError(
        res,
        401,
        'UNAUTHORIZED',
        'Invalid or expired Firebase ID token.'
      );
    }

    const email = decoded.email || `${decoded.uid}@firebase.local`;
    const user = await upsertFirebaseUser(decoded.uid, email, decoded.name);
    res.json({ user });
  } catch (err) {
    handleRouteError(res, err);
  }
});

router.get('/me', requireAuth, (req: AuthRequest, res) => {
  res.json({ user: req.authUser });
});

router.post('/logout', async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.slice('Bearer '.length).trim();
      await revokeDbSession(token);
    }
    res.json({ ok: true });
  } catch (err) {
    handleRouteError(res, err);
  }
});

export default router;
