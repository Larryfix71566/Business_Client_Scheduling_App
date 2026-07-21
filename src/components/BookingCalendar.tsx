"use client";

import { useEffect, useState } from "react";

type Cell = { startIso: string; endIso: string; time: string; taken: boolean };
type DayGrid = { date: string; label: string; cells: Cell[] };

const inputCls = "w-full rounded border border-gray-300 px-3 py-2";

export function BookingCalendar({
  businessSlug,
  locationId,
  userId,
  serviceId,
  serviceName,
}: {
  businessSlug: string;
  locationId: string;
  userId: string;
  serviceId: string;
  serviceName: string;
}) {
  const [grid, setGrid] = useState<DayGrid[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Cell | null>(null);
  const [done, setDone] = useState<{ status: string; managePath?: string } | null>(null);

  async function loadSlots() {
    setLoading(true);
    const qs = new URLSearchParams({ businessSlug, locationId, userId, serviceId });
    const res = await fetch(`/api/public/slots?${qs.toString()}`);
    const data = await res.json();
    setLoading(false);
    setGrid(res.ok && data.ok ? data.grid : []);
  }

  useEffect(() => {
    loadSlots();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [businessSlug, locationId, userId, serviceId]);

  if (done) {
    return (
      <div className="rounded-lg bg-white p-6 shadow" data-testid="booking-confirmation">
        <h2 className="text-lg font-semibold mb-2">
          {done.status === "REQUESTED" ? "Request submitted" : "Booking confirmed"}
        </h2>
        <p className="text-gray-600">
          {done.status === "REQUESTED"
            ? "Your request was sent to the staff member for approval. You'll be notified once it's confirmed."
            : `Your ${serviceName} is confirmed. See you then!`}
        </p>
        {done.managePath && (
          <p className="mt-4 text-sm">
            Need to make a change?{" "}
            <a
              href={done.managePath}
              data-testid="manage-link"
              className="font-medium underline"
              style={{ color: "var(--brand-primary)" }}
            >
              Cancel or reschedule your booking
            </a>
          </p>
        )}
      </div>
    );
  }

  if (selected) {
    return (
      <BookingForm
        businessSlug={businessSlug}
        locationId={locationId}
        userId={userId}
        serviceId={serviceId}
        cell={selected}
        onBack={() => setSelected(null)}
        onBooked={(status, managePath) => setDone({ status, managePath })}
      />
    );
  }

  if (loading) return <p className="text-gray-500">Loading available times…</p>;

  const hasAny = grid && grid.some((d) => d.cells.length > 0);
  if (!hasAny) {
    return <p className="text-gray-500">No available times in the next two weeks.</p>;
  }

  return (
    <div className="space-y-5" data-testid="slot-grid">
      {grid!
        .filter((d) => d.cells.length > 0)
        .map((day) => (
          <div key={day.date}>
            <h2 className="text-sm font-semibold text-gray-700 mb-2">{day.label}</h2>
            <div className="flex flex-wrap gap-2">
              {day.cells.map((c) =>
                c.taken ? (
                  <span
                    key={c.startIso}
                    data-slot={c.startIso}
                    data-taken="true"
                    aria-label="Unavailable"
                    title="Unavailable"
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
                    onClick={() => setSelected(c)}
                    className="rounded border border-gray-300 bg-white px-3 py-2 text-sm hover:border-gray-500"
                  >
                    {c.time}
                  </button>
                ),
              )}
            </div>
          </div>
        ))}
    </div>
  );
}

function BookingForm({
  businessSlug,
  locationId,
  userId,
  serviceId,
  cell,
  onBack,
  onBooked,
}: {
  businessSlug: string;
  locationId: string;
  userId: string;
  serviceId: string;
  cell: Cell;
  onBack: () => void;
  onBooked: (status: string, managePath?: string) => void;
}) {
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const res = await fetch("/api/public/book", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        businessSlug,
        locationId,
        userId,
        serviceId,
        startIso: cell.startIso,
        firstName,
        lastName,
        phone,
        email,
        notes,
      }),
    });
    const data = await res.json();
    setBusy(false);
    if (res.ok && data.ok) {
      onBooked(data.status, data.managePath);
    } else {
      setError(data.error ?? "Could not complete booking. Please pick another time.");
    }
  }

  return (
    <form onSubmit={submit} className="rounded-lg bg-white p-6 shadow max-w-md" data-testid="booking-form">
      <button type="button" onClick={onBack} className="text-sm text-gray-500 hover:underline mb-3">
        ← Change time
      </button>
      <p className="mb-4 text-sm text-gray-600">
        Booking for <span className="font-medium">{cell.time}</span>
      </p>

      {error && (
        <p role="alert" className="mb-3 rounded bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      )}

      <label className="block text-sm font-medium mb-1" htmlFor="firstName">First name</label>
      <input id="firstName" required value={firstName} onChange={(e) => setFirstName(e.target.value)} className={`${inputCls} mb-3`} />

      <label className="block text-sm font-medium mb-1" htmlFor="lastName">Last name</label>
      <input id="lastName" required value={lastName} onChange={(e) => setLastName(e.target.value)} className={`${inputCls} mb-3`} />

      <label className="block text-sm font-medium mb-1" htmlFor="phone">Phone</label>
      <input id="phone" required type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} className={`${inputCls} mb-3`} />

      <label className="block text-sm font-medium mb-1" htmlFor="email">Email (optional)</label>
      <input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} className={`${inputCls} mb-3`} />

      <label className="block text-sm font-medium mb-1" htmlFor="notes">Notes (optional)</label>
      <textarea id="notes" value={notes} onChange={(e) => setNotes(e.target.value)} className={`${inputCls} mb-4`} rows={3} />

      <button
        type="submit"
        disabled={busy}
        className="w-full rounded px-3 py-2 font-medium text-white disabled:opacity-60"
        style={{ background: "var(--brand-primary)" }}
        data-testid="confirm-booking"
      >
        {busy ? "Booking…" : "Confirm booking"}
      </button>
    </form>
  );
}
