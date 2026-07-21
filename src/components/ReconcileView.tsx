"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

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

// Phase 6 reconcile view. Read-only against Square: staff manually confirm which
// Square payment matches each UNMATCHED local payment (never auto-linked), and
// reflect any refund Square reports. No charge/refund is ever issued from here.
export function ReconcileView({
  rows,
  refunds,
}: {
  rows: ReconcileRow[];
  refunds: RefundAlert[];
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

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

  return (
    <div className="space-y-6">
      {error && <p role="alert" className="text-sm text-red-700">{error}</p>}

      {refunds.length > 0 && (
        <section data-testid="refund-alerts">
          <h2 className="text-lg font-semibold mb-2">Refunds detected in Square</h2>
          <ul className="space-y-2">
            {refunds.map((r) => (
              <li
                key={r.paymentId}
                data-testid="refund-alert"
                className="rounded-lg bg-white p-4 shadow flex flex-wrap items-center justify-between gap-3"
              >
                <div className="text-sm">
                  <div className="font-medium">{r.customerName}</div>
                  <div className="text-gray-500">
                    Square shows {r.observedRefundLabel} refunded (payment {r.squarePaymentId}).
                  </div>
                </div>
                <button
                  type="button"
                  disabled={busy}
                  data-testid="record-refund-btn"
                  onClick={() =>
                    post("/api/payments/refund", {
                      paymentId: r.paymentId,
                      refundedCents: r.observedRefundCents,
                    })
                  }
                  className="rounded bg-red-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-red-700 disabled:opacity-60"
                >
                  Record refund
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section>
        <h2 className="text-lg font-semibold mb-2">Unmatched Square payments</h2>
        {rows.length === 0 ? (
          <p className="text-gray-500" data-testid="reconcile-empty">
            Nothing to reconcile. Local Square payments show up here until you match them.
          </p>
        ) : (
          <ul className="space-y-3" data-testid="reconcile-list">
            {rows.map((row) => (
              <li
                key={row.payment.id}
                data-testid="reconcile-row"
                className="rounded-lg bg-white p-4 shadow"
              >
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <div className="font-medium">
                    {row.payment.customerName} · {row.payment.serviceName}
                  </div>
                  <div className="text-sm font-semibold" data-testid="reconcile-total">
                    {row.payment.totalLabel}
                  </div>
                </div>

                {row.candidates.length === 0 ? (
                  <p className="mt-2 text-xs text-gray-500">
                    No close Square payments found in the recent window.
                  </p>
                ) : (
                  <ul className="mt-2 space-y-2">
                    {row.candidates.map((c, i) => (
                      <li
                        key={c.squarePaymentId}
                        data-testid="candidate"
                        className="flex flex-wrap items-center justify-between gap-2 rounded border border-gray-200 px-3 py-2 text-sm"
                      >
                        <span>
                          <span className="font-medium">{c.amountLabel}</span>
                          {c.last4 && <span className="text-gray-500"> · ····{c.last4}</span>}
                          <span className="text-gray-400">
                            {" "}
                            · {new Date(c.when).toLocaleString()}
                          </span>
                          {i === 0 && (
                            <span className="ml-2 rounded bg-blue-100 px-1.5 py-0.5 text-xs text-blue-700">
                              best match
                            </span>
                          )}
                        </span>
                        <button
                          type="button"
                          disabled={busy}
                          data-testid="confirm-match-btn"
                          onClick={() =>
                            post("/api/payments/confirm-match", {
                              paymentId: row.payment.id,
                              squarePaymentId: c.squarePaymentId,
                            })
                          }
                          className="rounded bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-60"
                        >
                          Confirm match
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
