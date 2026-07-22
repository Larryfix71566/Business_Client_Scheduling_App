# BizMan — Authoritative Rebuild Blueprint

> **Purpose.** This document lets an implementer (including a smaller model)
> recreate this exact project from an empty directory with **no design decisions
> left open**. Every version, schema field, file, function signature, constant,
> route, seed record, and test-count gate is fixed here. When something is not
> specified, choose the simplest option consistent with the Guardrails — do
> **not** invent new abstractions, libraries, or patterns.
>
> **How to use it.** Build in the 8 numbered phases, in order. After each phase,
> run `npm run test` and `npm run e2e` and confirm the **cumulative** counts in
> that phase's "Gate" match exactly before continuing. The counts are exact, not
> minimums — a differing count means the build has drifted.
>
> Final target: **116 Vitest unit tests + 28 Playwright e2e tests, all green,
> `npx tsc --noEmit` clean.**

---

## 1. What the app is

A multi-tenant business-management web app for general service businesses.
Capabilities: customer records, staff scheduling, public online booking with
self-serve cancel/reschedule, inventory with barcode scan, correlate-only
Square payment reconciliation, reporting, and multi-level branding.

Core product decisions (do not revisit):

- **General service business** — generic, configurable services (not salon-specific).
- **Each user is the admin of their own piece**: their own services, pricing,
  schedule, approval rule, deposit toggle, branding, inventory, and reports. The
  business **admin** manages the shared shell (business settings, locations,
  staff accounts, Square link, tax) and sees across all users.
- **Customer identity** = internal cuid; `phone` is unique **per business**,
  searchable and updatable. Phone is never the primary key.
- **Money is always integer cents.** Never floats.
- **Time is stored UTC**; each Location has an IANA timezone; all slot math runs
  in that timezone.
- **Payments are correlate-only.** The app NEVER collects card data, NEVER
  creates Square Orders/Payment Links, NEVER calls Square charge/refund APIs. It
  only READS Square payment history and lets staff confirm which Square payment
  matches which completed appointment. Per-user deposit fields exist but are
  **inert** in v1 (no deposit is ever collected or expected).
- **Notifications** (SMS + email) are abstracted; in dev they log to the console.

Roles & permissions matrix:

| Capability | ADMIN | USER (staff) | Customer (no login) |
|---|---|---|---|
| Business settings, locations, business/location branding, Square link, tax | ✅ | — | — |
| Invite/remove staff | ✅ | — | — |
| Own services, schedule, approval rule, deposit toggle, branding | ✅ (any) | ✅ (own) | — |
| Own inventory items; adjust shared location stock | ✅ (all) | ✅ (own + shared at their locations) | — |
| Appointments | ✅ (all) | ✅ (own) | book / cancel / reschedule own (within cutoff) |
| Financial & stock reporting | ✅ (business-wide, by user & by location) | ✅ (own only) | receipts only |

---

## 2. Fixed stack & pinned versions

Node.js 20+. `package.json` `"type": "module"`. Exact dependency versions:

```json
"dependencies": {
  "@prisma/client": "^6.2.0",
  "@zxing/browser": "^0.2.1",
  "bcryptjs": "^2.4.3",
  "date-fns": "^4.1.0",
  "date-fns-tz": "^3.2.0",
  "next": "^15.1.3",
  "next-auth": "5.0.0-beta.25",
  "react": "^19.0.0",
  "react-dom": "^19.0.0",
  "square": "^44.2.0",
  "zod": "^3.24.1"
},
"devDependencies": {
  "@playwright/test": "^1.49.1",
  "@types/bcryptjs": "^2.4.6",
  "@types/node": "^22.10.2",
  "@types/react": "^19.0.2",
  "@types/react-dom": "^19.0.2",
  "autoprefixer": "^10.4.20",
  "dotenv": "^17.4.2",
  "embedded-postgres": "^18.4.0-beta.17",
  "postcss": "^8.4.49",
  "prisma": "^6.2.0",
  "tailwindcss": "^3.4.17",
  "tsx": "^4.19.2",
  "typescript": "^5.7.2",
  "vitest": "^2.1.8"
}
```

**Deliberate substitutions (keep these):**
- `bcryptjs` (pure JS), not native `bcrypt` — no build toolchain needed.
- `embedded-postgres` bundled binaries, not Docker/Homebrew/system Postgres.
- Scaffold Next.js **manually** (write config files directly); do not run
  `create-next-app` (its interactive prompts break automation).

`package.json` scripts (exact):

```json
"scripts": {
  "dev": "next dev",
  "build": "next build",
  "start": "next start",
  "lint": "next lint",
  "db:start": "node scripts/db.mjs start",
  "db:stop": "node scripts/db.mjs stop",
  "db:status": "node scripts/db.mjs status",
  "db:push": "prisma db push",
  "db:seed": "tsx prisma/seed.ts",
  "remind": "tsx scripts/send-reminders.ts",
  "test": "vitest run",
  "test:watch": "vitest",
  "e2e": "playwright test"
},
"prisma": { "seed": "tsx prisma/seed.ts" }
```

TypeScript strict mode; path alias `@/*` → `src/*`.

---

## 3. Environment & database tooling

`.env` (gitignored; ship `.env.example` with placeholders):

```
DATABASE_URL="postgresql://postgres:postgres@localhost:5433/appdb"
AUTH_SECRET="<openssl rand -hex 32>"
NEXTAUTH_URL="http://localhost:3000"
NOTIFY_DRIVER="console"
SQUARE_DRIVER="fake"
```

**Embedded Postgres (`scripts/db.mjs`).** Drives the `embedded-postgres`
package's bundled binaries as a real daemon via `pg_ctl` so the server persists
across separate `npm run` invocations (the library's in-process mode does not).
Fixed parameters: data dir `.pgdata/` (gitignored), port **5433**, user/pass
`postgres`/`postgres`, database `appdb`. The zonky binaries ship only
`initdb`/`pg_ctl`/`postgres` (no `createdb`/`psql`), so use the `pg` client to
`CREATE DATABASE appdb` if missing. Commands: `start` (init on first run + start
+ ensure db), `stop`, `status`.

`.gitignore` must include: `node_modules/`, `.next/`, `.pgdata/`, `.env`,
`uploads/`, `/coverage`, `/playwright-report`, `/test-results`, `*.log`,
`.DS_Store`, `*.tsbuildinfo`.

Standard run order:
```
npm install
npm run db:start && npm run db:push && npm run db:seed && npm run dev
```

**Vitest** loads `.env` via a `tests/unit/setup-env.ts` (imported through
`vitest.config.ts`) before Prisma initializes, using `dotenv`.

**Playwright** `webServer` runs `db:start && db:seed && dev` so e2e is
self-contained. Two projects: **desktop 1280×800** and **mobile 375×812**.
Every spec runs under both projects (this is why e2e counts are `blocks × 2`).

---

## 4. Non-negotiable guardrails

1. **Tenant isolation.** Every tenant table has `businessId`. Pages/handlers
   under `src/app/**` touch tenant data ONLY through `tenantDb(ctx)` in
   `src/lib/tenant.ts`, which forces `where:{businessId}` on reads and stamps it
   on writes. `src/lib` is the only place allowed to touch raw `prisma` (auth
   lookup, onboarding, shell, and specific documented exceptions). A Vitest
   guard (`tests/unit/no-direct-prisma.test.ts`) greps `src/app/**` for direct
   `prisma.<tenantModel>` usage and fails the build if found. Canonical list =
   `TENANT_MODELS`.
2. **Ownership scoping.** Staff-owned resources (Service, user-owned
   InventoryItem, Schedule, Appointment-as-provider) additionally filter by
   `userId` unless the session role is `ADMIN`. Use `ownershipWhere(ctx)`.
3. **Money is integer cents** (`Int`). Combine/format only via `src/lib/money.ts`.
4. **Time is UTC.** Slot math happens in the location's IANA timezone via
   `date-fns-tz`.
5. **`src/lib/slots.ts` is PURE** — plain data in, open slots out, zero DB calls.
   The most test-covered file in the repo.
6. **Validation.** Every route handler parses input with a Zod schema before the DB.
7. **No new abstractions.** No repositories, DI containers, or event buses.
   Route handler → tenant helper → Prisma. Nothing else.

---

## 5. Complete Prisma schema

`prisma/schema.prisma` — implement **exactly** (all enums, models, relations,
`@@index`, `@@unique`). This full schema is created in Phase 1 so later
migrations stay stable; some fields are used only by later phases.

```prisma
generator client { provider = "prisma-client-js" }
datasource db { provider = "postgresql"; url = env("DATABASE_URL") }

enum Role { ADMIN USER }
enum AdjReason { RECEIVED SOLD DAMAGED MANUAL }
enum ApptStatus { REQUESTED CONFIRMED COMPLETED CANCELLED NO_SHOW }
enum PayMethod { SQUARE CASH OTHER }
enum LineKind { SERVICE PRODUCT }
enum PaymentStatus { UNMATCHED PAID REFUNDED }

model Business {
  id String @id @default(cuid())
  slug String @unique
  name String
  taxRateBps Int @default(0)
  cancelCutoffHours Int @default(24)
  squareAccessToken String?
  squareLocationId String?
  brandingId String?
  users User[]
  locations Location[]
  customers Customer[]
}

model Location {
  id String @id @default(cuid())
  businessId String
  name String
  address String
  timezone String @default("America/New_York")
  brandingId String?
  weeklyHours Json                                  // {mon:[["09:00","17:00"]],...}
  business Business @relation(fields: [businessId], references: [id], onDelete: Cascade)
  closures DateClosure[]
  userLocations UserLocation[]
  @@index([businessId])
}

model User {
  id String @id @default(cuid())
  businessId String
  role Role
  email String
  passwordHash String
  name String
  requiresApproval Boolean @default(false)
  depositEnabled Boolean @default(false)
  depositCents Int @default(0)
  brandingId String?
  business Business @relation(fields: [businessId], references: [id], onDelete: Cascade)
  locations UserLocation[]
  services Service[]
  @@unique([businessId, email])
  @@index([businessId])
}

model UserLocation {
  id String @id @default(cuid())
  businessId String
  userId String
  locationId String
  user User @relation(fields: [userId], references: [id], onDelete: Cascade)
  location Location @relation(fields: [locationId], references: [id], onDelete: Cascade)
  @@unique([userId, locationId])
  @@index([businessId])
}

model Branding {
  id String @id @default(cuid())
  businessId String
  logoPath String?
  bannerPath String?
  primaryColor String @default("#1a1a2e")
  accentColor String @default("#0f6")
  @@index([businessId])
}

model Customer {
  id String @id @default(cuid())
  businessId String
  firstName String
  lastName String
  phone String
  email String?
  notes String?
  smsOptIn Boolean @default(false)
  business Business @relation(fields: [businessId], references: [id], onDelete: Cascade)
  @@unique([businessId, phone])
  @@index([businessId])
}

model Service {
  id String @id @default(cuid())
  businessId String
  userId String
  name String
  description String?
  durationMin Int
  bufferMin Int @default(0)
  priceCents Int
  active Boolean @default(true)
  user User @relation(fields: [userId], references: [id], onDelete: Cascade)
  consumes ServiceProduct[]
  @@index([businessId])
  @@index([userId])
}

model ServiceProduct {
  id String @id @default(cuid())
  businessId String
  serviceId String
  itemId String
  qty Int
  service Service @relation(fields: [serviceId], references: [id], onDelete: Cascade)
  @@index([businessId])
}

model InventoryItem {
  id String @id @default(cuid())
  businessId String
  locationId String?                                // exactly one owner:
  userId String?                                    // location (shared) OR user (own)
  name String
  barcode String?
  photoPath String?
  costCents Int
  priceCents Int
  qtyOnHand Int @default(0)
  lowStockAt Int @default(0)
  adjustments StockAdjustment[]
  @@index([businessId])
}

model StockAdjustment {
  id String @id @default(cuid())
  itemId String
  businessId String
  delta Int
  reason AdjReason
  byUserId String
  createdAt DateTime @default(now())
  item InventoryItem @relation(fields: [itemId], references: [id], onDelete: Cascade)
  @@index([businessId])
  @@index([itemId])
}

model Schedule {
  id String @id @default(cuid())
  businessId String
  userId String
  locationId String
  weekly Json                                       // {mon:[["09:00","17:00"]],...}
  overrides ScheduleOverride[]
  @@index([businessId])
  @@index([userId])
}

model ScheduleOverride {
  id String @id @default(cuid())
  businessId String
  scheduleId String
  date DateTime
  closed Boolean @default(false)
  reopen Boolean @default(false)
  intervals Json?                                   // [["09:00","12:00"]] replacement
  schedule Schedule @relation(fields: [scheduleId], references: [id], onDelete: Cascade)
  @@index([businessId])
}

model DateClosure {
  id String @id @default(cuid())
  businessId String
  locationId String
  date DateTime
  reason String?
  location Location @relation(fields: [locationId], references: [id], onDelete: Cascade)
  @@index([businessId])
}

model Appointment {
  id String @id @default(cuid())
  businessId String
  locationId String
  userId String
  customerId String
  serviceId String
  startsAt DateTime
  endsAt DateTime
  status ApptStatus
  depositPaymentId String?
  cancelledAt DateTime?
  cancelledBy String?
  manageToken String @unique @default(cuid())       // Phase 4 magic-link token
  reminderSentAt DateTime?                          // Phase 4 exactly-once guard
  @@index([businessId])
  @@index([userId])
  @@index([locationId])
}

model Payment {
  id String @id @default(cuid())
  businessId String
  appointmentId String?
  customerId String
  userId String
  locationId String
  squarePaymentId String?
  subtotalCents Int
  taxCents Int
  tipCents Int
  depositAppliedCents Int @default(0)               // inert in v1 (always 0)
  refundedCents Int @default(0)
  method PayMethod
  status PaymentStatus @default(UNMATCHED)          // added in Phase 6
  createdAt DateTime @default(now())
  lines PaymentLine[]
  @@index([businessId])
}

model PaymentLine {
  id String @id @default(cuid())
  paymentId String
  kind LineKind
  refId String
  qty Int
  unitCents Int
  payment Payment @relation(fields: [paymentId], references: [id], onDelete: Cascade)
  @@index([paymentId])
}

model NotificationLog {
  id String @id @default(cuid())
  businessId String
  channel String
  to String
  template String
  status String
  createdAt DateTime @default(now())
  @@index([businessId])
}
```

Notes: `PaymentLine` is intentionally **not** in `TENANT_MODELS` (it has no
`businessId`; it is only ever created/read through its tenant-scoped `Payment`
parent via nested `create`/`include`). `PaymentStatus` + `Payment.status` are
the only Phase-6 schema change; they backfill via the `@default` so no reset is
needed at that phase.

---

## 6. Exact file layout

```
scripts/db.mjs                     # embedded Postgres control (start/stop/status)
scripts/send-reminders.ts          # Phase 4 reminder sweep (npm run remind)
prisma/schema.prisma
prisma/seed.ts
public/icon.svg                    # Phase 8 PWA placeholder icon

src/lib/
  db.ts            tenant.ts        auth.ts          money.ts
  onboarding.ts    shell.ts         slots.ts         schedule.ts
  notify.ts        booking.ts       appointments.ts  cancellation.ts
  reminders.ts     storage.ts       inventory.ts     square.ts
  payments.ts      reports.ts       branding.ts      branding-contrast.ts

src/components/
  AppShell.tsx           ScheduleEditor.tsx     BookingCalendar.tsx
  ApprovalQueue.tsx      AppointmentActions.tsx ManageBooking.tsx
  BarcodeScanner.tsx     InventoryManager.tsx   PaymentPanel.tsx
  ReconcileView.tsx      BrandingEditor.tsx     BrandingProvider.tsx

src/app/
  layout.tsx  globals.css  manifest.ts  page.tsx
  (auth)/login/page.tsx  (auth)/register/page.tsx
  (admin)/admin/page.tsx  (admin)/admin/staff/page.tsx  (admin)/admin/branding/page.tsx
  (staff)/dashboard/{page,approvals,branding,calendar,inventory,reconcile,reports,schedule,stock}/page.tsx
  (public)/b/[businessSlug]/page.tsx
  (public)/b/[businessSlug]/[locationId]/page.tsx
  (public)/b/[businessSlug]/[locationId]/[userId]/page.tsx
  (public)/b/[businessSlug]/[locationId]/[userId]/[serviceId]/page.tsx
  (public)/b/[businessSlug]/manage/[manageToken]/page.tsx
  api/... (see §7)

tests/unit/   (see §8 gates)      tests/e2e/  (see §8 gates)
```

---

## 7. Complete route inventory

All handlers: auth-checked where noted, Zod-validated, tenant-scoped via
`tenantDb`. Public routes use a synthetic public context scoped on `businessId`
only.

```
POST   /api/register                       # create Business + slug + first Location + ADMIN user
POST   /api/staff                          # (admin) invite USER, returns one-time temp password
       /api/auth/[...nextauth]             # NextAuth handlers

PUT    /api/schedule                       # saveWeekly
POST   /api/schedule/override              # addOverride
DELETE /api/schedule/override              # deleteOverride
PUT    /api/me/settings                    # updateMySettings (requiresApproval, deposit*)

GET    /api/public/slots                   # public: BookingCalendar grid
POST   /api/public/book                    # public: createBooking
GET    /api/public/manage/slots            # public: reschedule grid (excludes own slot)
POST   /api/public/manage/cancel           # public: cancelByToken
POST   /api/public/manage/reschedule       # public: rescheduleByToken

POST   /api/appointments/decision          # (auth) approve|decline
POST   /api/appointments/status            # (auth) complete|noshow|cancel (staff calendar)

POST   /api/inventory                      # create
PUT    /api/inventory                      # update
DELETE /api/inventory                      # delete
POST   /api/inventory/adjust               # adjustStock
POST   /api/inventory/photo                # multipart -> storage.saveImage -> photoPath
GET    /api/inventory/service-products     # list ServiceProduct links
PUT    /api/inventory/service-products     # replace link set
GET    /api/uploads/[...path]              # serve ./uploads image (traversal-guarded, never static)

POST   /api/payments                       # createPayment (UNMATCHED)
POST   /api/payments/mark-paid             # CASH/OTHER -> PAID (+inventory decrement)
POST   /api/payments/confirm-match         # SQUARE match -> PAID (+inventory decrement)
POST   /api/payments/refund                # reflect a Square refund -> REFUNDED
GET    /api/payments/reconcile             # reconcile view data

GET    /api/reports/financial              # text/csv, Content-Disposition attachment
GET    /api/reports/operational            # text/csv

PUT    /api/branding                       # saveBranding (discriminated union target)
POST   /api/branding/photo                 # multipart -> storage.saveImage (subdir "branding")
```

---

## 8. Build phases (each gate is EXACT and cumulative)

> After each phase run `npm run test` (Vitest) and `npx playwright test`. The
> numbers below are the exact totals expected **at the end of that phase**.
> `npx tsc --noEmit` must be clean at every phase.

### Phase 1 — Foundation
Scaffold Next.js 15 + Tailwind 3 + Prisma 6 + Vitest + Playwright manually.
Implement the FULL schema (§5), `scripts/db.mjs`, `src/lib/db.ts`,
`src/lib/money.ts` (`formatCents`, `addCents`, `applyTaxBps`; throw on
non-integer), `src/lib/tenant.ts` (`tenantDb(ctx)` scoped delegates that inject
`where.businessId` on reads and stamp on writes — route update/delete through
`updateMany`/`deleteMany` so a cross-tenant id matches zero rows;
`ownershipWhere(ctx)`; `TENANT_MODELS`; `TenantContext = {businessId,userId,role}`),
`src/lib/auth.ts` (NextAuth v5 credentials + bcryptjs; `getSessionContext()` →
`TenantContext|null`; session carries `userId/businessId/role`; email unique
per business, so `authorize` checks the password against every user with that
email and signs in the first match), `src/lib/onboarding.ts`
(`registerBusiness`, `inviteStaff`), `src/lib/shell.ts`. Pages: login, register,
`/admin/staff` (create USER + show one-time temp password), responsive
`AppShell` (inline nav ≥ md, hamburger on phone), admin + staff dashboards. Seed
(see §9, businesses/locations/users/services/inventory/customers).
**Gate: 13 Vitest / 6 Playwright.** (money 6, tenant-isolation 5,
no-direct-prisma 2; login spec 3 blocks × 2 projects.)

### Phase 2 — Schedules & pure slot engine
`src/lib/slots.ts` — PURE. `computeOpenSlots(args): Slot[]` where
`Slot = {start: Date; end: Date}` (absolute UTC). Args: `weekly`, optional
`locationHours` (weekly is intersected with these), `overrides`
(`{date; closed?; reopen?; hours?}` — `hours` REPLACE the weekly template for
that date, used as-is, not intersected), `holidays` (default
`HOLIDAYS_2026_2028`), `closures` (`{date}` always block), `existingAppointments`,
`durationMin`, `bufferMin?` (gap before AND after), `timezone`,
`dateRange {start,end}` inclusive local `YYYY-MM-DD`, `slotStepMin?`. Constant
**`SLOT_GRANULARITY_MIN = 15`** (documented). DST: step by REAL elapsed minutes
between open/close instants via `fromZonedTime` (spring-forward → fewer slots,
fall-back → more; never a nonexistent or duplicated wall-clock time). Holidays:
33 hardcoded actual dates (11/yr × 2026–2028, no weekend-in-lieu); a
`ScheduleOverride{reopen:true}` unblocks. Rules precedence: closure/`closed`
block; holiday blocks unless reopened; override `hours` beat weekly.
`src/lib/schedule.ts` (`getScheduleEditorData`, `saveWeekly`, `addOverride`,
`deleteOverride`, `updateMySettings`, all via `tenantDb`/`ownershipWhere`).
Routes + `/dashboard/schedule` (`ScheduleEditor.tsx`: weekly template per
location, overrides, approval + deposit settings). Seed one Schedule per user at
their first location.
**Gate: 34 Vitest / 6 Playwright.** (+slots 21.)

### Phase 3 — Booking & calendar views
`src/lib/notify.ts`: `sendSms(businessId,to,body,template="sms")` and
`sendEmail(businessId,to,subject,body,template="email")` — each writes a
`NotificationLog` via `tenantDb`; `NOTIFY_DRIVER=console` logs instead of
sending, other drivers record `status="skipped_no_provider"`. They take
`businessId` (not full ctx) because public flows are unauthenticated.
`src/lib/booking.ts`: `publicCtx(businessId)`, `getBookingBusiness`,
`getBookingLocations`, `getLocationStaff`, `getStaffServices`, `getSlotGrid`,
`createBooking`, and the PURE unit-tested `partitionSlots(candidates, open)`.
Slots REUSE `computeOpenSlots` exactly, called TWICE per grid (empty
appointments = full candidate grid; real appointments = bookable subset);
`partitionSlots` marks the difference `taken`. Past slots dropped.
`BLOCKING_STATUSES = [REQUESTED, CONFIRMED, COMPLETED]`. Taken slots render as a
red, line-through span (`data-taken="true"`, "✕ time") exposing NO
customer/service detail; open slots are buttons. `createBooking` re-validates
server-side, looks up Customer by `(businessId, phone)` else creates, sets
`REQUESTED` if the staff `requiresApproval` else `CONFIRMED`; notifies (staff
email on request, customer SMS+email on confirm). Public funnel pages
`/b/[businessSlug]/[locationId]/[userId]/[serviceId]`. Staff:
`src/lib/appointments.ts` (`getMyCalendar` — USER own, ADMIN all with `?staff=`;
`getApprovalQueue`, `decideAppointment`), `/dashboard/calendar`,
`/dashboard/approvals` (`ApprovalQueue.tsx`). Decline = `status=CANCELLED` +
`cancelledBy`/`cancelledAt` (no DECLINED enum). Approve = `CONFIRMED` + customer
confirmation. Seed a week of mixed-status appointments per business.
**Gate: 44 Vitest / 8 Playwright.** (+booking 10; +booking spec 1×2.)

### Phase 4 — Cancel/reschedule + reminders
`src/lib/cancellation.ts`: `isWithinCancelCutoff(apptStartUtc, cutoffHours,
now?)` (pure; boundary inclusive-blocked; also blocks non-REQUESTED/CONFIRMED),
`canSelfServe`, `getManageView`, `getManageSlots` (excludes the appt's own
current slot), `cancelByToken`, `rescheduleByToken` (mutates the SAME row in
place — old slot freed implicitly; reuses `getSlotGrid`; resets
`reminderSentAt`). Manage link `/b/[businessSlug]/manage/[manageToken]`, shown
on the confirmation page and in the confirmation SMS/email. Within cutoff →
"contact the business" message, no controls. Staff calendar gains
cancel/no-show (`AppointmentActions.tsx`), always available. `scripts/send-reminders.ts`
(`npm run remind`): finds CONFIRMED appts ~23–25h out with `reminderSentAt IS
NULL`, notifies, stamps `reminderSentAt` (dedup). Cross-tenant sweep script may
use raw prisma (outside `src/app`). Routes: `/api/public/manage/{slots,cancel,reschedule}`.
**Gate: 58 Vitest / 12 Playwright.** (+cancellation 7, +reminders 7; +manage
spec 2×2.)

### Phase 5 — Inventory
`src/lib/storage.ts` (raw disk I/O, no tenant DB): `saveImage({data,contentType},
{subdir?})→photoPath`, `getImageUrl(photoPath)→/api/uploads/<path>`,
`resolveUploadPath` (traversal-guarded, null on escape), `readStoredImage`.
Files in `./uploads` (gitignored, OUTSIDE public), UUID-named, type-validated
(jpeg/png/webp/gif), `MAX_IMAGE_BYTES=5MB`. Served by `GET /api/uploads/[...path]`
(never static). `src/lib/inventory.ts` — pure helpers `applyDelta(qty,delta)`,
`isLowStock(qty,lowStockAt)` (at-threshold IS low), `resolveOwner({locationId?,
userId?})` (EXACTLY one owner; throw on both/neither; empty string = unset); DB
functions `getInventoryPageData`, `createItem`, `updateItem`, `deleteItem`,
`adjustStock`, `getStockReport`, `getServiceProducts`, `setServiceProducts`.
Ownership: item owned by a Location (shared) OR a User (own). USER sees own +
shared at their locations; USER create with explicit `locationId`/other `userId`
is REJECTED. `adjustStock` is atomic (`prisma.$transaction` writes
StockAdjustment + qtyOnHand; item tenant-verified first; rejects below 0;
SOLD/DAMAGED negative). `BarcodeScanner.tsx` (`@zxing/browser`) dynamically
imported only on "Scan" tap; on no-camera/denied/failure shows "Camera
unavailable — enter the barcode manually" (manual input always works). Pages
`/dashboard/inventory` (`InventoryManager.tsx`), `/dashboard/stock`. Seed one
ServiceProduct link per business.
**Gate: 79 Vitest / 14 Playwright.** (+inventory 21; +inventory spec 1×2.)

### Phase 6 — Square payment reconciliation (correlate-only)
Only schema change: `PaymentStatus` enum + `Payment.status @default(UNMATCHED)`
(backfills via default; no reset). `src/lib/square.ts` — READ-ONLY, driver-gated
(`SQUARE_DRIVER=fake` → 7 canned fixtures with relative timestamps, one
refunded; `live` dynamically imports the `square` SDK, calls only
`payments.list`/`payments.get`): `listRecentPayments(business,{sinceDays?})`,
`getPayment(business,id)` → `SquarePaymentSummary {id, amountCents, createdAt,
refundedCents, last4?}`. `src/lib/payments.ts` — PURE
`scoreMatch(local,candidate) = 100·amountScore·(0.5+0.5·timeScore)` where
`amountScore = max(0, 1−|Δcents|/AMOUNT_TOLERANCE_CENTS)` (tol $50, a HARD gate),
`timeScore = max(0, 1−|Δmin|/TIME_TOLERANCE_MIN)` (tol 30 days); no `Date.now()`;
`rankCandidates` sorts best-first, ties by candidate id asc. `createPayment`
(COMPLETED appt only; SERVICE line + PRODUCT lines from ServiceProduct BOM +
extras; `taxCents=applyTaxBps(subtotal,taxRateBps)`; status UNMATCHED; touches
NO inventory; rejects a 2nd payment for the same appt). **Inventory decrement
happens at EXACTLY ONE point: UNMATCHED→PAID** (`markPaid` for CASH/OTHER,
`confirmMatch` for SQUARE), via a shared helper calling Phase-5
`adjustStock(ctx,{itemId,delta:-qty,reason:"SOLD"})` BEFORE flipping to PAID (a
failure leaves it UNMATCHED). `recordRefund` → REFUNDED. Staff Calendar:
CONFIRMED→**Complete** button (extend `appointments` status action → COMPLETED),
COMPLETED→`PaymentPanel.tsx`. `/dashboard/reconcile` (`ReconcileView.tsx`):
UNMATCHED SQUARE payments with top-3 ranked candidates + Confirm-match (never
auto-linked) + refund alerts. Seed one UNMATCHED SQUARE payment per business.
**Gate: 92 Vitest / 18 Playwright.** (+payments 13; +payments spec 2×2.)

### Phase 7 — Reporting (pure reads, no schema change)
`src/lib/reports.ts`, all via `tenantDb`/`ownershipWhere`, two dimensions
everywhere (by user, by location) using Prisma `groupBy`. Definitions (assert
exactly): **Revenue** counts only Payment rows status PAID or REFUNDED; per row
`gross=subtotal+tax+tip`, `net=gross−refundedCents`; PAID rows have refund 0.
Tax and tips are their own columns. **No-show rate** =
`NO_SHOW/(COMPLETED+NO_SHOW)`, 0 when denominator 0. Top services by revenue
(Σ SERVICE-line `unitCents*qty`) and by count (COMPLETED appts grouped by
serviceId), top 10, ties by serviceId asc. Periods: half-open UTC calendar
boundaries on `Payment.createdAt` (quarter = Σ months). Functions:
`getFinancialReport(ctx,{period,userId?,locationId?})`,
`getOperationalReport(ctx,{range,userId?,locationId?})`, `getReportFilters`,
plus pure `periodRange`, `periodLabel`, `dayRange`, `queryToPeriod`,
`centsToDollars`, `financialReportToCsv`, `operationalReportToCsv`, and
`financialQuerySchema`/`operationalQuerySchema`. CSV: decimal dollars at the
boundary only, CRLF, RFC-4180 quoting. Routes `/api/reports/{financial,
operational}` return `text/csv` attachment. Page `/dashboard/reports` (server
component, plain GET form): USER own totals + by-location + operational; ADMIN
both grouping tables + totals + staff/location filters. Tables `overflow-x-auto`.
**Gate: 106 Vitest / 24 Playwright.** (+reports 14; +reports spec 3×2.)

### Phase 8 — Branding, PWA manifest, accessibility (final)
`src/lib/branding.ts` (tenant reads via `tenantDb` with a local synthetic
public ctx; Business read via raw prisma): `resolveBranding(businessId,{userId?,
locationId?})` → `EffectiveBranding {logoPath,bannerPath,primaryColor,
accentColor,logoUrl,bannerUrl}`, order **user → location → business → defaults**
(most specific with a live row wins; dangling/absent id falls through);
`saveBranding(ctx,input)` (Zod discriminated union `user|business|location`;
USER may target only `user`=`ctx.userId`, ADMIN any; enforced server-side);
`getBrandingEditorData(ctx)`. `DEFAULT_PRIMARY="#1a1a2e"`,
`DEFAULT_ACCENT="#00ff66"`. **`src/lib/branding-contrast.ts`** — dependency-free
pure module (`isLowContrastOnWhite`, `contrastRatio`, `relativeLuminance`,
`parseHexColor`, `AA_NORMAL_TEXT`), re-exported by `branding.ts`. CRITICAL:
client components import contrast helpers from `branding-contrast.ts`, NEVER
`branding.ts` (which pulls `storage.ts`'s `node:crypto` into the client bundle
and 500s the app). `BrandingProvider.tsx` (server component) sets
`--brand-primary`/`--brand-accent` inline + `data-brand-primary`/`data-brand-accent`
attributes; wired into staff/admin layouts (logged-in user's branding) and every
public page (business landing = business; location picker = location→business;
service picker/calendar/manage = that staff user's branding). Editor
`BrandingEditor.tsx` (2 color inputs + hex, logo/banner `<input type="file"
accept="image/*" capture>`, live preview, low-contrast warning) at
`/dashboard/branding` (own) and `/admin/branding` (business + per-location).
Routes `PUT /api/branding`, `POST /api/branding/photo` (subdir "branding"). PWA:
`src/app/manifest.ts` → `/manifest.webmanifest` (`application/manifest+json`),
placeholder `public/icon.svg` (`sizes:"any"`, any+maskable), favicon/apple-icon
+ `themeColor` in root layout (business logo is NOT the install icon in v1). A11y:
global `:focus-visible` outline in `globals.css`; default `#1a1a2e` passes AA on
white; labels/alt/discernible-text verified. Seed a distinctive business-level
Branding per business + a distinctive user-level Branding on `staff[0]`;
`reset()` clears `branding`.
**Gate: 116 Vitest / 28 Playwright.** (+branding 10; +branding spec 2×2.)

**Exact per-file Vitest counts (final):** slots 21, inventory 21, reports 14,
payments 13, booking 10, branding 10, cancellation 7, reminders 7, money 6,
tenant-isolation 5, no-direct-prisma 2. **Exact e2e blocks × 2 projects:** login
3, reports 3, branding 2, manage 2, payments 2, booking 1, inventory 1.

---

## 9. Seed data (`prisma/seed.ts`)

`reset()` first (delete all, in FK-safe order incl. `branding`). Then create
**2 businesses** — "Acme Styling" (slug `acme-styling`) and "Beta Wellness"
(slug `beta-wellness`). Each business:

- **2 locations** (e.g. Acme: "Acme Downtown" 100 Main St, "Acme Uptown" 200
  High St), IANA timezone, `weeklyHours` Mon–Fri 09:00–17:00.
- **1 ADMIN + 2 USER** staff. Passwords all `password123` (bcryptjs). One USER
  has `depositEnabled=true` (deposits toggle on but inert), the other has
  `requiresApproval=true`.
- **3 services per user** (varied durations 30–120 min, prices in cents).
- **6 inventory items** (mixed location-owned and user-owned).
- **5 customers** (unique phones).
- A **Schedule** per user at their first location (Phase 2+).
- A **week of mixed-status appointments** per business (Phase 3+), including at
  least one COMPLETED and one NO_SHOW.
- **1 ServiceProduct** link (Phase 5+): staff[0]'s first service consumes 1 of a
  product item.
- **1 UNMATCHED SQUARE Payment** for the COMPLETED appointment (Phase 6+).
- Business-level `Branding` + user-level `Branding` on staff[0] (Phase 8+;
  staff[1] has none → falls back).

Seeded logins (all `password123`):
`admin@acme.test`, `alex@acme.test` (deposits on), `bella@acme.test` (requires
approval); `admin@beta.test`, `carlos@beta.test` (deposits on), `dana@beta.test`
(requires approval).

---

## 10. Gotchas that cause drift (read before building)

- **Prisma 7 seed warning** from `package.json#prisma.seed` is harmless on
  Prisma 6; don't migrate to `prisma.config.ts`.
- **NextAuth v5 `session` callback** casts token fields (its `JWT` has an
  `unknown` index signature); keep the casts so `tsc` stays clean.
- **`findUnique` in `tenantDb`** can't carry a non-unique `businessId` filter —
  implement it via `findFirst`. Route `update`/`delete` through
  `updateMany`/`deleteMany` for the same reason.
- **Override `hours` REPLACE (not add to)** the weekly template for a date and
  are used as-is (not intersected with location hours).
- **Reschedule frees the old slot only on a different date** in tests: service
  durations (30–120) exceed the 15-min granularity, so an adjacent slot still
  overlaps the original occupied window. E2e reschedule targets must be on a
  different calendar date. Also, `ManageBooking.tsx`'s `reschedule-grid`
  container renders before its slots fetch resolves — tests must wait for an
  actual `[data-slot]` cell, and account for a possible dev-mode hydration race
  on the freshly client-navigated manage page (retry the reschedule click once).
- **Decline uses CANCELLED** (`cancelledBy`/`cancelledAt`); no DECLINED enum, no
  migration.
- **Inventory decrement is exactly once**, at UNMATCHED→PAID, before the flip.
  Never at payment creation.
- **`PaymentLine` is not a tenant model** — only ever touched through `Payment`.
- **Client components must import contrast helpers from `branding-contrast.ts`**,
  never `branding.ts`.
- **`AUTH_SECRET` is a dev placeholder** — regenerate for any real deployment.
- Notifications (`NOTIFY_DRIVER`), Square (`SQUARE_DRIVER`), and image storage
  are the three seams to swap for production; leave them in dev/fake/console
  mode for the rebuild.

---

## 11. Definition of done

```
npx tsc --noEmit          # clean
npm run test              # 116 passed
npm run e2e               # 28 passed  (desktop 1280 + mobile 375)
```

Plus a manual smoke: `npm run db:start && npm run db:push && npm run db:seed &&
npm run dev`, then walk the public funnel at `/b/acme-styling` and log in as
`alex@acme.test` / `password123`.
```
