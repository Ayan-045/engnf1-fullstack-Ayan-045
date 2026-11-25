import { relations } from 'drizzle-orm';
import {
  boolean,
  index,
  integer,
  pgTable,
  serial,
  text,
  timestamp,
} from 'drizzle-orm/pg-core';

export const users = pgTable('users', {
  id: serial('id').primaryKey(),
  uid: text('uid').notNull().unique(),
  email: text('email').notNull().unique(),
  name: text('name').notNull(),
  role: text('role').notNull().default('USER'), // 'ADMIN' | 'USER'
  passwordHash: text('password_hash'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

export const sessions = pgTable(
  'sessions',
  {
    id: serial('id').primaryKey(),
    tokenHash: text('token_hash').notNull().unique(),
    userId: integer('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index('idx_sessions_user_expires').on(table.userId, table.expiresAt)]
);

export const tickets = pgTable(
  'tickets',
  {
    id: serial('id').primaryKey(),
    externalId: text('external_id').notNull().unique(),
    subject: text('subject').notNull(),
    body: text('body').notNull(),
    customerEmail: text('customer_email').notNull(),
    autoCategory: text('auto_category').notNull(), // 'BILLING' | 'DELIVERY' | 'TECHNICAL' | 'ACCOUNT' | 'GENERAL'
    category: text('category').notNull(),
    priority: text('priority').notNull(), // 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT'
    status: text('status').notNull().default('OPEN'), // 'OPEN' | 'IN_PROGRESS' | 'RESOLVED' | 'CLOSED'
    isHumanOverride: boolean('is_human_override').notNull().default(false),
    isReviewed: boolean('is_reviewed').notNull().default(false),
    assignedToId: integer('assigned_to_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index('idx_tickets_status_created').on(table.status, table.createdAt),
    index('idx_tickets_category_priority').on(table.category, table.priority),
    index('idx_tickets_reviewed').on(table.isReviewed),
  ]
);

export const ticketEvents = pgTable(
  'ticket_events',
  {
    id: serial('id').primaryKey(),
    ticketId: integer('ticket_id')
      .references(() => tickets.id, { onDelete: 'cascade' })
      .notNull(),
    actorId: integer('actor_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    actorEmail: text('actor_email').notNull(),
    field: text('field').notNull(),
    oldValue: text('old_value'),
    newValue: text('new_value').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index('idx_ticket_events_ticket_created').on(table.ticketId, table.createdAt),
  ]
);

export const resources = pgTable('resources', {
  id: serial('id').primaryKey(),
  name: text('name').notNull(),
  type: text('type').notNull(), // 'ROOM' | 'LAB' | 'EQUIPMENT'
  location: text('location').notNull(),
  capacity: integer('capacity').notNull().default(1),
  description: text('description').notNull().default(''),
  isActive: boolean('is_active').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

export const bookings = pgTable(
  'bookings',
  {
    id: serial('id').primaryKey(),
    resourceId: integer('resource_id')
      .references(() => resources.id, { onDelete: 'cascade' })
      .notNull(),
    userId: integer('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    title: text('title').notNull(),
    notes: text('notes').notNull().default(''),
    startTime: timestamp('start_time', { withTimezone: true }).notNull(),
    endTime: timestamp('end_time', { withTimezone: true }).notNull(),
    status: text('status').notNull().default('PENDING'), // 'PENDING' | 'APPROVED' | 'REJECTED' | 'CANCELLED'
    reviewedById: integer('reviewed_by_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index('idx_bookings_resource_window').on(
      table.resourceId,
      table.status,
      table.startTime,
      table.endTime
    ),
    index('idx_bookings_user_active').on(
      table.userId,
      table.status,
      table.endTime
    ),
  ]
);

export const usersRelations = relations(users, ({ many }) => ({
  assignedTickets: many(tickets),
  bookings: many(bookings),
}));

export const ticketsRelations = relations(tickets, ({ one, many }) => ({
  assignedTo: one(users, {
    fields: [tickets.assignedToId],
    references: [users.id],
  }),
  events: many(ticketEvents),
}));

export const ticketEventsRelations = relations(ticketEvents, ({ one }) => ({
  ticket: one(tickets, {
    fields: [ticketEvents.ticketId],
    references: [tickets.id],
  }),
  actor: one(users, {
    fields: [ticketEvents.actorId],
    references: [users.id],
  }),
}));

export const resourcesRelations = relations(resources, ({ many }) => ({
  bookings: many(bookings),
}));

export const bookingsRelations = relations(bookings, ({ one }) => ({
  resource: one(resources, {
    fields: [bookings.resourceId],
    references: [resources.id],
  }),
  user: one(users, {
    fields: [bookings.userId],
    references: [users.id],
  }),
  reviewedBy: one(users, {
    fields: [bookings.reviewedById],
    references: [users.id],
  }),
}));
