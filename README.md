# ResolveGrid — Ticket Triage & Atomic Slot Booking Console

## 1. Project Overview
ResolveGrid is a full-stack operations workspace built with React, Express, Drizzle ORM, and PostgreSQL (Cloud SQL). It combines two core workflows:
- **Idempotent Ticket Triage & Human-Override Protection**: Deterministic classification of imported customer tickets, immutable per-field audit logging (`ticket_events`), and model-agreement metrics.
- **Concurrency-Safe Resource & Slot Booking**: 30-minute UTC grid scheduling across rooms, labs, and equipment with transactional pessimistic locking to prevent double-booking races and enforce per-user quota limits.

## 2. Architecture & Tech Stack
- **Frontend (`frontend/`)**: React 19, TypeScript, Tailwind CSS v4, Lucide Icons (`frontend/src/App.tsx`, `frontend/src/components/*`).
- **Backend (`backend/`)**: Express 4 (`backend/server.ts`, `backend/src/routes/*`), Drizzle ORM (`backend/src/db/*`), Node.js `crypto.scrypt` & DB-backed session tokens, Firebase Admin SDK (`firebase-admin`).
- **Database**: PostgreSQL (Cloud SQL) accessed via `pg.Pool` object configuration and Drizzle ORM.

## 3. Database Schema & Constraints
Defined in `backend/src/db/schema.ts`:
- `users`: `id`, `uid` (unique), `email` (unique), `name`, `role` (`ADMIN` | `USER`), `password_hash`, `created_at`.
- `sessions`: `id`, `token_hash` (unique), `user_id` (FK cascade), `expires_at`, `created_at`.
- `tickets`: `id`, `external_id` (unique), `subject`, `body`, `customer_email`, `auto_category`, `category`, `priority`, `status`, `is_human_override`, `is_reviewed`, `assigned_to_id`, `created_at`, `updated_at`. Indexed on `(status, created_at)`, `(category, priority)`, and `(is_reviewed)`.
- `ticket_events`: `id`, `ticket_id` (FK cascade), `actor_id`, `actor_email`, `field`, `old_value`, `new_value`, `created_at`. Indexed on `(ticket_id, created_at)`.
- `resources`: `id`, `name`, `type` (`ROOM` | `LAB` | `EQUIPMENT`), `location`, `capacity`, `description`, `is_active`, `created_at`.
- `bookings`: `id`, `resource_id` (FK cascade), `user_id` (FK cascade), `title`, `notes`, `start_time`, `end_time`, `status` (`PENDING` | `APPROVED` | `REJECTED` | `CANCELLED`), `reviewed_by_id`, `created_at`, `updated_at`. Indexed on `(resource_id, status, start_time, end_time)` and `(user_id, status, end_time)`.

## 4. Deterministic Ticket Triage & Human Override Protection
- `POST /api/tickets/import` runs `classifyTicketDeterministic(subject, body)` (`backend/src/lib/triage.ts`) to assign `autoCategory` (`DELIVERY`, `BILLING`, `TECHNICAL`, `ACCOUNT`, `GENERAL`) and `priority` (`URGENT`, `HIGH`, `MEDIUM`, `LOW`).
- Re-importing an existing `externalId` updates `subject`, `body`, and `customerEmail` when changed, and re-runs classification **only if `isHumanOverride === false`**.
- `PATCH /api/tickets/:id` sets `isHumanOverride = true` when `category` changes, sets `isReviewed = true` when `category` changes or `status` moves out of `OPEN`, and writes one `ticket_events` row per changed field.

## 5. Atomic 30-Minute UTC Slot Booking & Concurrency Control
- `POST /api/bookings` validates 30-minute UTC grid alignment (`00` or `30` minutes, `0s`, `0ms`), duration between `30` and `240` minutes in 30-minute steps, and future start within 30 days.
- Inside `db.transaction(...)`, the server locks `resources` (`SELECT ... FOR UPDATE`) and `users` (`SELECT ... FOR UPDATE`), verifies the resource is active, checks the user's max-3 active future `PENDING`/`APPROVED` booking limit, checks overlap (`newStart < existingEnd AND newEnd > existingStart` for `PENDING`/`APPROVED` only), and inserts atomically.

## 6. API Contract & Error Order
All error responses follow `{ "error": { "code": "...", "message": "..." } }` in strict validation precedence:
1. `401 UNAUTHORIZED` (missing or invalid token)
2. `403 FORBIDDEN_ROLE` (admin-only route accessed by standard user)
3. `404 NOT_FOUND` (missing or invalid path ID)
4. `403 FORBIDDEN_OWNERSHIP` (non-owner accessing/cancelling another user's booking)
5. `400 / 422 VALIDATION_ERROR` (schema, grid alignment, duration, or filter errors)
6. `404 REFERENCED_NOT_FOUND` (referenced `resourceId` or `assignedToId` missing)
7. `409 CONFLICT` (`SLOT_CONFLICT`, `BOOKING_LIMIT_EXCEEDED`, `RESOURCE_INACTIVE`, `INVALID_STATUS_TRANSITION`)

## 7. Authentication & Role-Based Access Control
- Supports Google Sign-In via Firebase Auth (`POST /api/auth/firebase`) and email/password accounts (`POST /api/auth/register`, `POST /api/auth/login`) with `crypto.scrypt` password hashing.
- First-run administrator access can be claimed once via `POST /api/auth/claim-admin` when `ADMIN_PASSCODE` is unset and no admin password hash exists yet.
- Bearer tokens are held strictly in React client memory (never `localStorage` or `sessionStorage`).

## 8. Setup & Local Development
1. Configure environment variables (`SQL_HOST`, `SQL_USER`, `SQL_PASSWORD`, `SQL_DB_NAME`, `SQL_ADMIN_USER`, `SQL_ADMIN_PASSWORD`, and optional `ADMIN_EMAIL` / `ADMIN_PASSCODE` per `.env.example`).
2. Install dependencies: `npm install`.
3. Push schema via Drizzle Kit (`backend/src/db/drizzle.config.ts`).
4. Start development server: `npm run dev` (runs Express + Vite middleware on port `3000`).

## 9. Seeding, Concurrency Testing & Benchmarking
- **Idempotent Seed**: `npm run seed` (`npx tsx backend/src/db/seed.ts`) seeds admin/user accounts, 6 resources across `ROOM`/`LAB`/`EQUIPMENT` (1 inactive), 16 tickets (including raw HTML/script XSS payload and 4 reviewed tickets), and sample bookings.
- **500+ Ticket Benchmark**: `npx tsx backend/src/db/seed.ts --500` followed by `npx tsx scripts/benchmark-tickets.ts`.
- **Concurrency Verification**: `npx tsx scripts/test-concurrency.ts` fires 12 simultaneous `POST /api/bookings` requests for the same slot and asserts `1 x 201` and `11 x 409`.

## 10. Deployment & Security Safeguards
- Parameterized Drizzle ORM queries block SQL injection across all search and filter endpoints.
- React JSX text bindings escape all ticket subjects, bodies, and audit values so HTML/script payloads never execute in the DOM.
- Production build runs `npm run build` (`vite build`) and serves `dist/` via `backend/server.ts`.
