import { Router } from 'express';
import {
  and,
  count,
  desc,
  eq,
  gt,
  inArray,
  lt,
  ne,
  sql,
  type SQL,
} from 'drizzle-orm';
import { db } from '../db/index.ts';
import { bookings, resources, users } from '../db/schema.ts';
import { ApiError, handleRouteError, sendApiError } from '../lib/errors.ts';
import {
  type AuthRequest,
  requireAdmin,
  requireAuth,
} from '../middleware/auth.ts';

const router = Router();

const BOOKING_STATUSES = [
  'PENDING',
  'APPROVED',
  'REJECTED',
  'CANCELLED',
] as const;
type BookingStatus = (typeof BOOKING_STATUSES)[number];

function parsePositiveId(raw: string): number | null {
  if (!/^\d+$/.test(raw)) {
    return null;
  }
  const num = Number(raw);
  return Number.isSafeInteger(num) && num > 0 ? num : null;
}

function isAlignedTo30MinUtcGrid(date: Date): boolean {
  return (
    date.getUTCMinutes() % 30 === 0 &&
    date.getUTCSeconds() === 0 &&
    date.getUTCMilliseconds() === 0
  );
}

router.get('/', requireAuth, async (req: AuthRequest, res) => {
  try {
    const actor = req.authUser!;
    const conditions: SQL[] = [];

    if (actor.role !== 'ADMIN' || req.query.mine === 'true') {
      conditions.push(eq(bookings.userId, actor.id));
    }

    const status = req.query.status;
    if (typeof status === 'string' && status.trim().length > 0) {
      if (!BOOKING_STATUSES.includes(status as BookingStatus)) {
        return sendApiError(
          res,
          400,
          'VALIDATION_ERROR',
          `Invalid status filter. Expected one of: ${BOOKING_STATUSES.join(', ')}.`
        );
      }
      conditions.push(eq(bookings.status, status));
    }

    const resourceIdParam = req.query.resourceId;
    if (
      typeof resourceIdParam === 'string' &&
      resourceIdParam.trim().length > 0
    ) {
      const parsedResourceId = parsePositiveId(resourceIdParam.trim());
      if (!parsedResourceId) {
        return sendApiError(
          res,
          400,
          'VALIDATION_ERROR',
          'resourceId filter must be a positive integer.'
        );
      }
      conditions.push(eq(bookings.resourceId, parsedResourceId));
    }

    const rows = await db
      .select({
        id: bookings.id,
        resourceId: bookings.resourceId,
        resourceName: resources.name,
        resourceType: resources.type,
        resourceLocation: resources.location,
        userId: bookings.userId,
        userEmail: users.email,
        userName: users.name,
        title: bookings.title,
        notes: bookings.notes,
        startTime: bookings.startTime,
        endTime: bookings.endTime,
        status: bookings.status,
        reviewedById: bookings.reviewedById,
        createdAt: bookings.createdAt,
        updatedAt: bookings.updatedAt,
      })
      .from(bookings)
      .innerJoin(resources, eq(bookings.resourceId, resources.id))
      .innerJoin(users, eq(bookings.userId, users.id))
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(bookings.startTime), desc(bookings.id));

    res.json({ bookings: rows });
  } catch (err) {
    handleRouteError(res, err);
  }
});

router.get('/:id', requireAuth, async (req: AuthRequest, res) => {
  try {
    const actor = req.authUser!;
    const id = parsePositiveId(req.params.id);
    if (!id) {
      return sendApiError(res, 404, 'NOT_FOUND', 'Booking not found.');
    }

    const rows = await db
      .select({
        id: bookings.id,
        resourceId: bookings.resourceId,
        resourceName: resources.name,
        resourceType: resources.type,
        resourceLocation: resources.location,
        userId: bookings.userId,
        userEmail: users.email,
        userName: users.name,
        title: bookings.title,
        notes: bookings.notes,
        startTime: bookings.startTime,
        endTime: bookings.endTime,
        status: bookings.status,
        reviewedById: bookings.reviewedById,
        createdAt: bookings.createdAt,
        updatedAt: bookings.updatedAt,
      })
      .from(bookings)
      .innerJoin(resources, eq(bookings.resourceId, resources.id))
      .innerJoin(users, eq(bookings.userId, users.id))
      .where(eq(bookings.id, id))
      .limit(1);

    if (rows.length === 0) {
      return sendApiError(res, 404, 'NOT_FOUND', 'Booking not found.');
    }

    const booking = rows[0];
    if (actor.role !== 'ADMIN' && booking.userId !== actor.id) {
      return sendApiError(
        res,
        403,
        'FORBIDDEN_OWNERSHIP',
        'You do not have permission to view this booking.'
      );
    }

    res.json({ booking });
  } catch (err) {
    handleRouteError(res, err);
  }
});

router.post('/', requireAuth, async (req: AuthRequest, res) => {
  try {
    const actor = req.authUser!;
    const { resourceId, title, notes, startTime, durationMinutes, endTime } =
      req.body ?? {};

    // Step 5 (400/422 validation) before referenced ID & conflict checks
    if (
      typeof resourceId !== 'number' ||
      !Number.isInteger(resourceId) ||
      resourceId <= 0
    ) {
      return sendApiError(
        res,
        422,
        'VALIDATION_ERROR',
        'resourceId must be a positive integer.'
      );
    }

    if (typeof title !== 'string' || title.trim().length < 2) {
      return sendApiError(
        res,
        422,
        'VALIDATION_ERROR',
        'Booking title must be at least 2 characters.'
      );
    }

    if (typeof startTime !== 'string') {
      return sendApiError(
        res,
        422,
        'VALIDATION_ERROR',
        'startTime must be a valid UTC ISO 8601 timestamp.'
      );
    }

    const start = new Date(startTime);
    if (Number.isNaN(start.getTime())) {
      return sendApiError(
        res,
        422,
        'VALIDATION_ERROR',
        'startTime is not a valid date.'
      );
    }

    if (!isAlignedTo30MinUtcGrid(start)) {
      return sendApiError(
        res,
        422,
        'VALIDATION_ERROR',
        'startTime must be aligned to the 30-minute UTC grid (00 or 30 minutes, 0 seconds, 0 ms).'
      );
    }

    let computedEnd: Date;
    if (durationMinutes !== undefined) {
      const dur = Number(durationMinutes);
      if (
        !Number.isInteger(dur) ||
        dur < 30 ||
        dur > 240 ||
        dur % 30 !== 0
      ) {
        return sendApiError(
          res,
          422,
          'VALIDATION_ERROR',
          'durationMinutes must be a multiple of 30 between 30 and 240 minutes.'
        );
      }
      computedEnd = new Date(start.getTime() + dur * 60 * 1000);
    } else if (typeof endTime === 'string') {
      computedEnd = new Date(endTime);
      if (Number.isNaN(computedEnd.getTime())) {
        return sendApiError(
          res,
          422,
          'VALIDATION_ERROR',
          'endTime is not a valid date.'
        );
      }
      if (!isAlignedTo30MinUtcGrid(computedEnd)) {
        return sendApiError(
          res,
          422,
          'VALIDATION_ERROR',
          'endTime must be aligned to the 30-minute UTC grid.'
        );
      }
      const diffMins = (computedEnd.getTime() - start.getTime()) / (60 * 1000);
      if (diffMins < 30 || diffMins > 240 || diffMins % 30 !== 0) {
        return sendApiError(
          res,
          422,
          'VALIDATION_ERROR',
          'Booking duration must be between 30 and 240 minutes in 30-minute increments.'
        );
      }
    } else {
      return sendApiError(
        res,
        422,
        'VALIDATION_ERROR',
        'Provide either durationMinutes (30-240) or endTime.'
      );
    }

    const nowMs = Date.now();
    const maxFutureMs = nowMs + 30 * 24 * 60 * 60 * 1000;
    if (start.getTime() <= nowMs) {
      return sendApiError(
        res,
        422,
        'VALIDATION_ERROR',
        'startTime must be in the future.'
      );
    }
    if (start.getTime() > maxFutureMs) {
      return sendApiError(
        res,
        422,
        'VALIDATION_ERROR',
        'startTime must be within 30 days from now.'
      );
    }

    // Atomic transactional booking with pessimistic row locks on resource and user
    const createdBooking = await db.transaction(async (tx) => {
      // 1. Lock target resource row (serializes concurrent bookings for the same resource)
      const resourceLock = await tx.execute<{
        id: number;
        is_active: boolean;
      }>(
        sql`SELECT id, is_active FROM resources WHERE id = ${resourceId} FOR UPDATE`
      );

      if (resourceLock.rows.length === 0) {
        throw new ApiError(
          404,
          'REFERENCED_NOT_FOUND',
          'Referenced resource does not exist.'
        );
      }

      if (!resourceLock.rows[0].is_active) {
        throw new ApiError(
          409,
          'RESOURCE_INACTIVE',
          'Cannot book an inactive resource.'
        );
      }

      // 2. Lock requesting user row (serializes concurrent bookings by the same user)
      await tx.execute(
        sql`SELECT id FROM users WHERE id = ${actor.id} FOR UPDATE`
      );

      // 3. Enforce max 3 future PENDING/APPROVED bookings per user
      const now = new Date();
      const activeUserBookings = await tx
        .select({ total: count() })
        .from(bookings)
        .where(
          and(
            eq(bookings.userId, actor.id),
            inArray(bookings.status, ['PENDING', 'APPROVED']),
            gt(bookings.endTime, now)
          )
        );

      if (Number(activeUserBookings[0]?.total ?? 0) >= 3) {
        throw new ApiError(
          409,
          'BOOKING_LIMIT_EXCEEDED',
          'Maximum 3 active future PENDING or APPROVED bookings allowed per user.'
        );
      }

      // 4. Enforce non-overlapping slot rule: newStart < existingEnd AND newEnd > existingStart
      const overlapping = await tx
        .select({ id: bookings.id })
        .from(bookings)
        .where(
          and(
            eq(bookings.resourceId, resourceId),
            inArray(bookings.status, ['PENDING', 'APPROVED']),
            lt(bookings.startTime, computedEnd),
            gt(bookings.endTime, start)
          )
        )
        .limit(1);

      if (overlapping.length > 0) {
        throw new ApiError(
          409,
          'SLOT_CONFLICT',
          'Requested slot overlaps with an existing PENDING or APPROVED booking.'
        );
      }

      const [inserted] = await tx
        .insert(bookings)
        .values({
          resourceId,
          userId: actor.id,
          title: title.trim(),
          notes: typeof notes === 'string' ? notes.trim() : '',
          startTime: start,
          endTime: computedEnd,
          status: 'PENDING',
        })
        .returning();

      return inserted;
    });

    res.status(201).json({ booking: createdBooking });
  } catch (err) {
    handleRouteError(res, err);
  }
});

router.post(
  '/:id/approve',
  requireAuth,
  requireAdmin,
  async (req: AuthRequest, res) => {
    try {
      const actor = req.authUser!;
      const id = parsePositiveId(req.params.id);
      if (!id) {
        return sendApiError(res, 404, 'NOT_FOUND', 'Booking not found.');
      }

      const updated = await db.transaction(async (tx) => {
        const existingRows = await tx
          .select()
          .from(bookings)
          .where(eq(bookings.id, id))
          .limit(1);

        if (existingRows.length === 0) {
          throw new ApiError(404, 'NOT_FOUND', 'Booking not found.');
        }

        const existing = existingRows[0];
        if (existing.status !== 'PENDING') {
          throw new ApiError(
            409,
            'INVALID_STATUS_TRANSITION',
            `Only PENDING bookings can be approved (current status: ${existing.status}).`
          );
        }

        // Lock resource to serialize approval against concurrent operations
        await tx.execute(
          sql`SELECT id FROM resources WHERE id = ${existing.resourceId} FOR UPDATE`
        );

        const conflicts = await tx
          .select({ id: bookings.id })
          .from(bookings)
          .where(
            and(
              eq(bookings.resourceId, existing.resourceId),
              ne(bookings.id, existing.id),
              inArray(bookings.status, ['PENDING', 'APPROVED']),
              lt(bookings.startTime, existing.endTime),
              gt(bookings.endTime, existing.startTime)
            )
          )
          .limit(1);

        if (conflicts.length > 0) {
          throw new ApiError(
            409,
            'SLOT_CONFLICT',
            'Cannot approve: slot overlaps another active booking.'
          );
        }

        const [approved] = await tx
          .update(bookings)
          .set({
            status: 'APPROVED',
            reviewedById: actor.id,
            updatedAt: new Date(),
          })
          .where(eq(bookings.id, id))
          .returning();

        return approved;
      });

      res.json({ booking: updated });
    } catch (err) {
      handleRouteError(res, err);
    }
  }
);

router.post(
  '/:id/reject',
  requireAuth,
  requireAdmin,
  async (req: AuthRequest, res) => {
    try {
      const actor = req.authUser!;
      const id = parsePositiveId(req.params.id);
      if (!id) {
        return sendApiError(res, 404, 'NOT_FOUND', 'Booking not found.');
      }

      const existingRows = await db
        .select()
        .from(bookings)
        .where(eq(bookings.id, id))
        .limit(1);

      if (existingRows.length === 0) {
        return sendApiError(res, 404, 'NOT_FOUND', 'Booking not found.');
      }

      const existing = existingRows[0];
      if (existing.status !== 'PENDING') {
        return sendApiError(
          res,
          409,
          'INVALID_STATUS_TRANSITION',
          `Only PENDING bookings can be rejected (current status: ${existing.status}).`
        );
      }

      const [rejected] = await db
        .update(bookings)
        .set({
          status: 'REJECTED',
          reviewedById: actor.id,
          updatedAt: new Date(),
        })
        .where(eq(bookings.id, id))
        .returning();

      res.json({ booking: rejected });
    } catch (err) {
      handleRouteError(res, err);
    }
  }
);

router.post('/:id/cancel', requireAuth, async (req: AuthRequest, res) => {
  try {
    const actor = req.authUser!;
    const id = parsePositiveId(req.params.id);
    if (!id) {
      return sendApiError(res, 404, 'NOT_FOUND', 'Booking not found.');
    }

    const existingRows = await db
      .select()
      .from(bookings)
      .where(eq(bookings.id, id))
      .limit(1);

    if (existingRows.length === 0) {
      return sendApiError(res, 404, 'NOT_FOUND', 'Booking not found.');
    }

    const existing = existingRows[0];
    if (actor.role !== 'ADMIN' && existing.userId !== actor.id) {
      return sendApiError(
        res,
        403,
        'FORBIDDEN_OWNERSHIP',
        'You do not have permission to cancel this booking.'
      );
    }

    if (existing.status === 'CANCELLED' || existing.status === 'REJECTED') {
      return sendApiError(
        res,
        409,
        'INVALID_STATUS_TRANSITION',
        `Booking is already ${existing.status}.`
      );
    }

    const [cancelled] = await db
      .update(bookings)
      .set({
        status: 'CANCELLED',
        updatedAt: new Date(),
      })
      .where(eq(bookings.id, id))
      .returning();

    res.json({ booking: cancelled });
  } catch (err) {
    handleRouteError(res, err);
  }
});

export default router;
