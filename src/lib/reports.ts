import { z } from "zod";
import { tenantDb, ownershipWhere, type TenantContext } from "./tenant";
import { addCents } from "./money";

/**
 * reports.ts — read-only reporting (Phase 7). Pure reads; NO schema changes.
 *
 * Every report is available along TWO grouping dimensions: by user and by
 * location. All tenant access goes through `tenantDb` (guardrail #1) and is
 * ownership-scoped (guardrail #2): a USER session sees only its own payments and
 * appointments; an ADMIN sees the whole business and may narrow with optional
 * `userId` / `locationId` filters.
 *
 * ---------------------------------------------------------------------------
 * Definitions (documented, load-bearing — the gate asserts these exactly):
 *
 * REVENUE. Financial reports count only Payment rows whose status is PAID or
 * REFUNDED (an UNMATCHED row is bookkeeping that hasn't been confirmed paid, so
 * it contributes nothing). For each counted row:
 *   grossCents = subtotalCents + taxCents + tipCents   (the full amount taken)
 *   netCents   = grossCents − refundedCents            (refunds subtracted)
 * A REFUNDED row is still included in gross (the money WAS taken) and its
 * refundedCents is subtracted to yield net; PAID rows carry refundedCents = 0.
 * Tax and tips are broken out as their own columns (Σ taxCents, Σ tipCents over
 * the same PAID+REFUNDED rows) for tax rollups. paymentCount = number of
 * PAID+REFUNDED rows.
 *
 * NO-SHOW RATE. Over appointments in the window, rate = NO_SHOW /
 * (COMPLETED + NO_SHOW). Only realized outcomes count: REQUESTED/CONFIRMED
 * (not yet happened) and CANCELLED (called off, not a no-show) are excluded
 * from the denominator. When the denominator is 0 the rate is 0.
 *
 * PERIODS. Financial periods (month / quarter / year) are computed as UTC
 * calendar boundaries on Payment.createdAt (half-open [start, end)). Timestamps
 * are stored UTC (guardrail #4); using UTC boundaries keeps a business-wide
 * report unambiguous when it spans locations in different timezones, and makes
 * quarter = Σ its months exactly. Operational reports take an explicit
 * inclusive date range (filtering appointments by startsAt, payments by
 * createdAt), likewise on UTC boundaries.
 * ---------------------------------------------------------------------------
 */

// ===========================================================================
// Periods & ranges (pure)
// ===========================================================================

export type Period =
  | { kind: "month"; year: number; month: number } // month 1-12
  | { kind: "quarter"; year: number; quarter: number } // quarter 1-4
  | { kind: "year"; year: number };

export type DateRange = { start: Date; end: Date }; // half-open [start, end)

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

/** Half-open UTC [start, end) instants for a reporting period. */
export function periodRange(p: Period): DateRange {
  if (p.kind === "month") {
    return {
      start: new Date(Date.UTC(p.year, p.month - 1, 1)),
      end: new Date(Date.UTC(p.year, p.month, 1)),
    };
  }
  if (p.kind === "quarter") {
    const m0 = (p.quarter - 1) * 3;
    return {
      start: new Date(Date.UTC(p.year, m0, 1)),
      end: new Date(Date.UTC(p.year, m0 + 3, 1)),
    };
  }
  return { start: new Date(Date.UTC(p.year, 0, 1)), end: new Date(Date.UTC(p.year + 1, 0, 1)) };
}

/** Human label for a period, e.g. "July 2026", "Q3 2026", "2026". */
export function periodLabel(p: Period): string {
  if (p.kind === "month") return `${MONTH_NAMES[p.month - 1]} ${p.year}`;
  if (p.kind === "quarter") return `Q${p.quarter} ${p.year}`;
  return `${p.year}`;
}

/** Parse an inclusive "YYYY-MM-DD".."YYYY-MM-DD" pair into a half-open UTC range. */
export function dayRange(startDate: string, endDate: string): DateRange {
  const start = new Date(`${startDate}T00:00:00.000Z`);
  // end is inclusive of the whole end day, so advance one day for the exclusive bound.
  const end = new Date(new Date(`${endDate}T00:00:00.000Z`).getTime() + 86_400_000);
  return { start, end };
}

// ===========================================================================
// Zod query schemas (shared by the CSV route handlers)
// ===========================================================================

const periodFields = {
  period: z.enum(["month", "quarter", "year"]).default("month"),
  year: z.coerce.number().int().min(2000).max(2100),
  month: z.coerce.number().int().min(1).max(12).optional(),
  quarter: z.coerce.number().int().min(1).max(4).optional(),
  userId: z.string().min(1).optional(),
  locationId: z.string().min(1).optional(),
};

function requirePeriodParts<T extends { period: string; month?: number; quarter?: number }>(p: T): T {
  if (p.period === "month" && p.month == null) throw new Error("month is required for a monthly report");
  if (p.period === "quarter" && p.quarter == null) throw new Error("quarter is required for a quarterly report");
  return p;
}

export const financialQuerySchema = z.object(periodFields).transform(requirePeriodParts);

export const operationalQuerySchema = z
  .object({
    ...periodFields,
    // Optional explicit inclusive date range; when both are present they take
    // precedence over the period window.
    start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    end: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  })
  .transform((p) => {
    if (p.start && p.end) return p; // explicit range, period parts not needed
    return requirePeriodParts(p);
  });

export type FinancialQuery = z.infer<typeof financialQuerySchema>;
export type OperationalQuery = z.infer<typeof operationalQuerySchema>;

/** Turn a validated query into a Period. */
export function queryToPeriod(q: {
  period: string;
  year: number;
  month?: number;
  quarter?: number;
}): Period {
  if (q.period === "month") return { kind: "month", year: q.year, month: q.month! };
  if (q.period === "quarter") return { kind: "quarter", year: q.year, quarter: q.quarter! };
  return { kind: "year", year: q.year };
}

// ===========================================================================
// Shared decoration helpers
// ===========================================================================

async function nameMaps(ctx: TenantContext) {
  const db = tenantDb(ctx);
  const [users, locations] = await Promise.all([
    db.user.findMany({ orderBy: { name: "asc" } }),
    db.location.findMany({ orderBy: { name: "asc" } }),
  ]);
  return {
    userName: new Map<string, string>((users as any[]).map((u) => [u.id, u.name])),
    locationName: new Map<string, string>((locations as any[]).map((l) => [l.id, l.name])),
    users: (users as any[]).map((u) => ({ id: u.id, name: u.name })),
    locations: (locations as any[]).map((l) => ({ id: l.id, name: l.name })),
  };
}

/** Filter options for the ADMIN report UI (staff + locations in the tenant). */
export async function getReportFilters(
  ctx: TenantContext,
): Promise<{ users: { id: string; name: string }[]; locations: { id: string; name: string }[] }> {
  const { users, locations } = await nameMaps(ctx);
  return { users, locations };
}

// ===========================================================================
// Financial report (revenue / tax / tips / refunds), by user and by location
// ===========================================================================

export type FinancialRow = {
  key: string; // userId, locationId, or "TOTAL"
  label: string;
  grossRevenueCents: number;
  netRevenueCents: number;
  taxCents: number;
  tipCents: number;
  refundsCents: number;
  paymentCount: number;
};

export type FinancialReport = {
  period: { label: string; startIso: string; endIso: string };
  byUser: FinancialRow[];
  byLocation: FinancialRow[];
  totals: FinancialRow;
};

type GroupSum = {
  _sum: {
    subtotalCents: number | null;
    taxCents: number | null;
    tipCents: number | null;
    refundedCents: number | null;
  };
  _count: { _all: number };
};

function rowFromGroup(key: string, label: string, g: GroupSum): FinancialRow {
  const subtotal = g._sum.subtotalCents ?? 0;
  const tax = g._sum.taxCents ?? 0;
  const tip = g._sum.tipCents ?? 0;
  const refunds = g._sum.refundedCents ?? 0;
  const gross = addCents(subtotal, tax, tip);
  return {
    key,
    label,
    grossRevenueCents: gross,
    netRevenueCents: gross - refunds,
    taxCents: tax,
    tipCents: tip,
    refundsCents: refunds,
    paymentCount: g._count._all,
  };
}

export async function getFinancialReport(
  ctx: TenantContext,
  input: { period: Period; userId?: string; locationId?: string },
): Promise<FinancialReport> {
  const db = tenantDb(ctx);
  const { start, end } = periodRange(input.period);
  const { userName, locationName } = await nameMaps(ctx);

  const where: Record<string, unknown> = {
    ...ownershipWhere(ctx),
    status: { in: ["PAID", "REFUNDED"] },
    createdAt: { gte: start, lt: end },
  };
  if (input.userId) where.userId = input.userId;
  if (input.locationId) where.locationId = input.locationId;

  const [byUserRaw, byLocationRaw] = await Promise.all([
    db.payment.groupBy({
      by: ["userId"],
      where,
      _sum: { subtotalCents: true, taxCents: true, tipCents: true, refundedCents: true },
      _count: { _all: true },
    }),
    db.payment.groupBy({
      by: ["locationId"],
      where,
      _sum: { subtotalCents: true, taxCents: true, tipCents: true, refundedCents: true },
      _count: { _all: true },
    }),
  ]);

  const byUser = (byUserRaw as any[])
    .map((g) => rowFromGroup(g.userId, userName.get(g.userId) ?? "Unknown", g))
    .sort((a, b) => b.netRevenueCents - a.netRevenueCents || a.label.localeCompare(b.label));
  const byLocation = (byLocationRaw as any[])
    .map((g) => rowFromGroup(g.locationId, locationName.get(g.locationId) ?? "Unknown", g))
    .sort((a, b) => b.netRevenueCents - a.netRevenueCents || a.label.localeCompare(b.label));

  // Totals summed from the by-user rows (same underlying rows as by-location).
  const totals: FinancialRow = {
    key: "TOTAL",
    label: "Total",
    grossRevenueCents: sum(byUser.map((r) => r.grossRevenueCents)),
    netRevenueCents: sum(byUser.map((r) => r.netRevenueCents)),
    taxCents: sum(byUser.map((r) => r.taxCents)),
    tipCents: sum(byUser.map((r) => r.tipCents)),
    refundsCents: sum(byUser.map((r) => r.refundsCents)),
    paymentCount: sum(byUser.map((r) => r.paymentCount)),
  };

  return {
    period: {
      label: periodLabel(input.period),
      startIso: start.toISOString(),
      endIso: end.toISOString(),
    },
    byUser,
    byLocation,
    totals,
  };
}

function sum(ns: number[]): number {
  return ns.reduce((a, b) => a + b, 0);
}

// ===========================================================================
// Operational report (volume, no-show rate, top services)
// ===========================================================================

const ALL_STATUSES = ["REQUESTED", "CONFIRMED", "COMPLETED", "CANCELLED", "NO_SHOW"] as const;

export type OperationalReport = {
  range: { startIso: string; endIso: string };
  volume: { status: string; count: number }[]; // always all 5 statuses, in fixed order
  totalAppointments: number;
  noShow: { completed: number; noShow: number; rate: number }; // rate 0..1
  topServicesByCount: { serviceId: string; name: string; count: number }[];
  topServicesByRevenue: { serviceId: string; name: string; revenueCents: number }[];
};

const TOP_N = 10;

export async function getOperationalReport(
  ctx: TenantContext,
  input: { range: DateRange; userId?: string; locationId?: string },
): Promise<OperationalReport> {
  const db = tenantDb(ctx);
  const { start, end } = input.range;

  const apptWhere: Record<string, unknown> = {
    ...ownershipWhere(ctx),
    startsAt: { gte: start, lt: end },
  };
  if (input.userId) apptWhere.userId = input.userId;
  if (input.locationId) apptWhere.locationId = input.locationId;

  const payWhere: Record<string, unknown> = {
    ...ownershipWhere(ctx),
    status: { in: ["PAID", "REFUNDED"] },
    createdAt: { gte: start, lt: end },
  };
  if (input.userId) payWhere.userId = input.userId;
  if (input.locationId) payWhere.locationId = input.locationId;

  const [volumeRaw, byServiceRaw, payments, services] = await Promise.all([
    db.appointment.groupBy({ by: ["status"], where: apptWhere, _count: { _all: true } }),
    db.appointment.groupBy({
      by: ["serviceId"],
      where: { ...apptWhere, status: "COMPLETED" },
      _count: { _all: true },
    }),
    // Service-line revenue lives on PaymentLine, which is not tenant-scoped on
    // its own — read it only through the tenant-scoped Payment parent.
    db.payment.findMany({ where: payWhere, include: { lines: true } }),
    db.service.findMany({}),
  ]);

  const svcName = new Map<string, string>((services as any[]).map((s) => [s.id, s.name]));

  const countByStatus = new Map<string, number>();
  for (const g of volumeRaw as any[]) countByStatus.set(g.status, g._count._all);
  const volume = ALL_STATUSES.map((status) => ({ status, count: countByStatus.get(status) ?? 0 }));
  const totalAppointments = sum(volume.map((v) => v.count));

  const completed = countByStatus.get("COMPLETED") ?? 0;
  const noShow = countByStatus.get("NO_SHOW") ?? 0;
  const denom = completed + noShow;
  const rate = denom === 0 ? 0 : noShow / denom;

  const topServicesByCount = (byServiceRaw as any[])
    .map((g) => ({
      serviceId: g.serviceId,
      name: svcName.get(g.serviceId) ?? "Unknown",
      count: g._count._all,
    }))
    .sort((a, b) => b.count - a.count || a.serviceId.localeCompare(b.serviceId))
    .slice(0, TOP_N);

  // Sum SERVICE-line amounts (unitCents * qty) per service across PAID/REFUNDED
  // payments in the window. Refunds are not line-attributed, so this is gross
  // service revenue (documented).
  const revBySvc = new Map<string, number>();
  for (const p of payments as any[]) {
    for (const line of p.lines as any[]) {
      if (line.kind !== "SERVICE") continue;
      revBySvc.set(line.refId, (revBySvc.get(line.refId) ?? 0) + line.unitCents * line.qty);
    }
  }
  const topServicesByRevenue = [...revBySvc.entries()]
    .map(([serviceId, revenueCents]) => ({
      serviceId,
      name: svcName.get(serviceId) ?? "Unknown",
      revenueCents,
    }))
    .sort((a, b) => b.revenueCents - a.revenueCents || a.serviceId.localeCompare(b.serviceId))
    .slice(0, TOP_N);

  return {
    range: { startIso: start.toISOString(), endIso: end.toISOString() },
    volume,
    totalAppointments,
    noShow: { completed, noShow, rate },
    topServicesByCount,
    topServicesByRevenue,
  };
}

// ===========================================================================
// CSV serialization (single source of truth: the report objects above).
// Money is emitted as decimal dollars (e.g. 12345 cents -> "123.45"); the UI
// keeps using formatCents. Counts and the no-show rate are plain numbers.
// ===========================================================================

/** Integer cents -> a bare decimal-dollars string, e.g. 12345 -> "123.45". */
export function centsToDollars(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, "0")}`;
}

/** Quote a CSV field iff it contains a comma, quote, or newline. */
function csvField(value: string | number): string {
  const s = String(value);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function csvRows(rows: (string | number)[][]): string {
  return rows.map((r) => r.map(csvField).join(",")).join("\r\n") + "\r\n";
}

export function financialReportToCsv(report: FinancialReport): string {
  const header = [
    "dimension",
    "key",
    "label",
    "grossRevenue",
    "netRevenue",
    "tax",
    "tips",
    "refunds",
    "paymentCount",
  ];
  const line = (dim: string, r: FinancialRow): (string | number)[] => [
    dim,
    r.key,
    r.label,
    centsToDollars(r.grossRevenueCents),
    centsToDollars(r.netRevenueCents),
    centsToDollars(r.taxCents),
    centsToDollars(r.tipCents),
    centsToDollars(r.refundsCents),
    r.paymentCount,
  ];
  const rows: (string | number)[][] = [header];
  for (const r of report.byUser) rows.push(line("user", r));
  for (const r of report.byLocation) rows.push(line("location", r));
  rows.push(line("total", report.totals));
  return csvRows(rows);
}

export function operationalReportToCsv(report: OperationalReport): string {
  const rows: (string | number)[][] = [["section", "key", "label", "count", "revenue"]];
  for (const v of report.volume) rows.push(["volume", v.status, v.status, v.count, ""]);
  rows.push(["appointments", "total", "Total appointments", report.totalAppointments, ""]);
  rows.push(["noshow", "completed", "Completed", report.noShow.completed, ""]);
  rows.push(["noshow", "no_show", "No-shows", report.noShow.noShow, ""]);
  rows.push(["noshow", "rate", "No-show rate", report.noShow.rate.toFixed(4), ""]);
  for (const s of report.topServicesByCount) {
    rows.push(["top_service_count", s.serviceId, s.name, s.count, ""]);
  }
  for (const s of report.topServicesByRevenue) {
    rows.push(["top_service_revenue", s.serviceId, s.name, "", centsToDollars(s.revenueCents)]);
  }
  return csvRows(rows);
}
