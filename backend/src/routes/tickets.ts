import { Router } from 'express';
import {
  and,
  asc,
  count,
  desc,
  eq,
  ilike,
  or,
  type SQL,
} from 'drizzle-orm';
import { db } from '../db/index.ts';
import { ticketEvents, tickets, users } from '../db/schema.ts';
import { handleRouteError, sendApiError } from '../lib/errors.ts';
import {
  classifyTicketDeterministic,
  TICKET_CATEGORIES,
  TICKET_PRIORITIES,
  TICKET_STATUSES,
  type TicketCategory,
  type TicketPriority,
  type TicketStatus,
} from '../lib/triage.ts';
import { type AuthRequest, requireAuth } from '../middleware/auth.ts';

const router = Router();

function parsePositiveId(raw: string): number | null {
  if (!/^\d+$/.test(raw)) {
    return null;
  }
  const num = Number(raw);
  return Number.isSafeInteger(num) && num > 0 ? num : null;
}

interface IncomingTicketPayload {
  externalId: string;
  subject: string;
  body: string;
  customerEmail: string;
}

function validateTicketInput(item: unknown): IncomingTicketPayload | string {
  if (!item || typeof item !== 'object') {
    return 'Each ticket must be an object.';
  }
  const obj = item as Record<string, unknown>;
  if (typeof obj.externalId !== 'string' || obj.externalId.trim().length === 0) {
    return 'externalId is required and must be a non-empty string.';
  }
  if (typeof obj.subject !== 'string' || obj.subject.trim().length === 0) {
    return 'subject is required and must be a non-empty string.';
  }
  if (typeof obj.body !== 'string' || obj.body.trim().length === 0) {
    return 'body is required and must be a non-empty string.';
  }
  if (
    typeof obj.customerEmail !== 'string' ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(obj.customerEmail.trim())
  ) {
    return 'customerEmail must be a valid email address.';
  }
  return {
    externalId: obj.externalId.trim(),
    subject: obj.subject.trim(),
    body: obj.body.trim(),
    customerEmail: obj.customerEmail.trim().toLowerCase(),
  };
}

router.post('/import', requireAuth, async (req: AuthRequest, res) => {
  try {
    const actor = req.authUser!;
    const rawList: unknown[] = Array.isArray(req.body?.tickets)
      ? req.body.tickets
      : req.body && typeof req.body === 'object' && 'externalId' in req.body
        ? [req.body]
        : [];

    if (rawList.length === 0 || rawList.length > 200) {
      return sendApiError(
        res,
        422,
        'VALIDATION_ERROR',
        'Provide a ticket object or a tickets array containing 1 to 200 items.'
      );
    }

    const validated: IncomingTicketPayload[] = [];
    for (let i = 0; i < rawList.length; i += 1) {
      const parsed = validateTicketInput(rawList[i]);
      if (typeof parsed === 'string') {
        return sendApiError(
          res,
          422,
          'VALIDATION_ERROR',
          `Item ${i}: ${parsed}`
        );
      }
      validated.push(parsed);
    }

    let createdCount = 0;
    let updatedCount = 0;
    let skippedCount = 0;
    const processedTickets = [];

    for (const item of validated) {
      const classification = classifyTicketDeterministic(
        item.subject,
        item.body
      );

      const outcome = await db.transaction(async (tx) => {
        const existingRows = await tx
          .select()
          .from(tickets)
          .where(eq(tickets.externalId, item.externalId))
          .limit(1);

        if (existingRows.length === 0) {
          const [inserted] = await tx
            .insert(tickets)
            .values({
              externalId: item.externalId,
              subject: item.subject,
              body: item.body,
              customerEmail: item.customerEmail,
              autoCategory: classification.autoCategory,
              category: classification.autoCategory,
              priority: classification.priority,
              status: 'OPEN',
              isHumanOverride: false,
              isReviewed: false,
            })
            .returning();

          await tx.insert(ticketEvents).values({
            ticketId: inserted.id,
            actorId: actor.id,
            actorEmail: actor.email,
            field: 'imported',
            oldValue: null,
            newValue: `${classification.autoCategory} / ${classification.priority}`,
          });

          return { action: 'created' as const, ticket: inserted };
        }

        const existing = existingRows[0];
        const subjectChanged = existing.subject !== item.subject;
        const bodyChanged = existing.body !== item.body;
        const emailChanged = existing.customerEmail !== item.customerEmail;

        const updates: Partial<typeof tickets.$inferInsert> = {};
        const eventsToInsert: Array<typeof ticketEvents.$inferInsert> = [];

        if (subjectChanged) {
          updates.subject = item.subject;
          eventsToInsert.push({
            ticketId: existing.id,
            actorId: actor.id,
            actorEmail: actor.email,
            field: 'subject',
            oldValue: existing.subject,
            newValue: item.subject,
          });
        }
        if (bodyChanged) {
          updates.body = item.body;
          eventsToInsert.push({
            ticketId: existing.id,
            actorId: actor.id,
            actorEmail: actor.email,
            field: 'body',
            oldValue: existing.body,
            newValue: item.body,
          });
        }
        if (emailChanged) {
          updates.customerEmail = item.customerEmail;
          eventsToInsert.push({
            ticketId: existing.id,
            actorId: actor.id,
            actorEmail: actor.email,
            field: 'customerEmail',
            oldValue: existing.customerEmail,
            newValue: item.customerEmail,
          });
        }

        // Re-run classification ONLY when isHumanOverride === false
        if (!existing.isHumanOverride) {
          if (existing.autoCategory !== classification.autoCategory) {
            updates.autoCategory = classification.autoCategory;
            eventsToInsert.push({
              ticketId: existing.id,
              actorId: actor.id,
              actorEmail: actor.email,
              field: 'autoCategory',
              oldValue: existing.autoCategory,
              newValue: classification.autoCategory,
            });
          }
          if (existing.category !== classification.autoCategory) {
            updates.category = classification.autoCategory;
            eventsToInsert.push({
              ticketId: existing.id,
              actorId: actor.id,
              actorEmail: actor.email,
              field: 'category',
              oldValue: existing.category,
              newValue: classification.autoCategory,
            });
          }
          if (existing.priority !== classification.priority) {
            updates.priority = classification.priority;
            eventsToInsert.push({
              ticketId: existing.id,
              actorId: actor.id,
              actorEmail: actor.email,
              field: 'priority',
              oldValue: existing.priority,
              newValue: classification.priority,
            });
          }
        }

        if (Object.keys(updates).length === 0) {
          return { action: 'skipped' as const, ticket: existing };
        }

        updates.updatedAt = new Date();
        const [updated] = await tx
          .update(tickets)
          .set(updates)
          .where(eq(tickets.id, existing.id))
          .returning();

        if (eventsToInsert.length > 0) {
          await tx.insert(ticketEvents).values(eventsToInsert);
        }

        return { action: 'updated' as const, ticket: updated };
      });

      if (outcome.action === 'created') createdCount += 1;
      else if (outcome.action === 'updated') updatedCount += 1;
      else skippedCount += 1;

      processedTickets.push(outcome.ticket);
    }

    res.status(createdCount > 0 ? 201 : 200).json({
      created: createdCount,
      updated: updatedCount,
      skipped: skippedCount,
      tickets: processedTickets,
    });
  } catch (err) {
    handleRouteError(res, err);
  }
});

router.get('/', requireAuth, async (req: AuthRequest, res) => {
  try {
    const conditions: SQL[] = [];

    const status = req.query.status;
    if (typeof status === 'string' && status.trim().length > 0) {
      if (!TICKET_STATUSES.includes(status as TicketStatus)) {
        return sendApiError(
          res,
          400,
          'VALIDATION_ERROR',
          `Invalid status filter. Expected one of: ${TICKET_STATUSES.join(', ')}.`
        );
      }
      conditions.push(eq(tickets.status, status));
    }

    const category = req.query.category;
    if (typeof category === 'string' && category.trim().length > 0) {
      if (!TICKET_CATEGORIES.includes(category as TicketCategory)) {
        return sendApiError(
          res,
          400,
          'VALIDATION_ERROR',
          `Invalid category filter. Expected one of: ${TICKET_CATEGORIES.join(', ')}.`
        );
      }
      conditions.push(eq(tickets.category, category));
    }

    const priority = req.query.priority;
    if (typeof priority === 'string' && priority.trim().length > 0) {
      if (!TICKET_PRIORITIES.includes(priority as TicketPriority)) {
        return sendApiError(
          res,
          400,
          'VALIDATION_ERROR',
          `Invalid priority filter. Expected one of: ${TICKET_PRIORITIES.join(', ')}.`
        );
      }
      conditions.push(eq(tickets.priority, priority));
    }

    const isReviewed = req.query.isReviewed;
    if (typeof isReviewed === 'string' && isReviewed.trim().length > 0) {
      if (isReviewed !== 'true' && isReviewed !== 'false') {
        return sendApiError(
          res,
          400,
          'VALIDATION_ERROR',
          'isReviewed filter must be true or false.'
        );
      }
      conditions.push(eq(tickets.isReviewed, isReviewed === 'true'));
    }

    const isHumanOverride = req.query.isHumanOverride;
    if (
      typeof isHumanOverride === 'string' &&
      isHumanOverride.trim().length > 0
    ) {
      if (isHumanOverride !== 'true' && isHumanOverride !== 'false') {
        return sendApiError(
          res,
          400,
          'VALIDATION_ERROR',
          'isHumanOverride filter must be true or false.'
        );
      }
      conditions.push(eq(tickets.isHumanOverride, isHumanOverride === 'true'));
    }

    const q = req.query.q;
    if (typeof q === 'string' && q.trim().length > 0) {
      const pattern = `%${q.trim()}%`;
      const searchCond = or(
        ilike(tickets.externalId, pattern),
        ilike(tickets.subject, pattern),
        ilike(tickets.body, pattern),
        ilike(tickets.customerEmail, pattern)
      );
      if (searchCond) {
        conditions.push(searchCond);
      }
    }

    const rawLimit = req.query.limit;
    let limit = 50;
    if (typeof rawLimit === 'string' && rawLimit.trim().length > 0) {
      const parsed = Number(rawLimit);
      if (!Number.isInteger(parsed) || parsed < 1 || parsed > 200) {
        return sendApiError(
          res,
          400,
          'VALIDATION_ERROR',
          'limit must be an integer between 1 and 200.'
        );
      }
      limit = parsed;
    }

    const rawOffset = req.query.offset;
    let offset = 0;
    if (typeof rawOffset === 'string' && rawOffset.trim().length > 0) {
      const parsed = Number(rawOffset);
      if (!Number.isInteger(parsed) || parsed < 0) {
        return sendApiError(
          res,
          400,
          'VALIDATION_ERROR',
          'offset must be a non-negative integer.'
        );
      }
      offset = parsed;
    }

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    const [rows, totalRows] = await Promise.all([
      db
        .select()
        .from(tickets)
        .where(whereClause)
        .orderBy(desc(tickets.createdAt), desc(tickets.id))
        .limit(limit)
        .offset(offset),
      db.select({ total: count() }).from(tickets).where(whereClause),
    ]);

    res.json({
      tickets: rows,
      total: Number(totalRows[0]?.total ?? 0),
      limit,
      offset,
    });
  } catch (err) {
    handleRouteError(res, err);
  }
});

router.get('/:id', requireAuth, async (req: AuthRequest, res) => {
  try {
    const id = parsePositiveId(req.params.id);
    if (!id) {
      return sendApiError(res, 404, 'NOT_FOUND', 'Ticket not found.');
    }

    const ticketRows = await db
      .select()
      .from(tickets)
      .where(eq(tickets.id, id))
      .limit(1);

    if (ticketRows.length === 0) {
      return sendApiError(res, 404, 'NOT_FOUND', 'Ticket not found.');
    }

    const events = await db
      .select()
      .from(ticketEvents)
      .where(eq(ticketEvents.ticketId, id))
      .orderBy(asc(ticketEvents.createdAt), asc(ticketEvents.id));

    res.json({
      ticket: ticketRows[0],
      events,
    });
  } catch (err) {
    handleRouteError(res, err);
  }
});

router.get('/:id/events', requireAuth, async (req: AuthRequest, res) => {
  try {
    const id = parsePositiveId(req.params.id);
    if (!id) {
      return sendApiError(res, 404, 'NOT_FOUND', 'Ticket not found.');
    }

    const existing = await db
      .select({ id: tickets.id })
      .from(tickets)
      .where(eq(tickets.id, id))
      .limit(1);

    if (existing.length === 0) {
      return sendApiError(res, 404, 'NOT_FOUND', 'Ticket not found.');
    }

    const events = await db
      .select()
      .from(ticketEvents)
      .where(eq(ticketEvents.ticketId, id))
      .orderBy(asc(ticketEvents.createdAt), asc(ticketEvents.id));

    res.json({ events });
  } catch (err) {
    handleRouteError(res, err);
  }
});

router.patch('/:id', requireAuth, async (req: AuthRequest, res) => {
  try {
    const actor = req.authUser!;
    const id = parsePositiveId(req.params.id);
    if (!id) {
      return sendApiError(res, 404, 'NOT_FOUND', 'Ticket not found.');
    }

    const existingRows = await db
      .select()
      .from(tickets)
      .where(eq(tickets.id, id))
      .limit(1);

    if (existingRows.length === 0) {
      return sendApiError(res, 404, 'NOT_FOUND', 'Ticket not found.');
    }
    const existing = existingRows[0];

    const { category, priority, status, assignedToId } = req.body ?? {};
    if (
      category === undefined &&
      priority === undefined &&
      status === undefined &&
      assignedToId === undefined
    ) {
      return sendApiError(
        res,
        422,
        'VALIDATION_ERROR',
        'At least one editable field (category, priority, status, assignedToId) must be provided.'
      );
    }

    if (
      category !== undefined &&
      !TICKET_CATEGORIES.includes(category as TicketCategory)
    ) {
      return sendApiError(
        res,
        422,
        'VALIDATION_ERROR',
        `Invalid category. Expected one of: ${TICKET_CATEGORIES.join(', ')}.`
      );
    }

    if (
      priority !== undefined &&
      !TICKET_PRIORITIES.includes(priority as TicketPriority)
    ) {
      return sendApiError(
        res,
        422,
        'VALIDATION_ERROR',
        `Invalid priority. Expected one of: ${TICKET_PRIORITIES.join(', ')}.`
      );
    }

    if (
      status !== undefined &&
      !TICKET_STATUSES.includes(status as TicketStatus)
    ) {
      return sendApiError(
        res,
        422,
        'VALIDATION_ERROR',
        `Invalid status. Expected one of: ${TICKET_STATUSES.join(', ')}.`
      );
    }

    if (assignedToId !== undefined && assignedToId !== null) {
      if (
        typeof assignedToId !== 'number' ||
        !Number.isInteger(assignedToId) ||
        assignedToId <= 0
      ) {
        return sendApiError(
          res,
          422,
          'VALIDATION_ERROR',
          'assignedToId must be a positive integer or null.'
        );
      }

      const assigneeRows = await db
        .select({ id: users.id })
        .from(users)
        .where(eq(users.id, assignedToId))
        .limit(1);

      if (assigneeRows.length === 0) {
        return sendApiError(
          res,
          404,
          'REFERENCED_NOT_FOUND',
          'Referenced assignee user does not exist.'
        );
      }
    }

    const updatedResult = await db.transaction(async (tx) => {
      const updates: Partial<typeof tickets.$inferInsert> = {};
      const eventsToInsert: Array<typeof ticketEvents.$inferInsert> = [];

      if (category !== undefined && category !== existing.category) {
        updates.category = category;
        updates.isHumanOverride = true;
        updates.isReviewed = true;
        eventsToInsert.push({
          ticketId: existing.id,
          actorId: actor.id,
          actorEmail: actor.email,
          field: 'category',
          oldValue: existing.category,
          newValue: category,
        });
      }

      if (priority !== undefined && priority !== existing.priority) {
        updates.priority = priority;
        eventsToInsert.push({
          ticketId: existing.id,
          actorId: actor.id,
          actorEmail: actor.email,
          field: 'priority',
          oldValue: existing.priority,
          newValue: priority,
        });
      }

      if (status !== undefined && status !== existing.status) {
        updates.status = status;
        if (status !== 'OPEN') {
          updates.isReviewed = true;
        }
        eventsToInsert.push({
          ticketId: existing.id,
          actorId: actor.id,
          actorEmail: actor.email,
          field: 'status',
          oldValue: existing.status,
          newValue: status,
        });
      }

      if (assignedToId !== undefined && assignedToId !== existing.assignedToId) {
        updates.assignedToId = assignedToId;
        eventsToInsert.push({
          ticketId: existing.id,
          actorId: actor.id,
          actorEmail: actor.email,
          field: 'assignedToId',
          oldValue:
            existing.assignedToId !== null ? String(existing.assignedToId) : null,
          newValue: assignedToId !== null ? String(assignedToId) : 'unassigned',
        });
      }

      let currentTicket = existing;
      if (Object.keys(updates).length > 0) {
        updates.updatedAt = new Date();
        const [updated] = await tx
          .update(tickets)
          .set(updates)
          .where(eq(tickets.id, existing.id))
          .returning();
        currentTicket = updated;

        if (eventsToInsert.length > 0) {
          await tx.insert(ticketEvents).values(eventsToInsert);
        }
      }

      const events = await tx
        .select()
        .from(ticketEvents)
        .where(eq(ticketEvents.ticketId, existing.id))
        .orderBy(asc(ticketEvents.createdAt), asc(ticketEvents.id));

      return { ticket: currentTicket, events };
    });

    res.json(updatedResult);
  } catch (err) {
    handleRouteError(res, err);
  }
});

export default router;
