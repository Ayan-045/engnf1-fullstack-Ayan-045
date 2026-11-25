# Solution Architecture & Engineering Notes

## Part 1: System Architecture, Trace & "Reviewed" Definition

### ASCII Architecture
```
+-------------------------------------------------------------------+
| React 19 SPA (frontend/src/App.tsx, components/*)                 |
| - In-memory Bearer token (frontend/src/lib/api.ts)                |
| - Optimistic UI + snapshot rollback (TriageView.tsx)              |
| - Safe JSX text escaping (zero dangerouslySetInnerHTML)           |
+----------------------------------+--------------------------------+
                                   | HTTPS / JSON (Authorization: Bearer)
                                   v
+-------------------------------------------------------------------+
| Express 4 API Server (backend/server.ts)                          |
| - Auth/RBAC Middleware (backend/src/middleware/auth.ts)           |
|   * Verifies DB-backed session tokens OR Firebase Admin ID tokens |
| - Routes: /api/auth, /api/tickets, /api/resources, /api/bookings, |
|           /api/stats, /api/admin/stats                            |
+----------------------------------+--------------------------------+
                                   | Drizzle ORM + pg.Pool (Object Method)
                                   v
+-------------------------------------------------------------------+
| PostgreSQL (Cloud SQL via Auth Proxy)                             |
| - Tables: users, sessions, tickets, ticket_events, resources,     |
|           bookings                                                |
| - Pessimistic row locks (FOR UPDATE) for atomic slot booking      |
+-------------------------------------------------------------------+
```

### Ticket-to-Dashboard Function Trace
1. **Ingestion (`POST /api/tickets/import` -> `backend/src/routes/tickets.ts:62`)**:
   - `validateTicketInput()` validates `externalId`, `subject`, `body`, `customerEmail` (returning `422` on malformed input).
   - `classifyTicketDeterministic(subject, body)` (`backend/src/lib/triage.ts:105`) scores keyword sets to deterministically compute `autoCategory` and `priority`.
   - Inside `db.transaction`, `tickets` is queried by `externalId`. New tickets are inserted with `category = autoCategory`, `isHumanOverride = false`, `isReviewed = false`, and an `imported` row in `ticket_events`.
2. **Human Triage (`PATCH /api/tickets/:id` -> `backend/src/routes/tickets.ts:435`)**:
   - `frontend/src/components/TriageView.tsx:167` (`handleOptimisticPatch`) captures a snapshot, updates UI state immediately, and dispatches `api.updateTicket()`. On rejection, it restores the snapshot and renders a visible rollback banner.
   - Server-side `PATCH` writes one `ticket_events` row per changed field (`category`, `priority`, `status`, `assignedToId`).
3. **Dashboard & Stats (`GET /api/stats` -> `backend/src/routes/admin.ts:11`)**:
   - `computeTicketStats()` aggregates `totalTickets`, `openTickets`, `reviewedTickets`, `overrideCount`, and `modelAgreementRate` (`(agreedReviewed / reviewedTickets) * 100` where `agreedReviewed` counts `isReviewed === true` tickets whose `category === autoCategory`).
   - `frontend/src/components/TriageView.tsx` renders the 4-cell Stats Strip and tabular queue list using local browser timezone formatting (`frontend/src/lib/format.ts`).

### Exact `"reviewed"` Rule (`isReviewed`)
A ticket becomes `isReviewed = true` when **either** of these human actions occurs in `PATCH /api/tickets/:id` (`backend/src/routes/tickets.ts:520-555`):
1. Its `category` is modified by a human operator (which simultaneously sets `isHumanOverride = true`), **or**
2. Its `status` transitions out of `'OPEN'` (to `'IN_PROGRESS'`, `'RESOLVED'`, or `'CLOSED'`).

Changing only `priority` or `assignedToId` while keeping `status === 'OPEN'` and the original `category` logs an audit event without marking the ticket reviewed.

---

## Part 2: Concurrency (B6) & Human-Override Protection (T-B2)

### B6: Atomic Slot Booking Under Concurrency (`backend/src/routes/bookings.ts:172`)
Under PostgreSQL default `READ COMMITTED` isolation, two simultaneous `POST /api/bookings` transactions running a bare `SELECT` overlap check on an empty slot both see zero rows and both insert, creating a double booking.

ResolveGrid prevents this race inside `db.transaction(...)` (`backend/src/routes/bookings.ts:273-348`):
1. **Lock Resource Row**: `SELECT id, is_active FROM resources WHERE id = $1 FOR UPDATE` serializes all concurrent booking attempts for the same resource (and returns `404 REFERENCED_NOT_FOUND` if missing, or `409 RESOURCE_INACTIVE` if inactive).
2. **Lock User Row**: `SELECT id FROM users WHERE id = $1 FOR UPDATE` serializes concurrent requests from the same user across different resources, preventing quota-limit races. Because every transaction acquires `resources` before `users` in strict hierarchy, lock cycles/deadlocks cannot occur.
3. **Quota & Overlap Check**: Because `READ COMMITTED` takes a fresh snapshot for statements executed after acquiring `FOR UPDATE`, the waiting transaction immediately sees the winner's committed booking and returns `409 SLOT_CONFLICT` (or `409 BOOKING_LIMIT_EXCEEDED` on the 4th active future `PENDING`/`APPROVED` booking).
4. **Verified Result**: `scripts/test-concurrency.ts` fired 12 simultaneous `POST /api/bookings` requests for the exact same slot (`Oscilloscope Rig 04`), yielding **1 × `201 Created`** and **11 × `409 Conflict`**.

### T-B2: Idempotent Re-Import & Human-Override Protection (`backend/src/routes/tickets.ts:127-230`)
When `POST /api/tickets/import` receives an existing `externalId`:
- `subject`, `body`, and `customerEmail` are updated whenever their values change, with individual `ticket_events` rows recorded for each changed field.
- If `existing.isHumanOverride === false`, `classifyTicketDeterministic()` re-computes `autoCategory`, `category`, and `priority`, updating any changed fields and logging audit events.
- If `existing.isHumanOverride === true`, the classifier **does not** overwrite `category` or `priority`, preserving the human operator's decision across repeated imports.

---

## Part 3: Measured Latency Benchmark (`GET /api/tickets?limit=100` on 500+ Tickets)

Database seeded with **516 tickets** (`npx tsx backend/src/db/seed.ts --500`) in Cloud SQL (`asia-south1`) accessed from the application container (`asia-northeast1`).

| Measurement | Plan / Configuration | Planner Cost | DB Execution Time | End-to-End Query Latency |
| :--- | :--- | :--- | :--- | :--- |
| **Before Indexing** (`enable_indexscan=off`, `enable_bitmapscan=off`) | `Seq Scan on tickets` (filter `status = 'OPEN'`, removed 129 rows) + `top-N heapsort` | `21.21` | `0.712 ms` | ~`158 ms` (dominated by cross-region proxy RTT) |
| **After Indexing** (`idx_tickets_status_created` on `(status, created_at)`) | `Bitmap Index Scan on idx_tickets_status_created` + `Bitmap Heap Scan` + `top-N heapsort` | `10.08` (**-52.5% cost**) | `0.714 ms` | `avg=157.58 ms`, `p50=156.90 ms`, `p95=166.82 ms` (`scripts/benchmark-tickets.ts`) |

### Trade-Off Analysis
- **Write overhead vs. Read scalability**: Adding the three composite B-tree indexes (`idx_tickets_status_created`, `idx_tickets_category_priority`, `idx_tickets_reviewed`) adds minor index maintenance overhead on `INSERT`/`PATCH` writes, while cutting planner scan cost by >50% and preventing full-table scans as the table grows past 100k+ rows.
- **Residual bottleneck observed**: At 516 rows (16 heap pages), all pages fit in shared buffers, so network round-trip latency across Cloud SQL Auth Proxy (`~157 ms`) dominates DB CPU time (`~0.7 ms`). Additionally, because `idx_tickets_status_created` covers `(status, created_at)` without `id`, PostgreSQL still performs a `51kB` `top-N heapsort` for the tie-breaker `ORDER BY created_at DESC, id DESC`.

---

## Part 4: 1-Day Engineering Improvement Plan
1. **Eliminate Tie-Breaker Sort (`backend/src/db/schema.ts:57` & `backend/src/routes/tickets.ts:357-363`)**: Extend `idx_tickets_status_created` to `(table.status, desc(table.createdAt), desc(table.id))` and replace `OFFSET` pagination with keyset cursor pagination `(createdAt, id) < ($cursorTime, $cursorId)` so `GET /api/tickets?limit=100` scales in $O(\log N)$ at 1M+ rows with zero sort step.
2. **Database-Level GiST Exclusion Constraint (`backend/src/db/schema.ts:118` & `backend/src/routes/bookings.ts:310-325`)**: Enable PostgreSQL `btree_gist` and enforce `EXCLUDE USING gist (resource_id WITH =, tstzrange(start_time, end_time, '[)') WITH &&) WHERE (status IN ('PENDING', 'APPROVED'))` as defense-in-depth alongside the `FOR UPDATE` transaction lock.
3. **True Debounced Server Search & Batch Rollback Telemetry (`frontend/src/components/TriageView.tsx:100-115` & `frontend/src/components/TriageView.tsx:167-210`)**: Add a 250ms debounce hook on the `query` filter input so typing in the search bar does not fire redundant `GET /api/tickets` requests per keystroke, and track per-ticket pending mutation locks to prevent out-of-order responses during rapid consecutive edits.
4. **Co-located Read Replica / Single-Region Deployment (`backend/src/db/index.ts:9-20`)**: Deploy the Cloud Run service and Cloud SQL instance in the same region (`asia-south1`) to cut query round-trip latency from `~157 ms` down to `< 5 ms`.
