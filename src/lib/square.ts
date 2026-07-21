/**
 * square.ts — READ-ONLY Square client (Phase 6).
 *
 * This app NEVER charges cards, creates Orders/Payment Links, or issues refunds.
 * It only READS Square's payment history so staff can manually confirm which
 * Square payment corresponds to a locally-recorded (bookkeeping) Payment, and so
 * refunds made in Square can be reflected locally. Only `ListPayments` /
 * `GetPayment` are ever called.
 *
 * Driver mode mirrors notify.ts's `NOTIFY_DRIVER=console` convention:
 *   - `SQUARE_DRIVER=fake` (dev/test default): returns canned in-memory fixtures
 *     so the whole reconcile flow — including e2e — runs with zero live creds.
 *   - `SQUARE_DRIVER=live`: calls the real Square Node SDK read-only endpoints
 *     using the business's own `squareAccessToken` / `squareLocationId`.
 *
 * When unset, we default to `fake` (safe: never touches a real account).
 */

export type SquarePaymentSummary = {
  id: string;
  amountCents: number;
  createdAt: Date;
  refundedCents: number;
  last4?: string;
};

export type BusinessSquareConfig = {
  squareAccessToken: string | null;
  squareLocationId: string | null;
};

/** Default lookback window for ListPayments. */
export const DEFAULT_SINCE_DAYS = 30;

function driver(): "fake" | "live" {
  return process.env.SQUARE_DRIVER === "live" ? "live" : "fake";
}

// ---------------------------------------------------------------------------
// Fake fixtures (dev/test) — deterministic ids, plausible amounts. Timestamps
// are generated relative to "now" on each call so they always fall inside the
// recent window and score well on time-proximity against just-recorded local
// payments. Amounts/ids are stable so tests and the UI are reproducible.
// ---------------------------------------------------------------------------

const MINUTE = 60_000;

type FakeSpec = { id: string; amountCents: number; agoMin: number; refundedCents?: number; last4?: string };

// A spread of plausible Square payments. Kept deterministic; the reconcile view
// ranks them against each local payment. `fake_sq_refunded` carries a refund so
// the refund-reflection path is demonstrable.
const FAKE_SPECS: FakeSpec[] = [
  { id: "fake_sq_1", amountCents: 8660, agoMin: 3, last4: "4242" },
  { id: "fake_sq_2", amountCents: 4871, agoMin: 12, last4: "1881" },
  { id: "fake_sq_3", amountCents: 12000, agoMin: 45, last4: "0005" },
  { id: "fake_sq_4", amountCents: 5411, agoMin: 90, last4: "4444" },
  { id: "fake_sq_5", amountCents: 9740, agoMin: 240, last4: "6789" },
  { id: "fake_sq_6", amountCents: 3200, agoMin: 1440, last4: "1117" },
  { id: "fake_sq_refunded", amountCents: 16000, agoMin: 2880, refundedCents: 16000, last4: "9999" },
];

function fakePayments(now: number): SquarePaymentSummary[] {
  return FAKE_SPECS.map((s) => ({
    id: s.id,
    amountCents: s.amountCents,
    createdAt: new Date(now - s.agoMin * MINUTE),
    refundedCents: s.refundedCents ?? 0,
    last4: s.last4,
  }));
}

// ---------------------------------------------------------------------------
// Live SDK (read-only). The `square` package is imported dynamically so the fake
// path (and unit tests) never load it.
// ---------------------------------------------------------------------------

function toCents(money: { amount?: bigint | number | null } | null | undefined): number {
  const a = money?.amount;
  if (a == null) return 0;
  return typeof a === "bigint" ? Number(a) : a;
}

async function liveListPayments(
  business: BusinessSquareConfig,
  sinceDays: number,
): Promise<SquarePaymentSummary[]> {
  if (!business.squareAccessToken) return [];
  const { SquareClient, SquareEnvironment } = await import("square");
  const client = new SquareClient({
    token: business.squareAccessToken,
    environment: SquareEnvironment.Production,
  });

  const beginTime = new Date(Date.now() - sinceDays * 24 * 60 * MINUTE).toISOString();
  const out: SquarePaymentSummary[] = [];
  // `list` returns an async-paginated result; iterate all pages in the window.
  const page = await client.payments.list({
    locationId: business.squareLocationId ?? undefined,
    beginTime,
    sortOrder: "DESC",
  });
  for await (const p of page) {
    if (!p.id) continue;
    out.push({
      id: p.id,
      amountCents: toCents(p.amountMoney),
      createdAt: p.createdAt ? new Date(p.createdAt) : new Date(),
      refundedCents: toCents(p.refundedMoney),
      last4: p.cardDetails?.card?.last4 ?? undefined,
    });
  }
  return out;
}

async function liveGetPayment(
  business: BusinessSquareConfig,
  squarePaymentId: string,
): Promise<SquarePaymentSummary | null> {
  if (!business.squareAccessToken) return null;
  const { SquareClient, SquareEnvironment } = await import("square");
  const client = new SquareClient({
    token: business.squareAccessToken,
    environment: SquareEnvironment.Production,
  });
  const res = await client.payments.get({ paymentId: squarePaymentId });
  const p = res.payment;
  if (!p?.id) return null;
  return {
    id: p.id,
    amountCents: toCents(p.amountMoney),
    createdAt: p.createdAt ? new Date(p.createdAt) : new Date(),
    refundedCents: toCents(p.refundedMoney),
    last4: p.cardDetails?.card?.last4 ?? undefined,
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Recent Square payments for a business's configured location, newest first.
 * Fake mode ignores credentials and returns fixtures; live mode calls
 * Square's read-only `ListPayments`.
 */
export async function listRecentPayments(
  business: BusinessSquareConfig,
  opts?: { sinceDays?: number },
): Promise<SquarePaymentSummary[]> {
  const sinceDays = opts?.sinceDays ?? DEFAULT_SINCE_DAYS;
  if (driver() === "fake") {
    return fakePayments(Date.now());
  }
  return liveListPayments(business, sinceDays);
}

/**
 * A single Square payment by id (used to poll refund status on a linked
 * payment). Fake mode returns the matching fixture; live mode calls `GetPayment`.
 */
export async function getPayment(
  business: BusinessSquareConfig,
  squarePaymentId: string,
): Promise<SquarePaymentSummary | null> {
  if (driver() === "fake") {
    return fakePayments(Date.now()).find((p) => p.id === squarePaymentId) ?? null;
  }
  return liveGetPayment(business, squarePaymentId);
}
