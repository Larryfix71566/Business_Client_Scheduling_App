import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomBytes } from "node:crypto";
import { prisma } from "@/lib/db";
import type { TenantContext } from "@/lib/tenant";
import {
  periodRange,
  periodLabel,
  centsToDollars,
  financialReportToCsv,
  getFinancialReport,
  getOperationalReport,
} from "@/lib/reports";

// ---------------------------------------------------------------------------
// Pure helpers (no DB)
// ---------------------------------------------------------------------------

describe("periodRange / periodLabel (pure, UTC boundaries)", () => {
  it("month is a half-open UTC calendar month", () => {
    const { start, end } = periodRange({ kind: "month", year: 2026, month: 7 });
    expect(start.toISOString()).toBe("2026-07-01T00:00:00.000Z");
    expect(end.toISOString()).toBe("2026-08-01T00:00:00.000Z");
    expect(periodLabel({ kind: "month", year: 2026, month: 7 })).toBe("July 2026");
  });

  it("quarter Q3 spans Jul-Sep; year spans the whole year", () => {
    const q = periodRange({ kind: "quarter", year: 2026, quarter: 3 });
    expect(q.start.toISOString()).toBe("2026-07-01T00:00:00.000Z");
    expect(q.end.toISOString()).toBe("2026-10-01T00:00:00.000Z");
    const y = periodRange({ kind: "year", year: 2026 });
    expect(y.start.toISOString()).toBe("2026-01-01T00:00:00.000Z");
    expect(y.end.toISOString()).toBe("2027-01-01T00:00:00.000Z");
    expect(periodLabel({ kind: "quarter", year: 2026, quarter: 3 })).toBe("Q3 2026");
  });

  it("centsToDollars renders integer cents as decimal dollars", () => {
    expect(centsToDollars(12345)).toBe("123.45");
    expect(centsToDollars(5)).toBe("0.05");
    expect(centsToDollars(0)).toBe("0.00");
    expect(centsToDollars(-500)).toBe("-5.00");
  });
});

// ---------------------------------------------------------------------------
// DB-backed aggregation against deterministic fixtures with KNOWN totals.
// A fresh throwaway business is created so the test is independent of the seed.
// ---------------------------------------------------------------------------

const suffix = randomBytes(4).toString("hex");

let biz: { id: string };
let loc1: { id: string };
let loc2: { id: string };
let userA: { id: string };
let userB: { id: string };
let customer: { id: string };
let svcX: { id: string };
let svcY: { id: string };
let svcZ: { id: string };

let adminCtx: TenantContext;
let userBCtx: TenantContext;

const JUL = (d: number) => new Date(Date.UTC(2026, 6, d, 12, 0, 0)); // July 2026
const AUG = (d: number) => new Date(Date.UTC(2026, 7, d, 12, 0, 0));
const SEP = (d: number) => new Date(Date.UTC(2026, 8, d, 12, 0, 0));
const JUN = (d: number) => new Date(Date.UTC(2026, 5, d, 12, 0, 0)); // Q2, excluded from Q3

type PayArgs = {
  userId: string;
  locationId: string;
  serviceId: string;
  subtotalCents: number;
  taxCents: number;
  tipCents: number;
  status: "UNMATCHED" | "PAID" | "REFUNDED";
  refundedCents?: number;
  createdAt: Date;
};

async function makePayment(a: PayArgs) {
  return prisma.payment.create({
    data: {
      businessId: biz.id,
      customerId: customer.id,
      userId: a.userId,
      locationId: a.locationId,
      subtotalCents: a.subtotalCents,
      taxCents: a.taxCents,
      tipCents: a.tipCents,
      refundedCents: a.refundedCents ?? 0,
      method: "SQUARE",
      status: a.status,
      createdAt: a.createdAt,
      // One SERVICE line (unit = subtotal) so top-services-by-revenue is
      // consistent with the financial subtotals.
      lines: { create: [{ kind: "SERVICE", refId: a.serviceId, qty: 1, unitCents: a.subtotalCents }] },
    },
  });
}

async function makeAppt(
  userId: string,
  serviceId: string,
  status: "REQUESTED" | "CONFIRMED" | "COMPLETED" | "CANCELLED" | "NO_SHOW",
  startsAt: Date,
  locationId: string,
) {
  return prisma.appointment.create({
    data: {
      businessId: biz.id,
      locationId,
      userId,
      customerId: customer.id,
      serviceId,
      startsAt,
      endsAt: new Date(startsAt.getTime() + 30 * 60_000),
      status,
    },
  });
}

beforeAll(async () => {
  biz = await prisma.business.create({ data: { slug: `rep-${suffix}`, name: "Rep Biz", taxRateBps: 800 } });
  loc1 = await prisma.location.create({ data: { businessId: biz.id, name: "Loc One", address: "x", weeklyHours: {} } });
  loc2 = await prisma.location.create({ data: { businessId: biz.id, name: "Loc Two", address: "y", weeklyHours: {} } });
  userA = await prisma.user.create({
    data: { businessId: biz.id, role: "USER", email: `a-${suffix}@t.test`, name: "Anna A", passwordHash: "x" },
  });
  userB = await prisma.user.create({
    data: { businessId: biz.id, role: "USER", email: `b-${suffix}@t.test`, name: "Bob B", passwordHash: "x" },
  });
  customer = await prisma.customer.create({
    data: { businessId: biz.id, firstName: "C", lastName: "One", phone: `+1777${suffix}` },
  });
  svcX = await prisma.service.create({
    data: { businessId: biz.id, userId: userA.id, name: "Service X", durationMin: 30, priceCents: 6000 },
  });
  svcY = await prisma.service.create({
    data: { businessId: biz.id, userId: userA.id, name: "Service Y", durationMin: 30, priceCents: 5000 },
  });
  svcZ = await prisma.service.create({
    data: { businessId: biz.id, userId: userB.id, name: "Service Z", durationMin: 30, priceCents: 3000 },
  });

  // ---- Payments -----------------------------------------------------------
  // July 2026
  await makePayment({ userId: userA.id, locationId: loc1.id, serviceId: svcX.id, subtotalCents: 6000, taxCents: 800, tipCents: 200, status: "PAID", createdAt: JUL(3) });
  await makePayment({ userId: userA.id, locationId: loc2.id, serviceId: svcY.id, subtotalCents: 5000, taxCents: 400, tipCents: 0, status: "PAID", createdAt: JUL(5) });
  await makePayment({ userId: userB.id, locationId: loc1.id, serviceId: svcZ.id, subtotalCents: 3000, taxCents: 240, tipCents: 60, status: "PAID", createdAt: JUL(7) });
  await makePayment({ userId: userA.id, locationId: loc1.id, serviceId: svcX.id, subtotalCents: 6000, taxCents: 160, tipCents: 0, status: "REFUNDED", refundedCents: 500, createdAt: JUL(9) });
  // UNMATCHED — must be excluded from every financial measure.
  await makePayment({ userId: userA.id, locationId: loc1.id, serviceId: svcX.id, subtotalCents: 9999, taxCents: 999, tipCents: 999, status: "UNMATCHED", createdAt: JUL(11) });
  // August + September (same quarter Q3)
  await makePayment({ userId: userB.id, locationId: loc2.id, serviceId: svcZ.id, subtotalCents: 4000, taxCents: 320, tipCents: 40, status: "PAID", createdAt: AUG(4) });
  await makePayment({ userId: userA.id, locationId: loc1.id, serviceId: svcX.id, subtotalCents: 1000, taxCents: 80, tipCents: 10, status: "PAID", createdAt: SEP(6) });
  // June (Q2) — must NOT count in Q3 or July.
  await makePayment({ userId: userA.id, locationId: loc1.id, serviceId: svcX.id, subtotalCents: 7777, taxCents: 0, tipCents: 0, status: "PAID", createdAt: JUN(20) });

  // ---- Appointments (July 2026) ------------------------------------------
  await makeAppt(userA.id, svcX.id, "COMPLETED", JUL(2), loc1.id);
  await makeAppt(userA.id, svcX.id, "COMPLETED", JUL(3), loc1.id);
  await makeAppt(userA.id, svcY.id, "COMPLETED", JUL(4), loc2.id);
  await makeAppt(userA.id, svcX.id, "NO_SHOW", JUL(5), loc1.id);
  await makeAppt(userA.id, svcX.id, "CANCELLED", JUL(6), loc1.id);
  await makeAppt(userA.id, svcY.id, "CONFIRMED", JUL(20), loc2.id);
  await makeAppt(userB.id, svcZ.id, "COMPLETED", JUL(8), loc1.id);
  await makeAppt(userB.id, svcZ.id, "NO_SHOW", JUL(9), loc1.id);

  adminCtx = { businessId: biz.id, userId: userA.id, role: "ADMIN" };
  userBCtx = { businessId: biz.id, userId: userB.id, role: "USER" };
});

afterAll(async () => {
  await prisma.paymentLine.deleteMany({ where: { payment: { businessId: biz.id } } });
  await prisma.payment.deleteMany({ where: { businessId: biz.id } });
  await prisma.appointment.deleteMany({ where: { businessId: biz.id } });
  await prisma.service.deleteMany({ where: { businessId: biz.id } });
  await prisma.customer.deleteMany({ where: { businessId: biz.id } });
  await prisma.user.deleteMany({ where: { businessId: biz.id } });
  await prisma.location.deleteMany({ where: { businessId: biz.id } });
  await prisma.business.deleteMany({ where: { id: biz.id } });
  await prisma.$disconnect();
});

function rowByKey<T extends { key: string }>(rows: T[], key: string): T | undefined {
  return rows.find((r) => r.key === key);
}

describe("financial report — monthly, by user and by location", () => {
  it("groups July revenue/tax/tip/refunds by user with exact cents (refunds subtracted)", async () => {
    const rep = await getFinancialReport(adminCtx, { period: { kind: "month", year: 2026, month: 7 } });

    const a = rowByKey(rep.byUser, userA.id)!;
    // P1(6000/800/200) + P2(5000/400/0) + P4(6000/160/0, refund 500). UNMATCHED excluded.
    expect(a.grossRevenueCents).toBe(18560); // (6000+800+200)+(5000+400)+(6000+160)
    expect(a.netRevenueCents).toBe(18060); // gross - 500 refund
    expect(a.taxCents).toBe(1360);
    expect(a.tipCents).toBe(200);
    expect(a.refundsCents).toBe(500);
    expect(a.paymentCount).toBe(3);

    const b = rowByKey(rep.byUser, userB.id)!;
    expect(b.grossRevenueCents).toBe(3300);
    expect(b.netRevenueCents).toBe(3300);
    expect(b.taxCents).toBe(240);
    expect(b.paymentCount).toBe(1);
  });

  it("groups July revenue by location with exact cents", async () => {
    const rep = await getFinancialReport(adminCtx, { period: { kind: "month", year: 2026, month: 7 } });

    const l1 = rowByKey(rep.byLocation, loc1.id)!;
    expect(l1.grossRevenueCents).toBe(16460); // P1 7000 + P3 3300 + P4 6160
    expect(l1.netRevenueCents).toBe(15960); // - 500
    expect(l1.taxCents).toBe(1200);
    expect(l1.paymentCount).toBe(3);

    const l2 = rowByKey(rep.byLocation, loc2.id)!;
    expect(l2.grossRevenueCents).toBe(5400); // P2 only
    expect(l2.netRevenueCents).toBe(5400);
  });

  it("totals match across both dimensions", async () => {
    const rep = await getFinancialReport(adminCtx, { period: { kind: "month", year: 2026, month: 7 } });
    expect(rep.totals.grossRevenueCents).toBe(21860);
    expect(rep.totals.netRevenueCents).toBe(21360);
    expect(rep.totals.taxCents).toBe(1600);
    expect(rep.totals.tipCents).toBe(260);
    expect(rep.totals.refundsCents).toBe(500);
    expect(rep.totals.paymentCount).toBe(4);
    // by-user sum == by-location sum == totals
    const uNet = rep.byUser.reduce((s, r) => s + r.netRevenueCents, 0);
    const lNet = rep.byLocation.reduce((s, r) => s + r.netRevenueCents, 0);
    expect(uNet).toBe(21360);
    expect(lNet).toBe(21360);
  });
});

describe("quarter / year rollup consistency", () => {
  it("Q3 total == July + August + September monthly totals (sum of months = quarter)", async () => {
    const [jul, aug, sep, q3] = await Promise.all([
      getFinancialReport(adminCtx, { period: { kind: "month", year: 2026, month: 7 } }),
      getFinancialReport(adminCtx, { period: { kind: "month", year: 2026, month: 8 } }),
      getFinancialReport(adminCtx, { period: { kind: "month", year: 2026, month: 9 } }),
      getFinancialReport(adminCtx, { period: { kind: "quarter", year: 2026, quarter: 3 } }),
    ]);
    const monthsNet = jul.totals.netRevenueCents + aug.totals.netRevenueCents + sep.totals.netRevenueCents;
    const monthsTax = jul.totals.taxCents + aug.totals.taxCents + sep.totals.taxCents;
    expect(q3.totals.netRevenueCents).toBe(monthsNet);
    expect(q3.totals.taxCents).toBe(monthsTax);
    // Hardcoded known values (June Q2 payment excluded).
    expect(q3.totals.netRevenueCents).toBe(26810); // 21360 + 4360 + 1090
    expect(q3.totals.grossRevenueCents).toBe(27310);
    expect(q3.totals.taxCents).toBe(2000);
    expect(q3.totals.paymentCount).toBe(6);
  });

  it("year rollup includes the June (Q2) payment that the quarter excludes", async () => {
    const year = await getFinancialReport(adminCtx, { period: { kind: "year", year: 2026 } });
    // Q3 net 26810 + June gross/net 7777 = 34587.
    expect(year.totals.netRevenueCents).toBe(34587);
    expect(year.totals.paymentCount).toBe(7);
  });
});

describe("USER-role scoping (guardrail #2)", () => {
  it("a USER's financial report contains only their own payments — never another user's", async () => {
    const rep = await getFinancialReport(userBCtx, { period: { kind: "month", year: 2026, month: 7 } });
    // Only Bob's single July payment.
    expect(rep.byUser).toHaveLength(1);
    expect(rep.byUser[0].key).toBe(userB.id);
    expect(rowByKey(rep.byUser, userA.id)).toBeUndefined();
    expect(rep.totals.netRevenueCents).toBe(3300);
    // Anna's amounts (18060) must not leak in.
    expect(rep.totals.netRevenueCents).not.toBe(21360);
  });

  it("a USER's operational report excludes another user's appointments and services", async () => {
    const rep = await getOperationalReport(userBCtx, {
      range: periodRange({ kind: "month", year: 2026, month: 7 }),
    });
    // Bob: 1 COMPLETED + 1 NO_SHOW only.
    expect(rep.noShow.completed).toBe(1);
    expect(rep.noShow.noShow).toBe(1);
    expect(rep.noShow.rate).toBeCloseTo(0.5, 10);
    expect(rep.topServicesByCount.map((s) => s.serviceId)).toEqual([svcZ.id]);
    // Anna's services must not appear.
    const ids = new Set(rep.topServicesByRevenue.map((s) => s.serviceId));
    expect(ids.has(svcX.id)).toBe(false);
    expect(ids.has(svcY.id)).toBe(false);
    expect(ids.has(svcZ.id)).toBe(true);
  });
});

describe("operational report — volume, no-show rate, top services (ADMIN)", () => {
  it("counts appointment volume by status across the business", async () => {
    const rep = await getOperationalReport(adminCtx, {
      range: periodRange({ kind: "month", year: 2026, month: 7 }),
    });
    const byStatus = Object.fromEntries(rep.volume.map((v) => [v.status, v.count]));
    expect(byStatus.COMPLETED).toBe(4);
    expect(byStatus.NO_SHOW).toBe(2);
    expect(byStatus.CANCELLED).toBe(1);
    expect(byStatus.CONFIRMED).toBe(1);
    expect(byStatus.REQUESTED).toBe(0);
    expect(rep.totalAppointments).toBe(8);
  });

  it("no-show rate = NO_SHOW / (COMPLETED + NO_SHOW), excluding cancelled/upcoming", async () => {
    const rep = await getOperationalReport(adminCtx, {
      range: periodRange({ kind: "month", year: 2026, month: 7 }),
    });
    expect(rep.noShow.completed).toBe(4);
    expect(rep.noShow.noShow).toBe(2);
    expect(rep.noShow.rate).toBeCloseTo(2 / 6, 10);
  });

  it("orders top services by completed count and by revenue, best-first", async () => {
    const rep = await getOperationalReport(adminCtx, {
      range: periodRange({ kind: "month", year: 2026, month: 7 }),
    });
    // Completed: X=2, Y=1, Z=1 → X first; Y/Z tie broken by serviceId asc.
    expect(rep.topServicesByCount[0]).toMatchObject({ serviceId: svcX.id, count: 2 });
    const tail = rep.topServicesByCount.slice(1).map((s) => s.serviceId).sort();
    expect(tail).toEqual([svcY.id, svcZ.id].sort());

    // Revenue (SERVICE lines, PAID+REFUNDED July): X 12000, Y 5000, Z 3000.
    expect(rep.topServicesByRevenue.map((s) => [s.serviceId, s.revenueCents])).toEqual([
      [svcX.id, 12000],
      [svcY.id, 5000],
      [svcZ.id, 3000],
    ]);
  });
});

describe("CSV serialization", () => {
  it("emits a header row + data rows with money as decimal dollars", async () => {
    const rep = await getFinancialReport(adminCtx, { period: { kind: "month", year: 2026, month: 7 } });
    const csv = financialReportToCsv(rep);
    const lines = csv.trim().split("\r\n");
    expect(lines[0]).toBe("dimension,key,label,grossRevenue,netRevenue,tax,tips,refunds,paymentCount");
    expect(lines.length).toBeGreaterThan(1);
    // The total row carries net revenue 21360 cents -> "213.60".
    const total = lines.find((l) => l.startsWith("total,"));
    expect(total).toContain("213.60");
  });
});
