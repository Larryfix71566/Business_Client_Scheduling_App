"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

export type PaymentInfo = {
  id: string;
  status: string;
  method: string;
  squarePaymentId: string | null;
  totalLabel: string;
  totalCents: number;
  refundedCents: number;
};

// Phase 6 calendar panel for a COMPLETED appointment. Correlate-only — no card
// entry. If no Payment exists yet, staff record one (method + tip). Once
// recorded: CASH/OTHER can be marked PAID here (decrements inventory); SQUARE
// links via the Reconcile view. PAID/REFUNDED just show status.
export function PaymentPanel({
  appointmentId,
  payment,
}: {
  appointmentId: string;
  payment: PaymentInfo | null;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [method, setMethod] = useState<"SQUARE" | "CASH" | "OTHER">("SQUARE");
  const [tip, setTip] = useState("0");

  async function post(url: string, body: unknown) {
    setBusy(true);
    setError(null);
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    setBusy(false);
    if (res.ok && data.ok) {
      router.refresh();
    } else {
      setError(data.error ?? "Could not update the payment.");
    }
  }

  if (!payment) {
    const tipCents = Math.round(Number(tip || "0") * 100);
    return (
      <div className="mt-3 rounded border border-gray-200 bg-gray-50 p-3" data-testid="record-payment">
        <div className="text-xs font-medium text-gray-600 mb-2">Record payment</div>
        <div className="flex flex-wrap items-center gap-2">
          <select
            aria-label="Payment method"
            data-testid="payment-method"
            value={method}
            onChange={(e) => setMethod(e.target.value as typeof method)}
            className="rounded border border-gray-300 px-2 py-1 text-sm"
          >
            <option value="SQUARE">Square</option>
            <option value="CASH">Cash</option>
            <option value="OTHER">Other</option>
          </select>
          <label className="text-xs text-gray-500">
            Tip $
            <input
              data-testid="payment-tip"
              value={tip}
              onChange={(e) => setTip(e.target.value)}
              inputMode="decimal"
              className="ml-1 w-16 rounded border border-gray-300 px-2 py-1 text-sm"
            />
          </label>
          <button
            type="button"
            disabled={busy}
            data-testid="record-payment-btn"
            onClick={() =>
              post("/api/payments", {
                appointmentId,
                method,
                tipCents: Number.isFinite(tipCents) && tipCents >= 0 ? tipCents : 0,
              })
            }
            className="rounded bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-60"
          >
            Record
          </button>
        </div>
        {error && <p role="alert" className="mt-2 text-xs text-red-700">{error}</p>}
      </div>
    );
  }

  return (
    <div className="mt-3 rounded border border-gray-200 bg-gray-50 p-3" data-testid="payment-info">
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm">
          {payment.method} · {payment.totalLabel}
        </span>
        <PaymentBadge status={payment.status} />
      </div>

      {payment.status === "UNMATCHED" && payment.method === "SQUARE" && (
        <div className="mt-2 text-xs text-gray-600">
          Awaiting a Square match —{" "}
          <Link href="/dashboard/reconcile" className="text-blue-600 hover:underline">
            open Reconcile
          </Link>
          .
        </div>
      )}

      {payment.status === "UNMATCHED" && payment.method !== "SQUARE" && (
        <button
          type="button"
          disabled={busy}
          data-testid="mark-paid-btn"
          onClick={() => post("/api/payments/mark-paid", { paymentId: payment.id })}
          className="mt-2 rounded bg-green-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-green-700 disabled:opacity-60"
        >
          Mark paid
        </button>
      )}

      {error && <p role="alert" className="mt-2 text-xs text-red-700">{error}</p>}
    </div>
  );
}

function PaymentBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    PAID: "bg-green-100 text-green-700",
    UNMATCHED: "bg-amber-100 text-amber-700",
    REFUNDED: "bg-red-100 text-red-700",
  };
  return (
    <span
      data-testid="payment-status"
      className={`rounded px-2 py-0.5 text-xs font-medium ${styles[status] ?? "bg-gray-100"}`}
    >
      {status}
    </span>
  );
}
