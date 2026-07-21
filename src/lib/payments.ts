import { z } from "zod";
import { prisma } from "./db";
import { tenantDb, ownershipWhere, type TenantContext } from "./tenant";
import { applyTaxBps, addCents, formatCents } from "./money";
import { adjustStock } from "./inventory";
import { listRecentPayments, getPayment, type SquarePaymentSummary } from "./square";

/**
 * payments.ts — local payment bookkeeping + Square reconciliation (Phase 6).
 *
 * CORRELATE-ONLY, NOT A CHECKOUT. This app never charges a card, never creates a
 * Square Order/Payment Link, and never issues a refund. Staff keep taking money
 * through Square as they already do; here we only:
 *   1. record what's owed for a COMPLETED appointment as a local Payment
 *      (service price + consumed products + tax + tip), status = UNMATCHED;
 *   2. let staff mark a CASH/OTHER payment PAID directly, or confirm-match a
 *      SQUARE payment to a real Square payment id read via square.ts;
 *   3. reflect a refund observed in Square.
 *
 * Inventory decrements happen ONLY at the moment a Payment is confirmed PAID
 * (via `markPaid` for cash/other, or `confirmMatch` for Square) — never at
 * Payment creation, since "paid" is only known once confirmed. Decrements reuse
 * `adjustStock` (Phase 5) so the StockAdjustment row + qtyOnHand update stay
 * atomic and permission-checked.
 *
 * All tenant access is via `tenantDb`/`ownershipWhere`. PaymentLine has no
 * `businessId` of its own (it is not in TENANT_MODELS); it is created and read
 * ONLY through the tenant-scoped Payment parent (nested writes / `include`), so
 * it can never leak across the tenant boundary.
 */

// ---------------------------------------------------------------------------
// Pure, DB-free matching/scoring (unit-tested)
// ---------------------------------------------------------------------------

export type LocalPaymentRef = { amountCents: number; createdAt: Date };

/** Amount difference beyond which a candidate is considered unrelated (no match). */
export const AMOUNT_TOLERANCE_CENTS = 5000; // $50
/** Time difference beyond which the time signal contributes nothing. */
export const TIME_TOLERANCE_MIN = 30 * 24 * 60; // 30 days
/** Suggestions below this score are treated as "no match" and hidden. */
export const MIN_MATCH_SCORE = 1;

/**
 * Score how well a Square payment matches a local payment. Higher = better.
 *
 * Amount is the dominant, hard gate: a far-off amount scores 0 no matter how
 * close in time (you never want to link a clearly different amount). Time only
 * MODULATES a plausible-amount match between 0.5x (far in time) and 1.0x (same
 * instant), so amount is weighted heavily and time strictly secondarily. Pure
 * and deterministic — no DB, no `Date.now()`; both timestamps are passed in.
 *
 *   score = 100 · amountScore · (0.5 + 0.5 · timeScore)
 *
 *   amountScore = max(0, 1 − |Δcents| / AMOUNT_TOLERANCE_CENTS)   (exact → 1)
 *   timeScore   = max(0, 1 − |Δminutes| / TIME_TOLERANCE_MIN)     (same instant → 1)
 */
export function scoreMatch(local: LocalPaymentRef, candidate: SquarePaymentSummary): number {
  const amountDiff = Math.abs(local.amountCents - candidate.amountCents);
  const amountScore = Math.max(0, 1 - amountDiff / AMOUNT_TOLERANCE_CENTS);
  if (amountScore === 0) return 0; // far amount → definitively no match

  const diffMin = Math.abs(local.createdAt.getTime() - candidate.createdAt.getTime()) / 60_000;
  const timeScore = Math.max(0, 1 - diffMin / TIME_TOLERANCE_MIN);

  return 100 * amountScore * (0.5 + 0.5 * timeScore);
}

export type RankedCandidate = { candidate: SquarePaymentSummary; score: number };

/**
 * Rank Square candidates for one local payment, best first. Deterministic:
 * ties (identical score) break by candidate id ascending, so ordering is stable
 * regardless of input order.
 */
export function rankCandidates(
  local: LocalPaymentRef,
  candidates: SquarePaymentSummary[],
): RankedCandidate[] {
  return candidates
    .map((candidate) => ({ candidate, score: scoreMatch(local, candidate) }))
    .sort((a, b) => (b.score - a.score) || a.candidate.id.localeCompare(b.candidate.id));
}

// ---------------------------------------------------------------------------
// Zod schemas
// ---------------------------------------------------------------------------

export const createPaymentSchema = z.object({
  appointmentId: z.string().min(1),
  method: z.enum(["SQUARE", "CASH", "OTHER"]),
  tipCents: z.number().int().nonnegative().default(0),
  // Optional extra retail products sold alongside the service (each decrements
  // stock on PAID, like the service's consumed products).
  products: z
    .array(z.object({ itemId: z.string().min(1), qty: z.number().int().positive() }))
    .max(50)
    .optional(),
});

export const paymentIdSchema = z.object({ paymentId: z.string().min(1) });

export const confirmMatchSchema = z.object({
  paymentId: z.string().min(1),
  squarePaymentId: z.string().min(1),
});

export const refundSchema = z.object({
  paymentId: z.string().min(1),
  refundedCents: z.number().int().positive(),
});

// ---------------------------------------------------------------------------
// Create a local Payment for a COMPLETED appointment (no inventory effect yet)
// ---------------------------------------------------------------------------

type LineDraft = { kind: "SERVICE" | "PRODUCT"; refId: string; qty: number; unitCents: number };

/**
 * Record what's owed for a COMPLETED appointment as a local Payment (UNMATCHED).
 * Lines: one SERVICE line at the service price, plus one PRODUCT line per
 * consumed product (from the service's `ServiceProduct` BOM) and per extra
 * retail product. Subtotal = Σ lines; tax via `applyTaxBps` on the subtotal;
 * total owed = subtotal + tax + tip. NO inventory is touched here.
 */
export async function createPayment(ctx: TenantContext, input: unknown) {
  const { appointmentId, method, tipCents, products } = createPaymentSchema.parse(input);
  const db = tenantDb(ctx);

  const appt = await db.appointment.findFirst({
    where: { id: appointmentId, ...ownershipWhere(ctx) },
  });
  if (!appt) throw new Error("Unknown appointment");
  if (appt.status !== "COMPLETED") {
    throw new Error("Only a completed appointment can be recorded for payment");
  }

  const existing = await db.payment.findFirst({ where: { appointmentId } });
  if (existing) throw new Error("A payment already exists for this appointment");

  const service = await db.service.findFirst({ where: { id: appt.serviceId } });
  if (!service) throw new Error("Unknown service");

  const business = await prisma.business.findUnique({ where: { id: ctx.businessId } });
  const taxRateBps = business?.taxRateBps ?? 0;

  // Consumed products from the service BOM + any extra retail products.
  const bom = await db.serviceProduct.findMany({ where: { serviceId: service.id } });
  const wanted = new Map<string, number>();
  for (const b of bom as any[]) wanted.set(b.itemId, (wanted.get(b.itemId) ?? 0) + b.qty);
  for (const p of products ?? []) wanted.set(p.itemId, (wanted.get(p.itemId) ?? 0) + p.qty);

  const lines: LineDraft[] = [
    { kind: "SERVICE", refId: service.id, qty: 1, unitCents: service.priceCents },
  ];
  if (wanted.size) {
    const items = await db.inventoryItem.findMany({
      where: { id: { in: [...wanted.keys()] } },
    });
    const priceById = new Map<string, number>(items.map((i: any) => [i.id, i.priceCents]));
    for (const [itemId, qty] of wanted) {
      if (!priceById.has(itemId)) throw new Error("Unknown product in payment");
      lines.push({ kind: "PRODUCT", refId: itemId, qty, unitCents: priceById.get(itemId)! });
    }
  }

  const subtotalCents = addCents(...lines.map((l) => l.unitCents * l.qty));
  const taxCents = applyTaxBps(subtotalCents, taxRateBps);

  // Nested create keeps PaymentLine access inside the tenant-scoped Payment.
  const payment = await db.payment.create({
    data: {
      appointmentId,
      customerId: appt.customerId,
      userId: appt.userId,
      locationId: appt.locationId,
      subtotalCents,
      taxCents,
      tipCents,
      method,
      status: "UNMATCHED",
      lines: {
        create: lines.map((l) => ({
          kind: l.kind,
          refId: l.refId,
          qty: l.qty,
          unitCents: l.unitCents,
        })),
      },
    },
    include: { lines: true },
  });

  return {
    id: payment.id,
    status: payment.status,
    method: payment.method,
    totalCents: totalCents(payment),
  };
}

/** Total owed for a payment record: subtotal + tax + tip. */
export function totalCents(p: {
  subtotalCents: number;
  taxCents: number;
  tipCents: number;
}): number {
  return addCents(p.subtotalCents, p.taxCents, p.tipCents);
}

// ---------------------------------------------------------------------------
// Confirm PAID → decrement inventory (the ONLY point stock moves)
// ---------------------------------------------------------------------------

/**
 * Decrement inventory for every PRODUCT line of a payment, reusing Phase 5's
 * `adjustStock` (atomic StockAdjustment + qtyOnHand, permission-checked). Called
 * exactly once, when a Payment transitions UNMATCHED → PAID.
 */
async function decrementInventoryForPayment(
  ctx: TenantContext,
  lines: { kind: string; refId: string; qty: number }[],
): Promise<void> {
  for (const line of lines) {
    if (line.kind !== "PRODUCT") continue;
    await adjustStock(ctx, { itemId: line.refId, delta: -line.qty, reason: "SOLD" });
  }
}

/**
 * Mark a CASH/OTHER payment PAID directly (no Square link). Triggers the
 * inventory decrement. SQUARE payments must instead go through `confirmMatch`.
 */
export async function markPaid(ctx: TenantContext, input: unknown) {
  const { paymentId } = paymentIdSchema.parse(input);
  const db = tenantDb(ctx);

  const payment = await loadOwnPayment(ctx, paymentId);
  if (payment.method === "SQUARE") {
    throw new Error("Square payments must be matched to a Square payment id");
  }
  if (payment.status !== "UNMATCHED") throw new Error("Payment is not open");

  // Decrement stock first; only flip to PAID if every decrement succeeds so a
  // failure leaves the record open (UNMATCHED) rather than paid-but-unadjusted.
  await decrementInventoryForPayment(ctx, payment.lines);
  await db.payment.update({ where: { id: paymentId }, data: { status: "PAID" } });

  return { id: paymentId, status: "PAID" as const };
}

/**
 * Confirm-match a SQUARE payment to a real Square payment id (from the reconcile
 * view). Stores `squarePaymentId`, sets status PAID, and triggers the inventory
 * decrement. Never auto-linked — staff explicitly confirm.
 */
export async function confirmMatch(ctx: TenantContext, input: unknown) {
  const { paymentId, squarePaymentId } = confirmMatchSchema.parse(input);
  const db = tenantDb(ctx);

  const payment = await loadOwnPayment(ctx, paymentId);
  if (payment.method !== "SQUARE") throw new Error("Only Square payments are matched");
  if (payment.status !== "UNMATCHED") throw new Error("Payment is not open");

  // Guard against linking the same Square payment to two local records.
  const clash = await db.payment.findFirst({ where: { squarePaymentId } });
  if (clash) throw new Error("That Square payment is already linked");

  await decrementInventoryForPayment(ctx, payment.lines);
  await db.payment.update({
    where: { id: paymentId },
    data: { status: "PAID", squarePaymentId },
  });

  return { id: paymentId, status: "PAID" as const, squarePaymentId };
}

/**
 * Reflect a refund observed in Square (the app never issues refunds). Records
 * `refundedCents` and sets status REFUNDED. Inventory is NOT restocked
 * automatically — returns/restocks are a separate manual stock adjustment.
 */
export async function recordRefund(ctx: TenantContext, input: unknown) {
  const { paymentId, refundedCents } = refundSchema.parse(input);
  const db = tenantDb(ctx);

  const payment = await loadOwnPayment(ctx, paymentId);
  await db.payment.update({
    where: { id: paymentId },
    data: { refundedCents, status: "REFUNDED" },
  });
  return { id: paymentId, status: "REFUNDED" as const, refundedCents };
}

/** Load a payment the session may act on (ownership-scoped), with its lines. */
async function loadOwnPayment(ctx: TenantContext, paymentId: string) {
  const db = tenantDb(ctx);
  const payment = await db.payment.findFirst({
    where: { id: paymentId, ...ownershipWhere(ctx) },
    include: { lines: true },
  });
  if (!payment) throw new Error("Unknown payment");
  return payment as typeof payment & {
    method: string;
    status: string;
    lines: { kind: string; refId: string; qty: number }[];
  };
}

// ---------------------------------------------------------------------------
// Reads for calendar payment panel + reconcile view
// ---------------------------------------------------------------------------

export type PaymentInfo = {
  id: string;
  status: string;
  method: string;
  squarePaymentId: string | null;
  totalLabel: string;
  totalCents: number;
  refundedCents: number;
};

function toPaymentInfo(p: any): PaymentInfo {
  return {
    id: p.id,
    status: p.status,
    method: p.method,
    squarePaymentId: p.squarePaymentId ?? null,
    totalCents: totalCents(p),
    totalLabel: formatCents(totalCents(p)),
    refundedCents: p.refundedCents ?? 0,
  };
}

/** Map appointmentId → its Payment (if any), for the staff calendar panel. */
export async function getPaymentsByAppointment(
  ctx: TenantContext,
  appointmentIds: string[],
): Promise<Record<string, PaymentInfo>> {
  if (appointmentIds.length === 0) return {};
  const db = tenantDb(ctx);
  const payments = await db.payment.findMany({
    where: { ...ownershipWhere(ctx), appointmentId: { in: appointmentIds } },
  });
  const out: Record<string, PaymentInfo> = {};
  for (const p of payments as any[]) {
    if (p.appointmentId) out[p.appointmentId] = toPaymentInfo(p);
  }
  return out;
}

export type ReconcileRow = {
  payment: {
    id: string;
    status: string;
    totalLabel: string;
    when: string;
    customerName: string;
    serviceName: string;
  };
  candidates: {
    squarePaymentId: string;
    amountLabel: string;
    when: string;
    last4: string | null;
    score: number;
  }[];
};

export type RefundAlert = {
  paymentId: string;
  squarePaymentId: string;
  customerName: string;
  observedRefundLabel: string;
  observedRefundCents: number;
};

/**
 * Reconcile view data: every UNMATCHED SQUARE payment paired with its ranked,
 * still-unlinked Square candidates; plus refund alerts for already-linked PAID
 * payments whose Square record now shows a refund not yet reflected locally.
 */
export async function getReconcileData(ctx: TenantContext): Promise<{
  rows: ReconcileRow[];
  refunds: RefundAlert[];
}> {
  const db = tenantDb(ctx);
  const business = await prisma.business.findUnique({ where: { id: ctx.businessId } });

  const payments = await db.payment.findMany({
    where: { ...ownershipWhere(ctx) },
    orderBy: { createdAt: "desc" },
  });

  const unmatchedSquare = (payments as any[]).filter(
    (p) => p.method === "SQUARE" && p.status === "UNMATCHED",
  );
  const linkedSquareIds = new Set(
    (payments as any[]).map((p) => p.squarePaymentId).filter(Boolean),
  );

  // Decorate customers/services once.
  const customerIds = [...new Set((payments as any[]).map((p) => p.customerId))];
  const serviceRefs = [
    ...new Set(unmatchedSquare.map((p) => p.appointmentId).filter(Boolean)),
  ] as string[];
  const [customers, appts] = await Promise.all([
    customerIds.length
      ? db.customer.findMany({ where: { id: { in: customerIds } } })
      : Promise.resolve([]),
    serviceRefs.length
      ? db.appointment.findMany({ where: { id: { in: serviceRefs as string[] } } })
      : Promise.resolve([]),
  ]);
  const custName = new Map<string, string>(
    (customers as any[]).map((c) => [c.id, `${c.firstName} ${c.lastName}`]),
  );
  const apptById = new Map<string, any>((appts as any[]).map((a) => [a.id, a]));
  const svcIds = [...new Set((appts as any[]).map((a) => a.serviceId))];
  const services = svcIds.length
    ? await db.service.findMany({ where: { id: { in: svcIds } } })
    : [];
  const svcName = new Map<string, string>((services as any[]).map((s) => [s.id, s.name]));

  // Pull recent Square payments once; drop any already linked to a local record.
  const squareAll = await listRecentPayments(business ?? { squareAccessToken: null, squareLocationId: null });
  const available = squareAll.filter((s) => !linkedSquareIds.has(s.id));

  const rows: ReconcileRow[] = unmatchedSquare.map((p) => {
    const ranked = rankCandidates(
      { amountCents: totalCents(p), createdAt: new Date(p.createdAt) },
      available,
    ).filter((r) => r.score >= MIN_MATCH_SCORE);
    const appt = p.appointmentId ? apptById.get(p.appointmentId) : null;
    return {
      payment: {
        id: p.id,
        status: p.status,
        totalLabel: formatCents(totalCents(p)),
        when: new Date(p.createdAt).toISOString(),
        customerName: custName.get(p.customerId) ?? "Customer",
        serviceName: appt ? svcName.get(appt.serviceId) ?? "Service" : "Service",
      },
      candidates: ranked.slice(0, 3).map((r) => ({
        squarePaymentId: r.candidate.id,
        amountLabel: formatCents(r.candidate.amountCents),
        when: r.candidate.createdAt.toISOString(),
        last4: r.candidate.last4 ?? null,
        score: Math.round(r.score),
      })),
    };
  });

  // Refund alerts: poll each linked PAID square payment; surface new refunds.
  const linkedPaid = (payments as any[]).filter(
    (p) => p.method === "SQUARE" && p.status === "PAID" && p.squarePaymentId,
  );
  const refunds: RefundAlert[] = [];
  for (const p of linkedPaid) {
    const sq = await getPayment(
      business ?? { squareAccessToken: null, squareLocationId: null },
      p.squarePaymentId,
    );
    if (sq && sq.refundedCents > (p.refundedCents ?? 0)) {
      refunds.push({
        paymentId: p.id,
        squarePaymentId: p.squarePaymentId,
        customerName: custName.get(p.customerId) ?? "Customer",
        observedRefundLabel: formatCents(sq.refundedCents),
        observedRefundCents: sq.refundedCents,
      });
    }
  }

  return { rows, refunds };
}
