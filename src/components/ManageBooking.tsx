"use client";

import { useState } from "react";

type Cell = { startIso: string; endIso: string; time: string; taken: boolean };
type DayGrid = { date: string; label: string; cells: Cell[] };

// Customer self-serve cancel/reschedule UI on the manage page. Reuses the same
// slot-grid data shape (and data-slot/data-taken attributes) as the public
// booking calendar; the grid comes from /api/public/manage/slots, which excludes
// this appointment's own current slot so it can be freed/re-picked.
export function ManageBooking({
  businessSlug,
  manageToken,
  serviceName,
}: {
  businessSlug: string;
  manageToken: string;
  serviceName: string;
}) {
  const [mode, setMode] = useState<"idle" | "reschedule">("idle");
  const [grid, setGrid] = useState<DayGrid[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<"cancelled" | "rescheduled" | null>(null);

  async function cancel() {
    if (!confirm("Cancel this booking?")) return;
    setBusy(true);
    setError(null);
    const res = await fetch("/api/public/manage/cancel", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ businessSlug, manageToken }),
    });
    const data = await res.json();
    setBusy(false);
    if (res.ok && data.ok) setDone("cancelled");
    else setError(data.error ?? "Could not cancel. Please contact the business.");
  }

  async function startReschedule() {
    setMode("reschedule");
    setLoading(true);
    setError(null);
    const qs = new URLSearchParams({ businessSlug, manageToken });
    const res = await fetch(`/api/public/manage/slots?${qs.toString()}`);
    const data = await res.json();
    setLoading(false);
    setGrid(res.ok && data.ok ? data.grid : []);
  }

  async function pick(cell: Cell) {
    setBusy(true);
    setError(null);
    const res = await fetch("/api/public/manage/reschedule", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ businessSlug, manageToken, startIso: cell.startIso }),
    });
    const data = await res.json();
    setBusy(false);
    if (res.ok && data.ok) setDone("rescheduled");
    else setError(data.error ?? "That time is no longer available. Please pick another.");
  }

  if (done) {
    return (
      <div className="rounded-lg bg-white p-6 shadow" data-testid="manage-done">
        <h2 className="text-lg font-semibold mb-2">
          {done === "cancelled" ? "Booking cancelled" : "Booking rescheduled"}
        </h2>
        <p className="text-gray-600">
          {done === "cancelled"
            ? `Your ${serviceName} has been cancelled. We hope to see you another time.`
            : `Your ${serviceName} has been moved. A confirmation has been sent to you.`}
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {error && (
        <p role="alert" className="rounded bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      )}

      {mode === "idle" ? (
        <div className="flex flex-wrap gap-3">
          <button
            type="button"
            onClick={startReschedule}
            data-testid="reschedule-btn"
            className="rounded px-4 py-2 text-sm font-medium text-white"
            style={{ background: "var(--brand-primary)" }}
          >
            Reschedule
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={cancel}
            data-testid="cancel-btn"
            className="rounded border border-red-300 px-4 py-2 text-sm font-medium text-red-700 hover:bg-red-50 disabled:opacity-60"
          >
            Cancel booking
          </button>
        </div>
      ) : (
        <div data-testid="reschedule-grid">
          <button
            type="button"
            onClick={() => setMode("idle")}
            className="text-sm text-gray-500 hover:underline mb-3"
          >
            ← Back
          </button>
          <h2 className="text-sm font-semibold text-gray-700 mb-2">Pick a new time</h2>
          {loading ? (
            <p className="text-gray-500">Loading available times…</p>
          ) : !grid || !grid.some((d) => d.cells.some((c) => !c.taken)) ? (
            <p className="text-gray-500">No available times in the next two weeks.</p>
          ) : (
            <div className="space-y-5">
              {grid
                .filter((d) => d.cells.length > 0)
                .map((day) => (
                  <div key={day.date}>
                    <h3 className="text-sm font-semibold text-gray-700 mb-2">{day.label}</h3>
                    <div className="flex flex-wrap gap-2">
                      {day.cells.map((c) =>
                        c.taken ? (
                          <span
                            key={c.startIso}
                            data-slot={c.startIso}
                            data-taken="true"
                            className="inline-flex items-center gap-1 rounded border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-600 line-through cursor-not-allowed select-none"
                          >
                            ✕ {c.time}
                          </span>
                        ) : (
                          <button
                            key={c.startIso}
                            type="button"
                            data-slot={c.startIso}
                            data-taken="false"
                            disabled={busy}
                            onClick={() => pick(c)}
                            className="rounded border border-gray-300 bg-white px-3 py-2 text-sm hover:border-gray-500 disabled:opacity-60"
                          >
                            {c.time}
                          </button>
                        ),
                      )}
                    </div>
                  </div>
                ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
