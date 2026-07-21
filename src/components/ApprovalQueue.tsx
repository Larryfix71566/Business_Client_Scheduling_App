"use client";

import { useState } from "react";

type ApptRow = {
  id: string;
  status: string;
  startIso: string;
  when: string;
  serviceName: string;
  priceLabel: string;
  customerName: string;
  customerPhone: string;
  staffName: string;
  locationName: string;
};

export function ApprovalQueue({ initial }: { initial: ApptRow[] }) {
  const [rows, setRows] = useState<ApptRow[]>(initial);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function decide(appointmentId: string, action: "approve" | "decline") {
    setBusyId(appointmentId);
    setError(null);
    const res = await fetch("/api/appointments/decision", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ appointmentId, action }),
    });
    const data = await res.json();
    setBusyId(null);
    if (res.ok && data.ok) {
      setRows((prev) => prev.filter((r) => r.id !== appointmentId));
    } else {
      setError(data.error ?? "Could not update the request.");
    }
  }

  if (rows.length === 0) {
    return <p className="text-gray-500" data-testid="approvals-empty">No pending requests.</p>;
  }

  return (
    <div>
      {error && (
        <p role="alert" className="mb-3 rounded bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      )}
      <ul className="space-y-3" data-testid="approvals-list">
        {rows.map((a) => (
          <li key={a.id} className="rounded-lg bg-white p-4 shadow" data-testid="approval-item">
            <div className="font-medium">{a.when}</div>
            <div className="text-sm text-gray-700 mt-1">
              {a.serviceName} · {a.priceLabel}
            </div>
            <div className="text-sm text-gray-500 mb-3">
              {a.customerName} · {a.customerPhone}
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                disabled={busyId === a.id}
                onClick={() => decide(a.id, "approve")}
                data-testid="approve-btn"
                className="rounded bg-green-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-green-700 disabled:opacity-60"
              >
                Approve
              </button>
              <button
                type="button"
                disabled={busyId === a.id}
                onClick={() => decide(a.id, "decline")}
                data-testid="decline-btn"
                className="rounded border border-red-300 px-3 py-1.5 text-sm font-medium text-red-700 hover:bg-red-50 disabled:opacity-60"
              >
                Decline
              </button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
