import 'dotenv/config';
import { count, eq } from 'drizzle-orm';
import { db, pool } from './index.ts';
import {
  bookings,
  resources,
  ticketEvents,
  tickets,
  users,
} from './schema.ts';
import { classifyTicketDeterministic } from '../lib/triage.ts';

function getNextUtcGridSlot(daysAhead: number, utcHour: number, utcMin: 0 | 30): Date {
  const now = new Date();
  return new Date(
    Date.UTC(
      now.getUTCFullYear(),
      now.getUTCMonth(),
      now.getUTCDate() + daysAhead,
      utcHour,
      utcMin,
      0,
      0
    )
  );
}

export async function runSeed(options: { includeBenchmark500?: boolean } = {}) {
  // 1. Idempotent Users
  await db
    .insert(users)
    .values([
      {
        uid: 'seed-admin-1',
        email: 'admin@resolvegrid.local',
        name: 'Operations Admin',
        role: 'ADMIN',
      },
      {
        uid: 'seed-user-1',
        email: 'operator@resolvegrid.local',
        name: 'Field Operator',
        role: 'USER',
      },
    ])
    .onConflictDoNothing({ target: users.email });

  const [adminUser] = await db
    .select()
    .from(users)
    .where(eq(users.email, 'admin@resolvegrid.local'))
    .limit(1);

  const [regularUser] = await db
    .select()
    .from(users)
    .where(eq(users.email, 'operator@resolvegrid.local'))
    .limit(1);

  // 2. Idempotent Resources (6+ across ROOM, LAB, EQUIPMENT with >=1 inactive)
  const existingResources = await db.select().from(resources);
  if (existingResources.length === 0) {
    await db.insert(resources).values([
      {
        name: 'War Room Alpha',
        type: 'ROOM',
        location: 'Building A, Floor 4',
        capacity: 12,
        description: 'Incident bridge room with dual wall displays and conference bridge.',
        isActive: true,
      },
      {
        name: 'Executive Briefing Suite',
        type: 'ROOM',
        location: 'Building A, Floor 6',
        capacity: 8,
        description: 'Client escalation review room with acoustic isolation.',
        isActive: true,
      },
      {
        name: 'Acoustic Diagnostics Lab',
        type: 'LAB',
        location: 'Basement B1, Bay 2',
        capacity: 4,
        description: 'Anechoic test chamber for hardware audio validation.',
        isActive: true,
      },
      {
        name: 'Thermal Stress Chamber',
        type: 'LAB',
        location: 'Wing C, Room 102',
        capacity: 2,
        description: 'Environmental chamber supporting -20C to +85C thermal soak cycles.',
        isActive: true,
      },
      {
        name: 'Oscilloscope Rig 04',
        type: 'EQUIPMENT',
        location: 'Hardware Bench 4',
        capacity: 1,
        description: '4-channel 2GHz mixed-signal oscilloscope with logic analyzer probes.',
        isActive: true,
      },
      {
        name: 'Cryo-Vacuum Rig 01',
        type: 'EQUIPMENT',
        location: 'Bay 9 (Decommissioned)',
        capacity: 1,
        description: 'Scheduled for compressor overhaul; inactive for booking.',
        isActive: false,
      },
    ]);
  }

  const allResources = await db.select().from(resources);

  // 3. Idempotent Starter Tickets (16 tickets including XSS test payload & >= 3 reviewed)
  const starterTickets = [
    {
      externalId: 'EXT-1001',
      subject: 'My package has not arrived after 9 days',
      body: 'Order #88421 shows stuck in transit at the regional hub since Tuesday. Please expedite courier lookup.',
      customerEmail: 'claire.bennett@acme-logistics.example',
      reviewed: true,
      overrideCategory: null,
      status: 'IN_PROGRESS',
    },
    {
      externalId: 'EXT-1002',
      subject: 'Double charged on monthly enterprise invoice',
      body: 'We were billed twice on card ending 4421 for November. Requesting an immediate refund for the duplicate charge.',
      customerEmail: 'finance@northstar-ops.example',
      reviewed: true,
      overrideCategory: null,
      status: 'RESOLVED',
    },
    {
      externalId: 'EXT-1003',
      subject: '<script>alert("xss")</script> Urgent billing refund & API timeout',
      body: 'Payload test: <img src=x onerror="alert(1)"> Also our webhook receiver throws 500 error on invoice PDF export.',
      customerEmail: 'sec-test@veritas-qa.example',
      reviewed: true,
      overrideCategory: 'TECHNICAL', // Human override from autoCategory (BILLING) -> TECHNICAL
      status: 'IN_PROGRESS',
    },
    {
      externalId: 'EXT-1004',
      subject: 'Production outage on webhook ingestion endpoint',
      body: 'Getting HTTP 500 error and database connection timeout across all EU nodes since 03:15 UTC. Critical P0.',
      customerEmail: 'sre-oncall@kinetix.example',
      reviewed: true,
      overrideCategory: null,
      status: 'IN_PROGRESS',
    },
    {
      externalId: 'EXT-1005',
      subject: 'Locked out after 2FA device replacement',
      body: 'Cannot reset password or pass MFA prompt after replacing hardware security key. Need account access restored.',
      customerEmail: 'marcus.lee@helixbio.example',
      reviewed: false,
      overrideCategory: null,
      status: 'OPEN',
    },
    {
      externalId: 'EXT-1006',
      subject: 'Tracking link shows delivered but parcel missing',
      body: 'Courier marked shipment #TRK-9091 as delivered at reception, but front desk has no record of the package.',
      customerEmail: 'desk@maritime-supply.example',
      reviewed: false,
      overrideCategory: null,
      status: 'OPEN',
    },
    {
      externalId: 'EXT-1007',
      subject: 'Chargeback dispute alert on annual plan',
      body: 'Our procurement team needs a corrected receipt and refund confirmation before closing the card dispute.',
      customerEmail: 'ap@lumenworks.example',
      reviewed: false,
      overrideCategory: null,
      status: 'OPEN',
    },
    {
      externalId: 'EXT-1008',
      subject: 'SSO SAML assertion failing for new team members',
      body: 'Users receive access denied after Okta login redirect. Role mapping attribute appears ignored.',
      customerEmail: 'it-admin@cobaltgrid.example',
      reviewed: false,
      overrideCategory: null,
      status: 'OPEN',
    },
    {
      externalId: 'EXT-1009',
      subject: 'API rate limit exception during nightly batch sync',
      body: 'Our SDK throws unhandled exception and high latency when syncing more than 500 records per minute.',
      customerEmail: 'platform@vanguard-data.example',
      reviewed: false,
      overrideCategory: null,
      status: 'OPEN',
    },
    {
      externalId: 'EXT-1010',
      subject: 'Requesting updated compliance documentation for Q4 audit',
      body: 'General inquiry regarding SOC 2 Type II report availability for our annual vendor review.',
      customerEmail: 'compliance@meridian.example',
      reviewed: false,
      overrideCategory: null,
      status: 'OPEN',
    },
    {
      externalId: 'EXT-1011',
      subject: 'Damaged hardware unit received in warehouse shipment',
      body: 'Outer crate arrived crushed and oscilloscope probe kit is missing from the delivery.',
      customerEmail: 'receiving@orbitlab.example',
      reviewed: false,
      overrideCategory: null,
      status: 'OPEN',
    },
    {
      externalId: 'EXT-1012',
      subject: 'SSL certificate handshake failure on custom domain',
      body: 'Customers see broken TLS chain errors when accessing status.example-corp.net.',
      customerEmail: 'devops@example-corp.example',
      reviewed: false,
      overrideCategory: null,
      status: 'OPEN',
    },
    {
      externalId: 'EXT-1013',
      subject: 'Payment failed despite updated corporate card',
      body: 'Invoice #INV-4012 keeps failing payment authorization with generic billing decline.',
      customerEmail: 'treasury@solaris.example',
      reviewed: false,
      overrideCategory: null,
      status: 'OPEN',
    },
    {
      externalId: 'EXT-1014',
      subject: 'Feature suggestion for CSV export column ordering',
      body: 'Minor feedback: it would be helpful to preserve custom column order on scheduled exports.',
      customerEmail: 'product@finledger.example',
      reviewed: false,
      overrideCategory: null,
      status: 'OPEN',
    },
    {
      externalId: 'EXT-1015',
      subject: 'Courier rescheduled delivery window without notice',
      body: 'Urgent shipment for tomorrow morning calibration was pushed back 48 hours by the carrier.',
      customerEmail: 'ops@precision-mfg.example',
      reviewed: false,
      overrideCategory: null,
      status: 'OPEN',
    },
    {
      externalId: 'EXT-1016',
      subject: 'Password reset link expires immediately',
      body: 'Every time our operator requests a login reset link, clicking it returns an expired token error.',
      customerEmail: 'support@fieldops.example',
      reviewed: false,
      overrideCategory: null,
      status: 'OPEN',
    },
  ];

  for (const item of starterTickets) {
    const existing = await db
      .select({ id: tickets.id })
      .from(tickets)
      .where(eq(tickets.externalId, item.externalId))
      .limit(1);

    if (existing.length === 0) {
      const cls = classifyTicketDeterministic(item.subject, item.body);
      const finalCategory = item.overrideCategory ?? cls.autoCategory;
      const isHumanOverride = item.overrideCategory !== null;

      const [inserted] = await db
        .insert(tickets)
        .values({
          externalId: item.externalId,
          subject: item.subject,
          body: item.body,
          customerEmail: item.customerEmail,
          autoCategory: cls.autoCategory,
          category: finalCategory,
          priority: cls.priority,
          status: item.status,
          isHumanOverride,
          isReviewed: item.reviewed,
          assignedToId: item.reviewed ? adminUser?.id ?? null : null,
        })
        .returning();

      await db.insert(ticketEvents).values({
        ticketId: inserted.id,
        actorId: adminUser?.id ?? null,
        actorEmail: adminUser?.email ?? 'system@resolvegrid.local',
        field: 'imported',
        oldValue: null,
        newValue: `${cls.autoCategory} / ${cls.priority}`,
      });

      if (isHumanOverride && item.overrideCategory) {
        await db.insert(ticketEvents).values({
          ticketId: inserted.id,
          actorId: adminUser?.id ?? null,
          actorEmail: adminUser?.email ?? 'admin@resolvegrid.local',
          field: 'category',
          oldValue: cls.autoCategory,
          newValue: item.overrideCategory,
        });
      }
      if (item.status !== 'OPEN') {
        await db.insert(ticketEvents).values({
          ticketId: inserted.id,
          actorId: adminUser?.id ?? null,
          actorEmail: adminUser?.email ?? 'admin@resolvegrid.local',
          field: 'status',
          oldValue: 'OPEN',
          newValue: item.status,
        });
      }
    }
  }

  // 4. Optional 500+ Ticket Benchmark Seeding
  if (options.includeBenchmark500) {
    const [{ total }] = await db.select({ total: count() }).from(tickets);
    if (Number(total) < 516) {
      const sampleSubjects = [
        'Package delayed at regional sorting depot',
        'Duplicate billing invoice on monthly statement',
        'Webhook API timeout error 500 during sync',
        'Account 2FA reset required for field engineer',
        'General question regarding quarterly compliance report',
      ];
      const batch: Array<typeof tickets.$inferInsert> = [];
      for (let i = 1; i <= 500; i += 1) {
        const extId = `EXT-BENCH-${String(i).padStart(4, '0')}`;
        const subj = `${sampleSubjects[i % sampleSubjects.length]} (#${i})`;
        const body = `Automated benchmark ticket payload ${i} for latency measurement.`;
        const cls = classifyTicketDeterministic(subj, body);
        batch.push({
          externalId: extId,
          subject: subj,
          body,
          customerEmail: `bench-${i}@example.org`,
          autoCategory: cls.autoCategory,
          category: cls.autoCategory,
          priority: cls.priority,
          status: i % 4 === 0 ? 'RESOLVED' : 'OPEN',
          isHumanOverride: false,
          isReviewed: i % 4 === 0,
        });
      }
      await db
        .insert(tickets)
        .values(batch)
        .onConflictDoNothing({ target: tickets.externalId });
    }
  }

  // 5. Idempotent Sample Bookings
  const existingBookings = await db.select({ total: count() }).from(bookings);
  if (
    Number(existingBookings[0]?.total ?? 0) === 0 &&
    allResources.length > 0 &&
    regularUser &&
    adminUser
  ) {
    const warRoom = allResources.find((r) => r.name === 'War Room Alpha') ?? allResources[0];
    const acousticLab =
      allResources.find((r) => r.name === 'Acoustic Diagnostics Lab') ?? allResources[0];

    const slot1Start = getNextUtcGridSlot(1, 10, 0);
    const slot1End = new Date(slot1Start.getTime() + 60 * 60 * 1000);

    const slot2Start = getNextUtcGridSlot(2, 14, 30);
    const slot2End = new Date(slot2Start.getTime() + 90 * 60 * 1000);

    await db.insert(bookings).values([
      {
        resourceId: warRoom.id,
        userId: regularUser.id,
        title: 'Q4 Triage Escalation Review',
        notes: 'Post-incident review with support leads.',
        startTime: slot1Start,
        endTime: slot1End,
        status: 'APPROVED',
        reviewedById: adminUser.id,
      },
      {
        resourceId: acousticLab.id,
        userId: regularUser.id,
        title: 'Sensor Acoustic Calibration',
        notes: 'Bench verification for batch 12.',
        startTime: slot2Start,
        endTime: slot2End,
        status: 'PENDING',
      },
    ]);
  }
}

const isDirectRun =
  process.argv[1] && process.argv[1].endsWith('seed.ts');

if (isDirectRun) {
  const includeBenchmark500 = process.argv.includes('--500');
  runSeed({ includeBenchmark500 })
    .then(async () => {
      console.log(
        `Seed completed successfully${includeBenchmark500 ? ' (including 500+ benchmark tickets)' : ''}.`
      );
      await pool.end();
      process.exit(0);
    })
    .catch(async (err) => {
      console.error('Seed failed:', err);
      await pool.end();
      process.exit(1);
    });
}
