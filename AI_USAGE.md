# AI Usage & Engineering Verification Log

## Tools Used
- **Google AI Studio Build Engine**: Used to scaffold TypeScript modules, Drizzle ORM schema definitions, Express API routes, and React + Tailwind CSS v4 frontend components.

## Purposes
- Generating boilerplate CRUD routes and responsive split-pane UI layouts.
- Drafting idempotent database seeding scripts and concurrent load-test probes (`scripts/test-concurrency.ts`).
- Reviewing error-precedence checks across REST endpoints (`401 -> 403 role -> 404 path -> 403 ownership -> 400/422 validation -> 404 referenced -> 409 conflict`).

## Verified & Overridden Suggestions
1. **Cloud SQL Connection Pooling & Credential Isolation**:
   - *Initial pattern*: Standard Node PostgreSQL examples often default to a single `DATABASE_URL` connection string.
   - *Override & Verification*: Overrode connection string usage in favor of the explicit object-method `pg.Pool` configuration (`SQL_HOST`, `SQL_USER`, `SQL_PASSWORD`, `SQL_DB_NAME`) in `backend/src/db/index.ts` and separate `SQL_ADMIN_USER` / `SQL_ADMIN_PASSWORD` credentials in `backend/src/db/drizzle.config.ts`, with zero eager startup connection probes.
2. **Booking Concurrency Lock Ordering**:
   - *Initial pattern*: Locking only the `bookings` rows matching a time range can miss a concurrent insert when the table range has zero rows yet under PostgreSQL `READ COMMITTED` isolation.
   - *Override & Verification*: Overrode range-only `SELECT` checks by acquiring deterministic `SELECT ... FOR UPDATE` row locks on `resources(id)` followed by `users(id)` inside `db.transaction(...)` in `backend/src/routes/bookings.ts`, verified with a 12-way parallel `Promise.all` probe (`scripts/test-concurrency.ts`) producing exactly 1 `201` and 11 `409` responses.
3. **XSS Safe Rendering & Persistent DB Sessions**:
   - *Verification*: Audited all ticket rendering in `frontend/src/components/TriageView.tsx` to guarantee zero `dangerouslySetInnerHTML` sinks (verified against seeded ticket `EXT-1003` containing `<script>alert("xss")</script><img src=x onerror="alert(1)">`), verified `frontend/src/lib/api.ts` holds Bearer tokens exclusively in JS memory rather than `localStorage`, and replaced ephemeral process-local session signing with persistent SHA-256 hashed tokens in PostgreSQL `sessions`.
