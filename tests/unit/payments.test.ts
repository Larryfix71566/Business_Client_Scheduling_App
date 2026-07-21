import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomBytes } from "node:crypto";
import { prisma } from "@/lib/db";
import type { TenantContext } from "@/lib/tenant";
import type { SquarePaymentSummary } from "@/lib/square";
import {
  scoreMatch,
  rankCandidates,
  createPayment,
  markPaid,
  confirmMatch,
  MIN_MATCH_SCORE,
} from "@/lib/payments";

// ---------------------------------------------------------------------------
// Pure scoring / ranking (no DB) — the Phase 6 gate's matching function
// ---------------------------------------------------------------------------

const NOW = new Date("2026-07-08T12:00:00Z");

function sq(id: string, amountCents: number, createdAt: Date, refundedCents = 0): SquarePaymentSummary {
  return { id, amountCents, createdAt, refundedCents };
}

function minutesAfter(base: Date, min: number): Date {
  return new Date(base.getTime() + min * 60_000);
}

describe("scoreMatch", () => {
  it("exact amount + near time scores near the maximum", () => {
    const score = scoreMatch({ amountCents: 5000, createdAt: NOW }, sq("a", 5000, minutesAfter(NOW, 1)));
    expect(score).toBeGreaterThan(99);
    expect(score).toBeLessThanOrEqual(100);
  });

  it("a far-off amount is definitively no match (0), regardless of time", () => {
    // $100 off (> $50 tolerance), even at the exact same instant.
    const score = scoreMatch({ amountCents: 5000, createdAt: NOW }, sq("a", 15000, NOW));
    expect(score).toBe(0);
    expect(score).toBeLessThan(MIN_MATCH_SCORE);
  });

  it("a far-off time (exact amount) still scores, but clearly lower than a near time", () => {
    const near = scoreMatch({ amountCents: 5000, createdAt: NOW }, sq("a", 5000, minutesAfter(NOW, 1)));
    const far = scoreMatch(
      { amountCents: 5000, createdAt: NOW },
      sq("a", 5000, minutesAfter(NOW, 40 * 24 * 60)), // 40 days out, beyond the window
    );
    expect(far).toBeGreaterThan(0);
    expect(far).toBeLessThan(near);
  });

  it("amount dominates time: a near-amount/far-time beats a far-amount/near-time", () => {
    const local = { amountCents: 5000, createdAt: NOW };
    const nearAmountFarTime = scoreMatch(local, sq("a", 5100, minutesAfter(NOW, 20 * 24 * 60)));
    const farAmountNearTime = scoreMatch(local, sq("b", 20000, NOW));
    expect(nearAmountFarTime).toBeGreaterThan(farAmountNearTime);
    expect(farAmountNearTime).toBe(0);
  });

  it("is deterministic (same inputs → same score)", () => {
    const local = { amountCents: 8660, createdAt: NOW };
    const cand = sq("a", 8640, minutesAfter(NOW, 5));
    expect(scoreMatch(local, cand)).toBe(scoreMatch(local, cand));
  });
});

describe("rankCandidates", () => {
  const local = { amountCents: 5000, createdAt: NOW };

  it("ranks a close-but-imperfect candidate above a distant one", () => {
    const close = sq("close", 5000, minutesAfter(NOW, 1)); // exact amount, 1 min
    const distant = sq("distant", 5200, minutesAfter(NOW, 21 * 24 * 60)); // $2 off, 3 weeks
    const ranked = rankCandidates(local, [distant, close]);
    expect(ranked.map((r) => r.candidate.id)).toEqual(["close", "distant"]);
    expect(ranked[0].score).toBeGreaterThan(ranked[1].score);
  });

  it("sorts strictly best-first across a mixed set", () => {
    const ranked = rankCandidates(local, [
      sq("far", 30000, NOW), // far amount → 0
      sq("mid", 5300, minutesAfter(NOW, 60)), // $3 off, 1h
      sq("best", 5000, minutesAfter(NOW, 2)), // exact, 2 min
    ]);
    expect(ranked.map((r) => r.candidate.id)).toEqual(["best", "mid", "far"]);
  });

  it("breaks ties deterministically by candidate id (ascending)", () => {
    // Two candidates identical in amount AND time → identical score → id order.
    const b = sq("b", 5000, minutesAfter(NOW, 3));
    const a = sq("a", 5000, minutesAfter(NOW, 3));
    const ranked = rankCandidates(local, [b, a]);
    expect(ranked[0].score).toBe(ranked[1].score);
    expect(ranked.map((r) => r.candidate.id)).toEqual(["a", "b"]);
  });
});

// ---------------------------------------------------------------------------
// Inventory-decrement transaction boundary (DB-backed).
// Gate: creating a Payment does NOT move stock; confirming PAID (cash OR
// Square-match) DOES decrement by the product-line quantity (reusing adjustStock).
// ---------------------------------------------------------------------------

const suffix = randomBytes(4).toString("hex");

let biz: { id: string };
let loc: { id: string };
let user: { id: string };
let customer: { id: string };
let serviceCash: { id: string };
let serviceSquare: { id: string };
let item: { id: string };
let apptCash: { id: string };
let apptSquare: { id: string };
let ctx: TenantContext;

async function makeAppt(serviceId: string): Promise<{ id: string }> {
  return prisma.appointment.create({
    data: {
      businessId: biz.id,
      locationId: loc.id,
      userId: user.id,
      customerId: customer.id,
      serviceId,
      startsAt: new Date(),
      endsAt: new Date(Date.now() + 30 * 60_000),
      status: "COMPLETED",
    },
  });
}

beforeAll(async () => {
  biz = await prisma.business.create({
    data: { slug: `pay-${suffix}`, name: "Pay Biz", taxRateBps: 1000 },
  });
  loc = await prisma.location.create({
    data: { businessId: biz.id, name: "L", address: "x", weeklyHours: {} },
  });
  user = await prisma.user.create({
    data: { businessId: biz.id, role: "USER", email: `u-${suffix}@t.test`, name: "U", passwordHash: "x" },
  });
  await prisma.userLocation.create({ data: { businessId: biz.id, userId: user.id, locationId: loc.id } });
  customer = await prisma.customer.create({
    data: { businessId: biz.id, firstName: "C", lastName: "One", phone: `+1555${suffix}` },
  });
  // User-owned product the user is allowed to adjust; starts at qty 10.
  item = await prisma.inventoryItem.create({
    data: { businessId: biz.id, userId: user.id, name: "Serum", costCents: 100, priceCents: 3000, qtyOnHand: 10, lowStockAt: 1 },
  });
  serviceCash = await prisma.service.create({
    data: { businessId: biz.id, userId: user.id, name: "Cash Svc", durationMin: 30, priceCents: 5000 },
  });
  serviceSquare = await prisma.service.create({
    data: { businessId: biz.id, userId: user.id, name: "Square Svc", durationMin: 30, priceCents: 5000 },
  });
  // Each service consumes 2 units of the item (BOM).
  await prisma.serviceProduct.create({
    data: { businessId: biz.id, serviceId: serviceCash.id, itemId: item.id, qty: 2 },
  });
  await prisma.serviceProduct.create({
    data: { businessId: biz.id, serviceId: serviceSquare.id, itemId: item.id, qty: 2 },
  });
  apptCash = await makeAppt(serviceCash.id);
  apptSquare = await makeAppt(serviceSquare.id);

  ctx = { businessId: biz.id, userId: user.id, role: "USER" };
});

afterAll(async () => {
  await prisma.paymentLine.deleteMany({ where: { payment: { businessId: biz.id } } });
  await prisma.payment.deleteMany({ where: { businessId: biz.id } });
  await prisma.appointment.deleteMany({ where: { businessId: biz.id } });
  await prisma.stockAdjustment.deleteMany({ where: { businessId: biz.id } });
  await prisma.serviceProduct.deleteMany({ where: { businessId: biz.id } });
  await prisma.inventoryItem.deleteMany({ where: { businessId: biz.id } });
  await prisma.service.deleteMany({ where: { businessId: biz.id } });
  await prisma.customer.deleteMany({ where: { businessId: biz.id } });
  await prisma.userLocation.deleteMany({ where: { businessId: biz.id } });
  await prisma.user.deleteMany({ where: { businessId: biz.id } });
  await prisma.location.deleteMany({ where: { businessId: biz.id } });
  await prisma.business.deleteMany({ where: { id: biz.id } });
  await prisma.$disconnect();
});

describe("payment bookkeeping + inventory boundary", () => {
  it("createPayment records lines and computes tax, but does NOT move stock", async () => {
    const before = await prisma.inventoryItem.findUnique({ where: { id: item.id } });
    const res = await createPayment(ctx, { appointmentId: apptCash.id, method: "CASH", tipCents: 100 });

    // subtotal = service 5000 + 2 * 3000 product = 11000; tax 10% = 1100; +tip 100 = 12200.
    expect(res.totalCents).toBe(12200);
    expect(res.status).toBe("UNMATCHED");

    const payment = await prisma.payment.findUnique({ where: { id: res.id }, include: { lines: true } });
    expect(payment?.subtotalCents).toBe(11000);
    expect(payment?.taxCents).toBe(1100);
    expect(payment?.lines.some((l) => l.kind === "PRODUCT" && l.refId === item.id && l.qty === 2)).toBe(true);

    // Stock untouched on creation.
    const after = await prisma.inventoryItem.findUnique({ where: { id: item.id } });
    expect(after?.qtyOnHand).toBe(before?.qtyOnHand);
    expect(after?.qtyOnHand).toBe(10);
  });

  it("markPaid (cash) decrements inventory by the product-line quantity", async () => {
    const payment = await prisma.payment.findFirst({ where: { appointmentId: apptCash.id } });
    const res = await markPaid(ctx, { paymentId: payment!.id });
    expect(res.status).toBe("PAID");

    const after = await prisma.inventoryItem.findUnique({ where: { id: item.id } });
    expect(after?.qtyOnHand).toBe(8); // 10 - 2

    // A SOLD StockAdjustment was written (reuses adjustStock).
    const adj = await prisma.stockAdjustment.findFirst({
      where: { itemId: item.id, reason: "SOLD", delta: -2 },
    });
    expect(adj).toBeTruthy();
  });

  it("markPaid is idempotent-guarded: a second call fails, stock unchanged", async () => {
    const payment = await prisma.payment.findFirst({ where: { appointmentId: apptCash.id } });
    await expect(markPaid(ctx, { paymentId: payment!.id })).rejects.toThrow();
    const after = await prisma.inventoryItem.findUnique({ where: { id: item.id } });
    expect(after?.qtyOnHand).toBe(8);
  });

  it("confirmMatch (Square) also decrements only at confirm time", async () => {
    const create = await createPayment(ctx, { appointmentId: apptSquare.id, method: "SQUARE", tipCents: 0 });
    // Still no movement after creating the Square payment.
    let cur = await prisma.inventoryItem.findUnique({ where: { id: item.id } });
    expect(cur?.qtyOnHand).toBe(8);

    const res = await confirmMatch(ctx, { paymentId: create.id, squarePaymentId: "sq_test_123" });
    expect(res.status).toBe("PAID");
    expect(res.squarePaymentId).toBe("sq_test_123");

    cur = await prisma.inventoryItem.findUnique({ where: { id: item.id } });
    expect(cur?.qtyOnHand).toBe(6); // 8 - 2

    const linked = await prisma.payment.findUnique({ where: { id: create.id } });
    expect(linked?.squarePaymentId).toBe("sq_test_123");
  });

  it("a cash/other payment cannot be confirm-matched to Square", async () => {
    const appt = await makeAppt(serviceCash.id);
    const p = await createPayment(ctx, { appointmentId: appt.id, method: "CASH", tipCents: 0 });
    await expect(confirmMatch(ctx, { paymentId: p.id, squarePaymentId: "sq_x" })).rejects.toThrow();
  });
});
