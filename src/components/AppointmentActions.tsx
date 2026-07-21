"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

// Staff per-appointment cancel / no-show / complete actions on the calendar
// (Phase 4 + Phase 6). Always available (no cutoff) — the server enforces
// ownership scoping. Only rendered for still-actionable appointments
// (REQUESTED/CONFIRMED). `showComplete` adds a "Complete" button (Phase 6:
// completing is the entry point for recording a payment).
export function AppointmentActions({
  appointmentId,
  showComplete = false,
}: {
  appointmentId: string;
  showComplete?: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function act(action: "cancel" | "no_show" | "complete") {
    if (action === "cancel" && !confirm("Cancel this appointment?")) return;
    setBusy(true);
    setError(null);
    const res = await fetch("/api/appointments/status", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ appointmentId, action }),
    });
    const data = await res.json();
    setBusy(false);
    if (res.ok && data.ok) {
      router.refresh();
    } else {
      setError(data.error ?? "Could not update the appointment.");
    }
  }

  return (
    <div className="mt-3 flex items-center gap-2">
      {showComplete && (
        <button
          type="button"
          disabled={busy}
          onClick={() => act("complete")}
          data-testid="complete-btn"
          className="rounded bg-green-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-green-700 disabled:opacity-60"
        >
          Complete
        </button>
      )}
      <button
        type="button"
        disabled={busy}
        onClick={() => act("no_show")}
        data-testid="no-show-btn"
        className="rounded border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-60"
      >
        No-show
      </button>
      <button
        type="button"
        disabled={busy}
        onClick={() => act("cancel")}
        data-testid="staff-cancel-btn"
        className="rounded border border-red-300 px-3 py-1.5 text-xs font-medium text-red-700 hover:bg-red-50 disabled:opacity-60"
      >
        Cancel
      </button>
      {error && <span role="alert" className="text-xs text-red-700">{error}</span>}
    </div>
  );
}
