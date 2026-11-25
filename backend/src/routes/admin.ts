import { Router } from 'express';
import { count, eq } from 'drizzle-orm';
import { db } from '../db/index.ts';
import { bookings, resources, tickets, users } from '../db/schema.ts';
import { handleRouteError } from '../lib/errors.ts';
import {
  type AuthRequest,
  requireAdmin,
  requireAuth,
} from '../middleware/auth.ts';

const router = Router();

export async function computeTicketStats() {
  const allTickets = await db
    .select({
      category: tickets.category,
      autoCategory: tickets.autoCategory,
      priority: tickets.priority,
      status: tickets.status,
      isHumanOverride: tickets.isHumanOverride,
      isReviewed: tickets.isReviewed,
    })
    .from(tickets);

  const totalTickets = allTickets.length;
  let openTickets = 0;
  let reviewedTickets = 0;
  let overrideCount = 0;
  let agreedReviewed = 0;

  const byCategory: Record<string, number> = {};
  const byPriority: Record<string, number> = {};
  const byStatus: Record<string, number> = {};

  for (const t of allTickets) {
    if (t.status === 'OPEN') openTickets += 1;
    if (t.isReviewed) {
      reviewedTickets += 1;
      if (t.category === t.autoCategory) {
        agreedReviewed += 1;
      }
    }
    if (t.isHumanOverride) overrideCount += 1;

    byCategory[t.category] = (byCategory[t.category] ?? 0) + 1;
    byPriority[t.priority] = (byPriority[t.priority] ?? 0) + 1;
    byStatus[t.status] = (byStatus[t.status] ?? 0) + 1;
  }

  const modelAgreementRate =
    reviewedTickets > 0
      ? Math.round((agreedReviewed / reviewedTickets) * 1000) / 10
      : 100;

  return {
    totalTickets,
    openTickets,
    reviewedTickets,
    overrideCount,
    modelAgreementRate,
    byCategory,
    byPriority,
    byStatus,
  };
}

router.get('/stats', requireAuth, async (_req: AuthRequest, res) => {
  try {
    const stats = await computeTicketStats();
    res.json(stats);
  } catch (err) {
    handleRouteError(res, err);
  }
});

router.get(
  '/admin/stats',
  requireAuth,
  requireAdmin,
  async (_req: AuthRequest, res) => {
    try {
      const [userCountRow, allResources, allBookings, ticketStats] =
        await Promise.all([
          db.select({ total: count() }).from(users),
          db.select().from(resources),
          db
            .select({
              id: bookings.id,
              status: bookings.status,
              resourceId: bookings.resourceId,
            })
            .from(bookings),
          computeTicketStats(),
        ]);

      const activeResources = allResources.filter((r) => r.isActive).length;
      const resourceMap = new Map(allResources.map((r) => [r.id, r]));

      let pendingBookings = 0;
      let approvedBookings = 0;
      let rejectedBookings = 0;
      let cancelledBookings = 0;
      const bookingsByResourceType: Record<string, number> = {
        ROOM: 0,
        LAB: 0,
        EQUIPMENT: 0,
      };

      for (const b of allBookings) {
        if (b.status === 'PENDING') pendingBookings += 1;
        else if (b.status === 'APPROVED') approvedBookings += 1;
        else if (b.status === 'REJECTED') rejectedBookings += 1;
        else if (b.status === 'CANCELLED') cancelledBookings += 1;

        const r = resourceMap.get(b.resourceId);
        if (r) {
          bookingsByResourceType[r.type] =
            (bookingsByResourceType[r.type] ?? 0) + 1;
        }
      }

      res.json({
        totalUsers: Number(userCountRow[0]?.total ?? 0),
        totalResources: allResources.length,
        activeResources,
        totalBookings: allBookings.length,
        pendingBookings,
        approvedBookings,
        rejectedBookings,
        cancelledBookings,
        bookingsByResourceType,
        ticketStats,
      });
    } catch (err) {
      handleRouteError(res, err);
    }
  }
);

export default router;
