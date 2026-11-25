import { Router } from 'express';
import { and, asc, eq, gt, inArray, lt, type SQL } from 'drizzle-orm';
import { db } from '../db/index.ts';
import { bookings, resources } from '../db/schema.ts';
import { handleRouteError, sendApiError } from '../lib/errors.ts';
import {
  type AuthRequest,
  requireAdmin,
  requireAuth,
} from '../middleware/auth.ts';

const router = Router();

export const RESOURCE_TYPES = ['ROOM', 'LAB', 'EQUIPMENT'] as const;
export type ResourceType = (typeof RESOURCE_TYPES)[number];

function parsePositiveId(raw: string): number | null {
  if (!/^\d+$/.test(raw)) {
    return null;
  }
  const num = Number(raw);
  return Number.isSafeInteger(num) && num > 0 ? num : null;
}

router.get('/', requireAuth, async (req: AuthRequest, res) => {
  try {
    const conditions: SQL[] = [];
    const type = req.query.type;
    if (typeof type === 'string' && type.trim().length > 0) {
      if (!RESOURCE_TYPES.includes(type as ResourceType)) {
        return sendApiError(
          res,
          400,
          'VALIDATION_ERROR',
          `Invalid type filter. Expected one of: ${RESOURCE_TYPES.join(', ')}.`
        );
      }
      conditions.push(eq(resources.type, type));
    }

    const activeOnly = req.query.activeOnly;
    if (activeOnly === 'true') {
      conditions.push(eq(resources.isActive, true));
    }

    const rows = await db
      .select()
      .from(resources)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(asc(resources.type), asc(resources.name));

    res.json({ resources: rows });
  } catch (err) {
    handleRouteError(res, err);
  }
});

router.get('/:id', requireAuth, async (req: AuthRequest, res) => {
  try {
    const id = parsePositiveId(req.params.id);
    if (!id) {
      return sendApiError(res, 404, 'NOT_FOUND', 'Resource not found.');
    }

    const rows = await db
      .select()
      .from(resources)
      .where(eq(resources.id, id))
      .limit(1);

    if (rows.length === 0) {
      return sendApiError(res, 404, 'NOT_FOUND', 'Resource not found.');
    }

    res.json({ resource: rows[0] });
  } catch (err) {
    handleRouteError(res, err);
  }
});

router.get('/:id/availability', requireAuth, async (req: AuthRequest, res) => {
  try {
    const id = parsePositiveId(req.params.id);
    if (!id) {
      return sendApiError(res, 404, 'NOT_FOUND', 'Resource not found.');
    }

    const resourceRows = await db
      .select()
      .from(resources)
      .where(eq(resources.id, id))
      .limit(1);

    if (resourceRows.length === 0) {
      return sendApiError(res, 404, 'NOT_FOUND', 'Resource not found.');
    }

    let windowStart: Date;
    let windowEnd: Date;

    if (typeof req.query.date === 'string' && req.query.date.trim().length > 0) {
      const dateStr = req.query.date.trim();
      if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
        return sendApiError(
          res,
          400,
          'VALIDATION_ERROR',
          'date parameter must follow YYYY-MM-DD format.'
        );
      }
      windowStart = new Date(`${dateStr}T00:00:00.000Z`);
      windowEnd = new Date(windowStart.getTime() + 24 * 60 * 60 * 1000);
    } else if (
      typeof req.query.from === 'string' &&
      typeof req.query.to === 'string'
    ) {
      windowStart = new Date(req.query.from);
      windowEnd = new Date(req.query.to);
      if (
        Number.isNaN(windowStart.getTime()) ||
        Number.isNaN(windowEnd.getTime()) ||
        windowEnd <= windowStart
      ) {
        return sendApiError(
          res,
          400,
          'VALIDATION_ERROR',
          'from and to must be valid ISO timestamps with to > from.'
        );
      }
    } else {
      const now = new Date();
      windowStart = new Date(
        Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
      );
      windowEnd = new Date(windowStart.getTime() + 7 * 24 * 60 * 60 * 1000);
    }

    const activeBookings = await db
      .select({
        id: bookings.id,
        title: bookings.title,
        startTime: bookings.startTime,
        endTime: bookings.endTime,
        status: bookings.status,
      })
      .from(bookings)
      .where(
        and(
          eq(bookings.resourceId, id),
          inArray(bookings.status, ['PENDING', 'APPROVED']),
          lt(bookings.startTime, windowEnd),
          gt(bookings.endTime, windowStart)
        )
      )
      .orderBy(asc(bookings.startTime));

    res.json({
      resource: resourceRows[0],
      windowStart: windowStart.toISOString(),
      windowEnd: windowEnd.toISOString(),
      bookings: activeBookings,
    });
  } catch (err) {
    handleRouteError(res, err);
  }
});

router.post('/', requireAuth, requireAdmin, async (req: AuthRequest, res) => {
  try {
    const { name, type, location, capacity, description, isActive } =
      req.body ?? {};
    if (typeof name !== 'string' || name.trim().length < 2) {
      return sendApiError(
        res,
        422,
        'VALIDATION_ERROR',
        'Resource name must be at least 2 characters.'
      );
    }
    if (
      typeof type !== 'string' ||
      !RESOURCE_TYPES.includes(type as ResourceType)
    ) {
      return sendApiError(
        res,
        422,
        'VALIDATION_ERROR',
        `Resource type must be one of: ${RESOURCE_TYPES.join(', ')}.`
      );
    }
    if (typeof location !== 'string' || location.trim().length < 2) {
      return sendApiError(
        res,
        422,
        'VALIDATION_ERROR',
        'Resource location is required.'
      );
    }

    const parsedCapacity = capacity === undefined ? 1 : Number(capacity);
    if (!Number.isInteger(parsedCapacity) || parsedCapacity < 1) {
      return sendApiError(
        res,
        422,
        'VALIDATION_ERROR',
        'Capacity must be a positive integer.'
      );
    }

    const [created] = await db
      .insert(resources)
      .values({
        name: name.trim(),
        type,
        location: location.trim(),
        capacity: parsedCapacity,
        description: typeof description === 'string' ? description.trim() : '',
        isActive: typeof isActive === 'boolean' ? isActive : true,
      })
      .returning();

    res.status(201).json({ resource: created });
  } catch (err) {
    handleRouteError(res, err);
  }
});

router.patch(
  '/:id',
  requireAuth,
  requireAdmin,
  async (req: AuthRequest, res) => {
    try {
      const id = parsePositiveId(req.params.id);
      if (!id) {
        return sendApiError(res, 404, 'NOT_FOUND', 'Resource not found.');
      }

      const existingRows = await db
        .select()
        .from(resources)
        .where(eq(resources.id, id))
        .limit(1);

      if (existingRows.length === 0) {
        return sendApiError(res, 404, 'NOT_FOUND', 'Resource not found.');
      }

      const { name, type, location, capacity, description, isActive } =
        req.body ?? {};
      const updates: Partial<typeof resources.$inferInsert> = {};

      if (name !== undefined) {
        if (typeof name !== 'string' || name.trim().length < 2) {
          return sendApiError(
            res,
            422,
            'VALIDATION_ERROR',
            'Resource name must be at least 2 characters.'
          );
        }
        updates.name = name.trim();
      }
      if (type !== undefined) {
        if (
          typeof type !== 'string' ||
          !RESOURCE_TYPES.includes(type as ResourceType)
        ) {
          return sendApiError(
            res,
            422,
            'VALIDATION_ERROR',
            `Resource type must be one of: ${RESOURCE_TYPES.join(', ')}.`
          );
        }
        updates.type = type;
      }
      if (location !== undefined) {
        if (typeof location !== 'string' || location.trim().length < 2) {
          return sendApiError(
            res,
            422,
            'VALIDATION_ERROR',
            'Location must be at least 2 characters.'
          );
        }
        updates.location = location.trim();
      }
      if (capacity !== undefined) {
        const cap = Number(capacity);
        if (!Number.isInteger(cap) || cap < 1) {
          return sendApiError(
            res,
            422,
            'VALIDATION_ERROR',
            'Capacity must be a positive integer.'
          );
        }
        updates.capacity = cap;
      }
      if (description !== undefined) {
        if (typeof description !== 'string') {
          return sendApiError(
            res,
            422,
            'VALIDATION_ERROR',
            'Description must be a string.'
          );
        }
        updates.description = description.trim();
      }
      if (isActive !== undefined) {
        if (typeof isActive !== 'boolean') {
          return sendApiError(
            res,
            422,
            'VALIDATION_ERROR',
            'isActive must be a boolean.'
          );
        }
        updates.isActive = isActive;
      }

      if (Object.keys(updates).length === 0) {
        return sendApiError(
          res,
          422,
          'VALIDATION_ERROR',
          'No valid fields provided for update.'
        );
      }

      const [updated] = await db
        .update(resources)
        .set(updates)
        .where(eq(resources.id, id))
        .returning();

      res.json({ resource: updated });
    } catch (err) {
      handleRouteError(res, err);
    }
  }
);

router.delete(
  '/:id',
  requireAuth,
  requireAdmin,
  async (req: AuthRequest, res) => {
    try {
      const id = parsePositiveId(req.params.id);
      if (!id) {
        return sendApiError(res, 404, 'NOT_FOUND', 'Resource not found.');
      }

      const existing = await db
        .select()
        .from(resources)
        .where(eq(resources.id, id))
        .limit(1);

      if (existing.length === 0) {
        return sendApiError(res, 404, 'NOT_FOUND', 'Resource not found.');
      }

      const [deactivated] = await db
        .update(resources)
        .set({ isActive: false })
        .where(eq(resources.id, id))
        .returning();

      res.json({ resource: deactivated });
    } catch (err) {
      handleRouteError(res, err);
    }
  }
);

export default router;
