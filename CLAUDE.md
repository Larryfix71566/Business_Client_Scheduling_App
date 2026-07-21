# BizMan — Project Conventions

Multi-tenant business management app. Next.js 15 (App Router) + TypeScript strict,
PostgreSQL + Prisma, Auth.js (NextAuth) v5 credentials, Tailwind, Vitest + Playwright.

This file is the contract every phase inherits. Follow it literally; do not invent
new abstractions (no repositories, DI, event buses). Route handler → tenant helper → Prisma.

## Non-negotiable guardrails

1. **Tenant isolation.** Every tenant table has `businessId`. Route handlers and
   pages under `src/app/**` access tenant data ONLY through `tenantDb(ctx)` in
   `src/lib/tenant.ts`, which forces `where: { businessId }` on reads and stamps
   `businessId` on writes. Never call `prisma.<tenantModel>` directly in `src/app`.
   `src/lib` is the only place allowed to touch the raw client (auth lookup, business
   onboarding, shell data). A vitest guard (`tests/unit/no-direct-prisma.test.ts`)
   fails the build if this is violated. The canonical model list is `TENANT_MODELS`.
2. **Ownership scoping.** Staff-owned resources (Service, user-owned InventoryItem,
   Schedule, Appointment-as-provider) additionally filter by `userId` unless the
   session role is `ADMIN`. Use `ownershipWhere(ctx)` from `src/lib/tenant.ts`.
3. **Money is integer cents** (`Int`). Never use floats. Format/combine only via
   `src/lib/money.ts` (`formatCents`, `addCents`, `applyTaxBps`).
4. **Time is UTC.** Timestamps stored UTC; each Location has an IANA `timezone`.
   Slot math (Phase 2) happens in the location's timezone via `date-fns-tz`.
5. **`slots.ts` (Phase 2) is pure** — plain-data in, open slots out, NO DB calls.
   It will be the most test-covered file in the repo.
6. **Validation.** Every route handler parses input with a Zod schema before the DB.

## Session / auth

- `src/lib/auth.ts` exports `handlers`, `auth`, `signIn`, `signOut`, and
  `getSessionContext()` → `{ businessId, userId, role }` (a `TenantContext`) or null.
- Session carries `userId`, `businessId`, `role`. Email is unique **per business**
  (`@@unique([businessId, email])`), so login checks the password against every user
  with that email and signs in the first match.
- Route groups: `(auth)` = login/register, `(admin)` = ADMIN-only, `(staff)` =
  any authenticated user. Layouts enforce access with `getSessionContext()` + redirect.

## Database — embedded Postgres (no Docker/Homebrew/system PG)

Uses the `embedded-postgres` npm package's bundled binaries, driven as a real
daemon via `pg_ctl` (in `scripts/db.mjs`) so the server persists across separate
`npm run` commands. Data dir: `.pgdata/` (gitignored). Port 5433, user/pass
`postgres`/`postgres`, database `appdb`.

```
npm run db:start   # init (first run) + start daemon + ensure appdb exists
npm run db:stop    # stop the daemon
npm run db:status  # running / stopped
npm run db:push    # prisma db push (sync schema)
npm run db:seed    # tsx prisma/seed.ts
```

`DATABASE_URL=postgresql://postgres:postgres@localhost:5433/appdb` lives in `.env`.
Only server binaries ship (no `createdb`/`psql`); the `pg` client is used to create
the database.

## Running the app

```
npm run db:start
npm run db:push
npm run db:seed
npm run dev        # http://localhost:3000
```

## Tests (phase gates)

```
npm run test       # vitest: money, cross-tenant isolation, no-direct-prisma guard
npm run e2e        # playwright: login flow at 375px + 1280px (boots DB + dev server)
```

Playwright's `webServer` runs `db:start && db:seed && dev`, so e2e is self-contained.
The tenant-isolation and no-direct-prisma tests are permanent regression guards.

## Seeded logins (all password `password123`)

- Acme Styling: `admin@acme.test` (ADMIN), `alex@acme.test` (deposits on),
  `bella@acme.test` (requires approval)
- Beta Wellness: `admin@beta.test` (ADMIN), `carlos@beta.test` (deposits on),
  `dana@beta.test` (requires approval)

## Layout

```
src/app        # routes: (auth) (admin) (staff) api
src/lib        # db, tenant, auth, money, onboarding, shell  (raw prisma lives here)
src/components # AppShell (responsive nav) etc.
prisma/        # schema.prisma, seed.ts
scripts/db.mjs # embedded Postgres control
tests/unit     # vitest    tests/e2e # playwright
```

Deferred to later phases (do not build early): `storage.ts`, `branding.ts`,
Square/Twilio/Resend real-provider integrations, ZXing scanning.

## Phase 2 — Schedules & slot engine

`src/lib/slots.ts` is PURE (guardrail #5): plain data in, open slots out, zero DB
calls. It is the most test-covered file (`tests/unit/slots.test.ts`, 21 cases).

```ts
computeOpenSlots(args: ComputeOpenSlotsArgs): Slot[]

type ComputeOpenSlotsArgs = {
  weekly: WeeklyHours;               // staff template {mon:[["09:00","17:00"]],...}
  locationHours?: WeeklyHours;       // weekly template is intersected with these
  overrides?: ScheduleOverrideInput[];  // {date,"YYYY-MM-DD"; closed?; reopen?; hours?}
  holidays?: Holiday[];              // defaults to HOLIDAYS_2026_2028
  closures?: ClosureInput[];         // {date} — always block, no reopen
  existingAppointments?: { start: Date|string; end: Date|string }[];
  durationMin: number;
  bufferMin?: number;                // required gap before AND after each appt
  timezone: string;                  // Location IANA tz
  dateRange: { start: string; end: string };  // inclusive local "YYYY-MM-DD"
  slotStepMin?: number;              // default SLOT_GRANULARITY_MIN
};
type Slot = { start: Date; end: Date };  // absolute UTC instants
```

Rules encoded: closures always block; an override `closed` blocks; holidays block
unless an override with `reopen:true` exists for that date; an override's `hours`
**replace** the weekly template for that date (precedence) and are used as-is
(not intersected with location hours); the weekly template is intersected with
`locationHours` when provided; buffer-aware, DST-correct.

- **Granularity constant:** `SLOT_GRANULARITY_MIN = 15` (finer of the plan's two
  options; divides every seeded service duration). Override per-call via `slotStepMin`.
- **DST:** slots step by REAL elapsed minutes between the open/close instants
  (`fromZonedTime`), so spring-forward days yield fewer slots and fall-back days
  more — never a non-existent wall-clock time, never a duplicated repeated hour.
- **Holidays:** `HOLIDAYS_2026_2028` (33 entries; actual dates, no weekend-in-lieu
  shifting). `ScheduleOverride{reopen:true}` unblocks a date.
- **Model mapping:** `ScheduleOverride.intervals` (Json) surfaces as slot `hours`.

Persistence (`src/lib/schedule.ts`, all via `tenantDb`/`ownershipWhere`):
`getScheduleEditorData`, `saveWeekly`, `addOverride`, `deleteOverride`,
`updateMySettings`. Routes: `PUT /api/schedule`, `POST|DELETE /api/schedule/override`,
`PUT /api/me/settings`. Staff UI at `/dashboard/schedule`
(`src/components/ScheduleEditor.tsx`): weekly template per location, date
overrides (close / reopen holiday / special hours), and per-user approval +
deposit settings. Seed now creates one `Schedule` per user at their first location.

## Phase 3 — Booking, calendars, notifications

**`src/lib/notify.ts`** (guardrail #1: logs via `tenantDb`). Public flows are
unauthenticated, so these take `businessId` (not a full `TenantContext`):

```ts
sendSms(businessId: string, to: string, body: string, template = "sms"): Promise<void>
sendEmail(businessId: string, to: string, subject: string, body: string, template = "email"): Promise<void>
```

Each writes a `NotificationLog` row. When `NOTIFY_DRIVER=console` (the dev default
in `.env`) it `console.log`s instead of calling a provider; other drivers record
`status="skipped_no_provider"` until real Twilio/Resend creds are wired in a later
pass (marked branch — no TODO churn). `template` labels the message
("booking_request_staff", "booking_confirmed_customer").

**Public booking** (`src/app/(public)/b/[businessSlug]/...`, NO auth; customers
identified by phone). Funnel: location → `[locationId]` staff → `[userId]` service
(price via `money.ts`) → `[serviceId]` calendar. `src/lib/booking.ts` (via
`tenantDb` with a synthetic public ctx — scopes on businessId only) exposes
`getBookingBusiness` (Business is the tenant root, not a tenant model),
`getBookingLocations`, `getLocationStaff`, `getStaffServices`, `getSlotGrid`,
`createBooking`, plus the PURE, unit-tested `partitionSlots(candidates, open)`.

- **Slots reuse `computeOpenSlots` exactly** (guardrail #5), called TWICE per grid:
  once with `existingAppointments: []` (full candidate grid) and once with the real
  appointments (bookable subset); `partitionSlots` marks the difference as `taken`.
  Past slots are dropped. `BLOCKING_STATUSES = [REQUESTED, CONFIRMED, COMPLETED]`.
- Taken slots render as a red, line-through `<span>` ("✕ time", `data-taken="true"`)
  exposing NO customer/service detail; open slots are clickable buttons.
- `createBooking` re-validates the slot server-side, looks up Customer by
  `(businessId, phone)` else creates, then Appointment `REQUESTED` if the staff
  member `requiresApproval` else `CONFIRMED`. Notifies: staff email on REQUESTED,
  customer SMS(+email) confirmation on CONFIRMED.
- Public routes: `GET /api/public/slots` (Zod query), `POST /api/public/book`.

**Staff views** (`src/lib/appointments.ts`, all `tenantDb`/`ownershipWhere`):
`getMyCalendar` (`/dashboard/calendar` — USER sees own; ADMIN sees all with a
`?staff=` filter, full detail: customer/phone/service/time),
`getApprovalQueue` + `decideAppointment` (`/dashboard/approvals`, client
`ApprovalQueue.tsx`, Approve/Decline). Route: `POST /api/appointments/decision`
(auth, Zod `{appointmentId, action: approve|decline}`).

- **Decline** = set `status=CANCELLED` with `cancelledBy` (deciding user) +
  `cancelledAt`. No DECLINED enum value / no migration (plan says avoid). Approve =
  `CONFIRMED` + customer confirmation notification.

Nav: staff shell adds Calendar + Approvals; staff dashboard shows the public
booking link (`getShellData` now returns `businessSlug`). Seed adds a week of
mixed-status appointments per business.

Gate: `tests/e2e/booking.spec.ts` (book → approve → slot X-ed out to next
customer, desktop + mobile) + `tests/unit/booking.test.ts` (partition + Zod).

## Phase 4 — Cancel/reschedule + reminders

**`src/lib/cancellation.ts`** — customer self-serve cancel/reschedule via a
login-less magic link, using the same synthetic public `tenantDb` context as
booking.ts. The manage link is `/b/[businessSlug]/manage/[manageToken]`
(`Appointment.manageToken`, `String @unique @default(cuid())`, generated at
booking time and included in the confirmation SMS/email and shown directly on
the booking-confirmation page).

```ts
isWithinCancelCutoff(apptStartUtc: Date, cutoffHours: number, now?: Date): boolean
canSelfServe(apptStartUtc: Date, cutoffHours: number, now?: Date): boolean
getManageView(businessSlug, manageToken): Promise<ManageView | null>
getManageSlots(businessSlug, manageToken): Promise<DayGrid[] | null>  // excludes the appt's own current slot
cancelByToken(input): Promise<{ ok: true; status: "CANCELLED" }>
rescheduleByToken(input): Promise<{ ok: true; status: string; startIso: string }>
```

- Cutoff is a pure hours-before-start check on absolute UTC instants
  (`Business.cancelCutoffHours`, default 24) — timezone-independent. Boundary is
  inclusive-blocked (exactly at the cutoff = blocked). Blocked appointments show
  a "contact the business directly" message with no cancel/reschedule controls.
  Also blocks self-serve on non-`REQUESTED`/`CONFIRMED` statuses.
- **Reschedule mutates the same Appointment row in place** (`startsAt`/`endsAt`
  updated via `tenantDb`, not a new row) — the old slot is freed implicitly.
  Reuses `getSlotGrid`/`computeOpenSlots` exactly (guardrail #5), re-validates
  the target slot server-side, and resets `reminderSentAt` to null.
- Routes: `GET /api/public/manage/slots`, `POST /api/public/manage/cancel`,
  `POST /api/public/manage/reschedule` (all Zod-validated).
- Staff calendar (`/dashboard/calendar`) gained cancel/no-show actions
  (`AppointmentActions.tsx`), always available regardless of cutoff, scoped by
  `ownershipWhere`.

**`scripts/send-reminders.ts`** (`npm run remind`) — standalone script (not
under `src/app`, so the no-direct-prisma guard doesn't apply; it queries across
all businesses directly via Prisma, a documented exception for cross-tenant
sweep scripts). Finds CONFIRMED appointments starting ~23–25h out with
`reminderSentAt IS NULL`, sends a reminder via `notify.ts`, then stamps
`reminderSentAt` — the dedup guard so re-running the script (e.g. more than
once a day via cron) never double-sends. Reschedule clears `reminderSentAt` so
a moved appointment gets a fresh reminder.

Gate: `tests/unit/cancellation.test.ts` (7, cutoff boundary), `tests/unit/reminders.test.ts`
(7, due-window + dedup logic) + `tests/e2e/manage.spec.ts` (magic-link
reschedule frees the old slot/fills the new one; within-cutoff shows the
contact-business message with no controls — desktop + mobile).

**Test-writing note:** service durations (30–90 min) exceed the 15-min slot
granularity, so a slot merely adjacent to an original booking still overlaps
its occupied window — e2e assertions that a "reschedule frees the old slot"
must pick a target on a different calendar date, not just a different slot, or
the old slot will legitimately still show taken. Also, `ManageBooking.tsx`'s
`reschedule-grid` container renders synchronously on mode change, before its
slots fetch resolves — tests must wait for an actual `[data-slot]` cell inside
it, not just the container, to avoid racing the "Loading…" state.

## Phase 5 — Inventory

No schema changes were needed — every Phase 5 model already existed.

**`src/lib/storage.ts`** — minimal local-disk image store (S3 swap deferred).
Raw disk I/O only; touches NO tenant DB model, so it sits outside the tenant
guardrail (the `photoPath` it returns is persisted on `InventoryItem` via
`inventory.ts`/`tenantDb`).

```ts
saveImage({ data: Uint8Array; contentType }, { subdir? }): Promise<string /* photoPath */>
getImageUrl(photoPath): string            // -> "/api/uploads/<photoPath>"
resolveUploadPath(relPath): string | null // traversal-guarded abs path, null if it escapes root
readStoredImage(relPath): Promise<{ data; contentType } | null>
```

Files live under `./uploads` (gitignored, OUTSIDE `public/`) in a sanitized
single-segment subdir (default `inventory`), named `<uuid>.<ext>`. Validates
content type (jpeg/png/webp/gif) and caps size at `MAX_IMAGE_BYTES` (5 MB).
Images are served by the route handler **`GET /api/uploads/[...path]`** (never
statically); it refuses path traversal via `resolveUploadPath`.

**`src/lib/inventory.ts`** — all tenant access via `tenantDb`/`ownershipWhere`.

Pure, DB-free, unit-tested helpers:
- `applyDelta(qtyOnHand, delta) => qtyOnHand + delta`
- `isLowStock(qtyOnHand, lowStockAt) => qtyOnHand <= lowStockAt` (at-threshold IS low)
- `resolveOwner({locationId?, userId?}) => {kind,...}` — enforces EXACTLY ONE owner
  (throws on both / neither; empty strings count as unset).

Functions: `getInventoryPageData`, `createItem`, `updateItem`, `deleteItem`,
`adjustStock`, `getStockReport`, `getServiceProducts`, `setServiceProducts`.

**Ownership model (exactly one owner):** an item is owned EITHER by a location
(shared stock: `locationId` set, `userId` null) OR by a user (own product:
`userId` set, `locationId` null).
- **Visibility:** ADMIN sees the whole tenant; a USER sees their own user-owned
  items PLUS shared items at their assigned locations (`visibleWhere`).
- **Create:** ADMIN may create either kind (`resolveOwner` + owner-exists check).
  A USER may only create their OWN user-owned item — an explicit `locationId`
  (or another user's `userId`) is REJECTED, not silently reassigned.
- **Edit/delete metadata:** ADMIN anything; USER only their own user-owned items
  (`canEdit`). A USER cannot edit shared items — only adjust their stock.
- **Adjust stock:** ADMIN anything; USER their own items OR shared items at their
  assigned locations (`canAdjust`).
- **`adjustStock` is atomic:** one `prisma.$transaction` writes the
  `StockAdjustment` row AND updates `InventoryItem.qtyOnHand` together. Raw
  `prisma` is used (allowed in `src/lib`) only after the item is tenant-verified
  through `tenantDb`; the write-by-id then stays inside the tenant boundary.
  Rejects an adjustment that would drive qty below 0. SOLD/DAMAGED are sent as
  negative deltas by the UI; RECEIVED/MANUAL positive.

**Service→product consumption links** (`ServiceProduct`, for Phase 6 checkout
decrement — NOT consumed here): `getServiceProducts(ctx, serviceId)` lists,
`setServiceProducts(ctx, {serviceId, links})` replaces the whole set. Service
ownership is `ownershipWhere`-scoped; every linked item is tenant-verified. Seed
now adds one sample link per business (staff[0]'s first service consumes 1
"Premium Serum").

**Routes** (all auth + Zod): `POST|PUT|DELETE /api/inventory` (create/update/
delete), `POST /api/inventory/adjust`, `POST /api/inventory/photo` (multipart →
`storage.saveImage` → returns `photoPath`, persisted via the create/update call),
`GET|PUT /api/inventory/service-products`.

**Pages** (staff shell gained Inventory + Stock nav links):
- `/dashboard/inventory` (`InventoryManager.tsx`) — item list with low-stock
  badge (`qtyOnHand <= lowStockAt`), create form (owner picker for ADMIN; forced
  self for USER), inline edit/delete/adjust, camera barcode scan + photo upload,
  and a Service-recipes panel.
- `/dashboard/stock` — the per-user **stock report**: a USER sees "My items" +
  shared stock grouped by their locations, each with level, low-stock flag, and
  recent adjustments; ADMIN sees a per-location rollup of shared stock plus a
  per-staff rollup of owned stock.

**Barcode scan** (`BarcodeScanner.tsx`, `@zxing/browser`): the reader is
**dynamically imported only on "Scan" tap**, so nothing camera-related runs on
load or during SSR. If there's no camera / permission is denied / the lib fails,
it catches, shows "Camera unavailable — enter the barcode manually", and stops —
the form's manual barcode text input always works. E2e covers manual entry and
asserts the scanner mounts without crashing the page (headless has no camera).

Gate: `tests/unit/inventory.test.ts` (21: pure `applyDelta`/`isLowStock`/
`resolveOwner` incl. at-threshold and zero/negative edges, plus DB-backed
cross-tenant + cross-user + shared-location-scope isolation) and
`tests/e2e/inventory.spec.ts` (create → receive +10 → sell −8 → qty 2 with
low-stock badge on both the inventory card and the stock report; desktop +
mobile). Full suite: **79 vitest + 14 Playwright** green.

## Phase 6 — Square payment reconciliation (correlate-only, NOT a checkout)

**This app never charges cards, never creates Square Orders/Payment Links, and
never issues refunds.** No card entry UI anywhere. Staff keep taking money
through Square however they already do; we only READ Square's payment history
and let staff manually confirm which Square payment corresponds to which local
bookkeeping record. Per-user `depositEnabled`/`depositCents` stay INERT (no
deposit is collected or expected anywhere).

**Schema change:** the ONLY change was adding `PaymentStatus` enum
(`UNMATCHED|PAID|REFUNDED`) + `Payment.status @default(UNMATCHED)`. `prisma db
push` backfilled existing rows via the DEFAULT — no reset. `PaymentLine` was
deliberately NOT added to `TENANT_MODELS` (it has no `businessId` column; adding
one would exceed the sanctioned single-field change) — it is created/read ONLY
through the tenant-scoped `Payment` parent (nested `create` / `include`), so it
never escapes the tenant boundary.

**`src/lib/square.ts`** — READ-ONLY client, driver-gated like `notify.ts`:

```ts
type SquarePaymentSummary = { id; amountCents; createdAt: Date; refundedCents; last4? };
listRecentPayments(business, opts?: { sinceDays? }): Promise<SquarePaymentSummary[]>
getPayment(business, squarePaymentId): Promise<SquarePaymentSummary | null>
```

`SQUARE_DRIVER=fake` (dev/test default in `.env`; also the default when unset)
returns canned in-memory fixtures (7 stable ids/amounts, timestamps generated
relative to now so they stay in-window; `fake_sq_refunded` carries a refund).
`SQUARE_DRIVER=live` dynamically imports the `square` SDK and calls read-only
`payments.list` / `payments.get` with the business's own token/location. Only
`ListPayments`/`GetPayment` are ever called.

**`src/lib/payments.ts`** (all tenant access via `tenantDb`/`ownershipWhere`):

- PURE, unit-tested matching: `scoreMatch(local:{amountCents,createdAt}, candidate)`
  → `100 · amountScore · (0.5 + 0.5·timeScore)`. Amount is the dominant HARD GATE
  (`amountScore = max(0, 1 − |Δcents|/AMOUNT_TOLERANCE_CENTS)`, tol $50 → far
  amount scores 0 = no match no matter the time); time only MODULATES a plausible
  match between 0.5×–1.0× (`timeScore = max(0, 1 − |Δmin|/TIME_TOLERANCE_MIN)`,
  tol 30 days). `rankCandidates(local, candidates)` sorts best-first, ties broken
  deterministically by candidate id ascending. No DB, no `Date.now()` — reference
  times are passed in.
- `createPayment(ctx, {appointmentId, method, tipCents, products?})` — for a
  COMPLETED appointment only; one SERVICE line (service price) + one PRODUCT line
  per consumed BOM item (`ServiceProduct`) and per extra retail product; subtotal
  = Σ lines, `taxCents = applyTaxBps(subtotal, business.taxRateBps)`, total =
  subtotal+tax+tip; `status = UNMATCHED`. **Touches NO inventory.** Rejects a
  second payment for the same appointment.
- `markPaid(ctx, {paymentId})` — CASH/OTHER only → status PAID.
- `confirmMatch(ctx, {paymentId, squarePaymentId})` — SQUARE only → stores
  `squarePaymentId` + status PAID (guards against linking one Square id twice).
- `recordRefund(ctx, {paymentId, refundedCents})` — reflect a Square refund →
  `refundedCents` + status REFUNDED (app never calls Square's refund API).
- `getPaymentsByAppointment`, `getReconcileData` (reads for calendar + reconcile).

**Inventory decrement happens at exactly ONE point:** when a Payment transitions
UNMATCHED → PAID (via `markPaid` OR `confirmMatch`). Both call a shared helper
that, for each PRODUCT line, calls Phase 5's `adjustStock(ctx, {itemId, delta:
-qty, reason: "SOLD"})` — reusing its atomic StockAdjustment+qtyOnHand
transaction and permission check. Decrements run BEFORE flipping to PAID, so a
failure (e.g. insufficient stock) leaves the record UNMATCHED rather than
paid-but-unadjusted. Never at Payment creation.

**Routes** (auth + Zod): `POST /api/payments` (create), `POST
/api/payments/mark-paid`, `POST /api/payments/confirm-match`, `POST
/api/payments/refund`, `GET /api/payments/reconcile`. All ownership-scoped: a
USER manages only their own appointments' payments; ADMIN all.

**UI:** the staff **Calendar** (`/dashboard/calendar`) gained a per-appointment
flow — CONFIRMED appts get a **Complete** button (`staffUpdateStatus` extended
with a `complete` action → COMPLETED, the payment entry point); COMPLETED appts
render `PaymentPanel.tsx` (record method+tip → UNMATCHED; then Mark-paid for
cash/other, or a link to Reconcile for Square; shows PAID/REFUNDED badge).
**`/dashboard/reconcile`** (`ReconcileView.tsx`, new nav link) lists UNMATCHED
Square payments each with their top-3 ranked Square candidates (amount, time,
last4, "best match") + Confirm-match buttons — never auto-linked — plus a
refund-alerts section for linked payments Square now shows refunded. Seed now
adds one UNMATCHED SQUARE payment (SERVICE line only) for each business's
COMPLETED appointment so reconcile is non-empty on a fresh seed.

Gate: `tests/unit/payments.test.ts` (13: scoring exact/near/far amount+time,
amount-dominates-time, close-beats-distant ranking, deterministic tie-break,
plus DB-backed transaction boundary — creation moves no stock, mark-paid/
confirm-match each decrement by the product-line qty, idempotency guard) +
`tests/e2e/payments.spec.ts` (book Alex's Blowout → complete → record → Square
confirm-match → PAID + serum −1; and the cash mark-paid path → PAID + serum −1;
desktop + mobile). Full suite: **92 vitest + 18 Playwright** green.

## Phase 7 — Reporting (pure reads; NO schema change)

**`src/lib/reports.ts`** — read-only reporting, all tenant access via `tenantDb`
(guardrail #1) and `ownershipWhere` (guardrail #2): a USER sees only its own
payments/appointments; an ADMIN sees the whole business and may narrow with
optional `userId`/`locationId` filters. Every report is available along TWO
grouping dimensions: **by user** and **by location** (Prisma `groupBy` through
the tenant-scoped delegate; `PaymentLine` service-revenue is read only via the
tenant-scoped `Payment` parent's `include`, never directly).

Documented definitions (the vitest gate asserts these exactly):
- **Revenue** counts only `Payment` rows with status **PAID or REFUNDED**
  (UNMATCHED contributes nothing). Per row `gross = subtotal + tax + tip`,
  `net = gross − refundedCents`. A REFUNDED row is still in gross (money was
  taken) and its `refundedCents` is subtracted for net; PAID rows have
  `refundedCents = 0`. `taxCents`/`tipCents` are broken out as their own columns
  (Σ over the same rows) for tax rollups. `paymentCount` = number of
  PAID+REFUNDED rows.
- **No-show rate** = `NO_SHOW / (COMPLETED + NO_SHOW)` over appointments in the
  window; REQUESTED/CONFIRMED (not yet happened) and CANCELLED (not a no-show)
  are excluded from the denominator; 0 when the denominator is 0.
- **Top services by revenue** = Σ SERVICE-line `unitCents*qty` over PAID+REFUNDED
  payments in the window, grouped by the line's service (gross service revenue,
  not refund-adjusted since refunds aren't line-attributed). **By count** =
  COMPLETED appointments grouped by `serviceId`. Both sort best-first, ties
  broken by `serviceId` ascending; top 10.
- **Periods** (`periodRange`, pure): month/quarter/year as half-open **UTC**
  calendar boundaries `[start, end)` on `Payment.createdAt` (so quarter = Σ its
  months exactly; timezone-independent across multi-tz locations). Operational
  reports take an explicit inclusive date range (`dayRange`), filtering
  appointments by `startsAt`, payments by `createdAt`.

Functions:
- `getFinancialReport(ctx, {period, userId?, locationId?}) → {period, byUser[],
  byLocation[], totals}` (each row: gross/net/tax/tip/refunds/paymentCount).
- `getOperationalReport(ctx, {range, userId?, locationId?}) → {range, volume[]
  (all 5 statuses), totalAppointments, noShow{completed,noShow,rate}, top
  ServicesByCount[], topServicesByRevenue[]}`.
- `getReportFilters(ctx)` — staff + location lists for the ADMIN filter UI.
- Pure helpers: `periodRange`, `periodLabel`, `dayRange`, `queryToPeriod`,
  `centsToDollars`, `financialReportToCsv`, `operationalReportToCsv`, plus the
  `financialQuerySchema`/`operationalQuerySchema` Zod query schemas.

**CSV** (single source of truth: the report objects above; serializers live in
reports.ts). Money is emitted as **decimal dollars** (e.g. `12345` cents →
`123.45`) at the CSV boundary only — the UI keeps using `formatCents`. CRLF rows,
RFC-4180 quoting. Financial columns: `dimension,key,label,grossRevenue,
netRevenue,tax,tips,refunds,paymentCount` (user rows, then location rows, then a
`total` row). Operational: `section,key,label,count,revenue` (volume, no-show,
top-service sections).

**Routes** (auth + Zod query): `GET /api/reports/financial`, `GET
/api/reports/operational` — return `text/csv` with a
`Content-Disposition: attachment` filename. Both accept `period=month|quarter|
year` + `year` (+ `month`/`quarter`), optional `userId`/`locationId`;
operational also accepts an explicit inclusive `start`/`end` (`YYYY-MM-DD`) that
overrides the period window. Ownership-scoped like the page.

**Page** `/dashboard/reports` (server component in `page.tsx`, no client JS —
the period/filter form is a plain GET form; staff shell gained a **Reports** nav
link). One period picker (month/quarter/year) drives
both sections; ADMIN additionally gets staff + location filter selects. A USER
sees their own totals, a by-location table, and the operational metrics (no
per-staff table). An ADMIN sees BOTH grouping tables (by-staff and by-location)
plus totals. Tables scroll horizontally on mobile (`overflow-x-auto`), usable at
375px. Each section has a Download-CSV link carrying the current filters.

Gate: `tests/unit/reports.test.ts` (14: pure period/CSV helpers, plus DB-backed
deterministic fixtures with KNOWN cents — monthly revenue/tax/tip by user AND by
location, refund subtraction, quarter = Σ months + year includes the excluded
quarter, no-show rate, top-services ordering, and USER-role scoping asserting a
USER's report never includes another user's payments/services) and
`tests/e2e/reports.spec.ts` (USER sees own numbers — seed NO_SHOW = 1 — with no
per-staff table and no colleague identifiable; ADMIN sees both grouping tables;
CSV export via an authenticated request → 200, `text/csv`, header + data row;
desktop + mobile). Full suite: **106 vitest + 24 Playwright** green.

## Phase 8 — Branding, PWA manifest & accessibility (FINAL)

No schema changes: `Branding { logoPath?, bannerPath?, primaryColor, accentColor }`
and `brandingId String?` on Business, Location, AND User already existed (Phase 1).
`branding` is in `TENANT_MODELS`.

**`src/lib/branding.ts`** — resolution + persistence, all tenant reads via
`tenantDb` with a local synthetic public ctx (`brandingCtx`, businessId-scoped,
mirrors booking.ts). Business is the tenant root → read via raw `prisma` in lib.

```ts
resolveBranding(businessId, opts?: { userId?; locationId? }): Promise<EffectiveBranding>
saveBranding(ctx, input): Promise<{ target; branding }>   // Zod discriminated-union
getBrandingEditorData(ctx): Promise<BrandingEditorData>   // current values per level
type EffectiveBranding = { logoPath; bannerPath; primaryColor; accentColor; logoUrl; bannerUrl }
DEFAULT_PRIMARY = "#1a1a2e"; DEFAULT_ACCENT = "#00ff66"   // match globals.css :root
```

- **Resolution order user → location → business → defaults** (whole-record; most
  specific level that actually has a live Branding row wins; a level with no
  `brandingId` or a dangling one falls through). Tenant-safe: a branding id from
  another business matches zero rows under the scoped delegate, so it can never
  resolve cross-tenant (unit-tested).
- **Permissions** (`saveBranding`): a USER may only `target: "user"` (their own,
  = `ctx.userId`); ADMIN may set `user` | `business` | `location`. Enforced
  server-side, not just in the UI.
- Image reuse: logo/banner upload via `POST /api/branding/photo` (Phase-5
  `storage.saveImage` pattern, `subdir: "branding"`) → `photoPath`, persisted
  through `PUT /api/branding`.

**Pure contrast check** lives in **`src/lib/branding-contrast.ts`** (dependency-free
— NO node built-ins / Prisma — so client components can import it; `branding.ts`
re-exports it). CRITICAL: client components must import contrast helpers from
`branding-contrast.ts`, never `branding.ts` (which pulls `storage.ts`'s
`node:crypto` into the client bundle and 500s the whole app).

```ts
isLowContrastOnWhite(hex): boolean   // WCAG AA (4.5:1) of white text on hex; unit-tested
contrastRatio, relativeLuminance, parseHexColor, AA_NORMAL_TEXT
```

**Applied via CSS variables** in **`src/components/BrandingProvider.tsx`** (server
component): wraps children in a div that sets `--brand-primary` / `--brand-accent`
inline (so descendant buttons/headers using `var(--brand-primary)` inherit) and
exposes `data-brand-primary` / `data-brand-accent` attributes (+ `data-branding-root`)
for tests; `showBanner` renders the logo/banner. Wired into:
- **Staff & admin layouts** — logged-in user's own resolved branding (dashboard shell).
- **Public booking pages** — the branding of the staff/location being booked:
  business landing (`/b/[slug]`) = business; location picker (`/[locationId]`) =
  location→business; service picker + calendar + manage page (staff-specific) =
  that staff user's branding (falls through to location/business). Each page
  resolves and wraps its own content (the `(public)` layout header stays default
  since it sits above the route params).

**Editor** (`src/components/BrandingEditor.tsx`, client): two `<input type="color">`
+ hex fields, logo/banner `<input type="file" accept="image/*" capture>` (camera
capture), live preview, and a WCAG "low contrast" warning when the chosen primary
fails `isLowContrastOnWhite`. Pages: **`/dashboard/branding`** (staff edit their
own) and **`/admin/branding`** (business branding + one editor per location).
Nav links added to both shells.

**PWA manifest:** `src/app/manifest.ts` (Next metadata API) → served at
`/manifest.webmanifest` (`application/manifest+json`), auto-linked in `<head>`.
Icon is a generic placeholder `public/icon.svg` (rounded square "B"), referenced
at `sizes: "any"` for `any` + `maskable`; also set as favicon/apple-icon and
`themeColor` in the root layout. A business's own logo is deliberately NOT the
install icon in v1 (manifest is app-wide, served before any tenant is resolved).

**Accessibility pass:** default primary `#1a1a2e` passes AA against white text
(the editor only warns on user-chosen low-contrast colors — their responsibility).
Added a global `:focus-visible` outline in `globals.css` so custom-colored
buttons always show a keyboard focus ring (Tailwind preflight doesn't suppress
outlines, but colored backgrounds needed a standardized high-contrast ring). All
form inputs already carry associated labels (`htmlFor`/`id` or wrapping `<label>`),
buttons have discernible text, and images have alt text (branding preview/logo
`alt`, decorative banner `alt=""`).

**Seed:** each business now gets a distinctive business-level Branding (fallback)
plus a distinctive user-level Branding on `staff[0]` (alex / carlos), so the
feature and the user→business fallback are visible on a fresh seed (`staff[1]`
has none → falls back). `reset()` also clears `branding` (no FK cascade).

Gate: `tests/unit/branding.test.ts` (10: contrast pure fn incl. known
failing/passing colors + luminance endpoints; resolveBranding precedence
user/location/business/defaults; cross-tenant isolation — a Business-A branding
id never resolves for Business-B) + `tests/e2e/branding.spec.ts` (staff sets a
distinctive primary via the editor → their public service-picker page renders it
(`data-brand-primary`), a colleague's page falls back to business branding; PWA
manifest returns 200 `application/manifest+json` with resolving icons; desktop +
mobile). Full suite: **116 vitest + 28 Playwright** green.
