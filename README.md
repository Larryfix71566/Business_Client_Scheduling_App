# BizMan — Business Client Scheduling App

Multi-tenant business management app for general service businesses: customer
scheduling, inventory, payment reconciliation, and reporting. Each staff user
administers their own services, schedule, inventory, branding, and reports; a
business admin manages the shared shell (locations, staff, tax, Square link).

Built with **Next.js 15** (App Router) + **TypeScript** (strict), **PostgreSQL**
+ **Prisma**, **Auth.js** (NextAuth v5), and **Tailwind CSS**. Responsive for
phone / tablet / laptop.

## Features

- **Multi-tenant + multi-location** with enforced tenant isolation (every query
  scoped by `businessId`; a build-failing test guards against direct DB access).
- **Scheduling** — per-user weekly templates, ad-hoc date overrides, US holidays
  with per-date reopen, DST-correct slot math, optional per-user approval.
- **Public booking** (no customer login; phone-based identity) — location → staff
  → service → calendar; taken slots shown crossed-out with no detail leakage.
- **Cancel / reschedule** via magic link with a configurable cutoff; automated
  24-hour reminders.
- **Inventory** — location-shared or user-owned items, barcode scanning (with
  manual fallback), photo uploads, atomic stock adjustments, low-stock alerts,
  and a per-user stock report.
- **Square payment reconciliation (correlate-only)** — the app never charges
  cards; it reads Square's payment history and staff confirm which real Square
  charge matches each completed appointment.
- **Reporting** — monthly / quarterly / yearly financials and operational
  metrics, grouped **by user and by location**, with CSV export.
- **Branding** at business / location / user level (resolved user → location →
  business), plus a PWA manifest.

## Prerequisites

- Node.js 20+
- No Docker or system Postgres needed — an embedded Postgres is bundled and
  driven via `npm run db:*` scripts (data in a gitignored `.pgdata/`).

## Getting started

```bash
npm install
cp .env.example .env      # then edit AUTH_SECRET (openssl rand -hex 32)

npm run db:start          # start embedded Postgres (port 5433)
npm run db:push           # sync the Prisma schema
npm run db:seed           # seed demo businesses, staff, services, etc.
npm run dev               # http://localhost:3000
```

Public booking demo: <http://localhost:3000/b/acme-styling>

### Seeded logins (all password `password123`)

- **Acme Styling** — `admin@acme.test` (admin), `alex@acme.test`, `bella@acme.test`
- **Beta Wellness** — `admin@beta.test` (admin), `carlos@beta.test`, `dana@beta.test`

## Tests

```bash
npm run test              # Vitest unit tests (slot engine, money, tenant guards, ...)
npm run e2e               # Playwright end-to-end (boots DB + dev server)
```

## Notes for production

Three integrations run in dev/stub mode by default and swap behind clean seams:

- **Notifications** log to the console (`NOTIFY_DRIVER=console`) — wire Twilio /
  Resend credentials to send real SMS/email.
- **Square** uses in-memory fixtures (`SQUARE_DRIVER=fake`) — set `live` plus
  per-business tokens to read real payment history (read-only; never charges).
- **Image storage** writes to a local `./uploads` dir behind `src/lib/storage.ts`
  (swap for S3 later).

See [CLAUDE.md](CLAUDE.md) for the full architecture, conventions, and per-phase
implementation notes.
