"use client";

import { useMemo, useState } from "react";

type Interval = [string, string];
type DayKey = "sun" | "mon" | "tue" | "wed" | "thu" | "fri" | "sat";
type Weekly = Record<DayKey, Interval[]>;

type Override = {
  id: string;
  date: string;
  closed: boolean;
  reopen: boolean;
  hours: Interval[] | null;
};
type Schedule = { id: string; locationId: string; weekly: Weekly; overrides: Override[] };
type LocationRef = { id: string; name: string };
type Settings = { requiresApproval: boolean; depositEnabled: boolean; depositCents: number };

const DAYS: { key: DayKey; label: string }[] = [
  { key: "mon", label: "Monday" },
  { key: "tue", label: "Tuesday" },
  { key: "wed", label: "Wednesday" },
  { key: "thu", label: "Thursday" },
  { key: "fri", label: "Friday" },
  { key: "sat", label: "Saturday" },
  { key: "sun", label: "Sunday" },
];

const EMPTY_WEEKLY: Weekly = { sun: [], mon: [], tue: [], wed: [], thu: [], fri: [], sat: [] };

function cloneWeekly(w?: Weekly): Weekly {
  const base = { ...EMPTY_WEEKLY };
  const out = {} as Weekly;
  for (const k of Object.keys(base) as DayKey[]) {
    out[k] = (w?.[k] ?? []).map((iv) => [iv[0], iv[1]] as Interval);
  }
  return out;
}

const inputCls = "rounded border border-gray-300 px-2 py-1 text-sm";

export function ScheduleEditor({
  locations,
  schedules,
  settings: initialSettings,
}: {
  locations: LocationRef[];
  schedules: Schedule[];
  settings: Settings;
}) {
  return (
    <div className="space-y-8">
      <BookingSettings initial={initialSettings} />
      <WeeklyAndOverrides locations={locations} schedules={schedules} />
    </div>
  );
}

// --------------------------------------------------------------------------

function BookingSettings({ initial }: { initial: Settings }) {
  const [form, setForm] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function save() {
    setBusy(true);
    setMsg(null);
    const res = await fetch("/api/me/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form),
    });
    const data = await res.json();
    setBusy(false);
    setMsg(res.ok && data.ok ? "Saved" : data.error ?? "Save failed");
  }

  return (
    <div className="rounded-lg bg-white p-6 shadow">
      <h2 className="text-lg font-semibold mb-4">Booking settings</h2>
      <label className="flex items-center gap-2 mb-3 text-sm">
        <input
          type="checkbox"
          checked={form.requiresApproval}
          onChange={(e) => setForm({ ...form, requiresApproval: e.target.checked })}
        />
        Bookings require my approval
      </label>
      <label className="flex items-center gap-2 mb-3 text-sm">
        <input
          type="checkbox"
          checked={form.depositEnabled}
          onChange={(e) => setForm({ ...form, depositEnabled: e.target.checked })}
        />
        Require a deposit at booking
      </label>
      {form.depositEnabled && (
        <div className="mb-3">
          <label className="block text-sm font-medium mb-1" htmlFor="depositCents">
            Deposit amount (cents)
          </label>
          <input
            id="depositCents"
            type="number"
            min={0}
            className={inputCls}
            value={form.depositCents}
            onChange={(e) => setForm({ ...form, depositCents: Number(e.target.value) })}
          />
        </div>
      )}
      <div className="flex items-center gap-3">
        <button
          onClick={save}
          disabled={busy}
          className="rounded px-3 py-2 text-sm font-medium text-white disabled:opacity-60"
          style={{ background: "var(--brand-primary)" }}
        >
          {busy ? "Saving..." : "Save settings"}
        </button>
        {msg && <span className="text-sm text-gray-600">{msg}</span>}
      </div>
    </div>
  );
}

// --------------------------------------------------------------------------

function WeeklyAndOverrides({
  locations,
  schedules: initialSchedules,
}: {
  locations: LocationRef[];
  schedules: Schedule[];
}) {
  const [schedules, setSchedules] = useState<Schedule[]>(initialSchedules);
  const [locationId, setLocationId] = useState<string>(locations[0]?.id ?? "");

  const current = useMemo(
    () => schedules.find((s) => s.locationId === locationId) ?? null,
    [schedules, locationId],
  );
  const [weekly, setWeekly] = useState<Weekly>(cloneWeekly(current?.weekly));
  const [loadedFor, setLoadedFor] = useState<string>(locationId);

  // Reload the editable weekly grid when the selected location changes.
  if (loadedFor !== locationId) {
    setLoadedFor(locationId);
    setWeekly(cloneWeekly(current?.weekly));
  }

  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  if (locations.length === 0) {
    return (
      <div className="rounded-lg bg-white p-6 shadow text-sm text-gray-600">
        You are not assigned to a location yet. Ask your admin to assign you to
        one before setting your schedule.
      </div>
    );
  }

  function setDay(day: DayKey, intervals: Interval[]) {
    setWeekly((w) => ({ ...w, [day]: intervals }));
  }

  async function saveWeekly() {
    setBusy(true);
    setMsg(null);
    const res = await fetch("/api/schedule", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ locationId, weekly }),
    });
    const data = await res.json();
    setBusy(false);
    if (res.ok && data.ok) {
      setMsg("Schedule saved");
      // Update local schedule cache so overrides can attach to the new id.
      setSchedules((prev) => {
        const found = prev.find((s) => s.locationId === locationId);
        if (found) {
          return prev.map((s) =>
            s.locationId === locationId ? { ...s, id: data.id, weekly } : s,
          );
        }
        return [...prev, { id: data.id, locationId, weekly, overrides: [] }];
      });
    } else {
      setMsg(data.error ?? "Save failed");
    }
  }

  return (
    <div className="rounded-lg bg-white p-6 shadow">
      <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
        <h2 className="text-lg font-semibold">Weekly availability</h2>
        <label className="text-sm flex items-center gap-2">
          Location
          <select
            className={inputCls}
            value={locationId}
            onChange={(e) => setLocationId(e.target.value)}
            data-testid="location-select"
          >
            {locations.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="space-y-3">
        {DAYS.map(({ key, label }) => (
          <DayRow key={key} label={label} intervals={weekly[key]} onChange={(iv) => setDay(key, iv)} />
        ))}
      </div>

      <div className="mt-5 flex items-center gap-3">
        <button
          onClick={saveWeekly}
          disabled={busy}
          className="rounded px-3 py-2 text-sm font-medium text-white disabled:opacity-60"
          style={{ background: "var(--brand-primary)" }}
        >
          {busy ? "Saving..." : "Save weekly schedule"}
        </button>
        {msg && <span className="text-sm text-gray-600">{msg}</span>}
      </div>

      <hr className="my-6" />

      <Overrides
        schedule={current}
        onChange={(next) =>
          setSchedules((prev) => prev.map((s) => (s.id === next.id ? next : s)))
        }
      />
    </div>
  );
}

function DayRow({
  label,
  intervals,
  onChange,
}: {
  label: string;
  intervals: Interval[];
  onChange: (intervals: Interval[]) => void;
}) {
  return (
    <div className="flex items-start gap-3 flex-wrap">
      <div className="w-24 pt-1 text-sm font-medium">{label}</div>
      <div className="flex flex-col gap-2">
        {intervals.length === 0 && <span className="text-sm text-gray-400 pt-1">Closed</span>}
        {intervals.map((iv, i) => (
          <div key={i} className="flex items-center gap-2">
            <input
              type="time"
              className={inputCls}
              value={iv[0]}
              onChange={(e) => {
                const next = intervals.map((x, j) => (j === i ? ([e.target.value, x[1]] as Interval) : x));
                onChange(next);
              }}
            />
            <span className="text-gray-400">–</span>
            <input
              type="time"
              className={inputCls}
              value={iv[1]}
              onChange={(e) => {
                const next = intervals.map((x, j) => (j === i ? ([x[0], e.target.value] as Interval) : x));
                onChange(next);
              }}
            />
            <button
              type="button"
              className="text-sm text-red-600 hover:underline"
              onClick={() => onChange(intervals.filter((_, j) => j !== i))}
            >
              Remove
            </button>
          </div>
        ))}
        <button
          type="button"
          className="text-sm text-left hover:underline"
          style={{ color: "var(--brand-primary)" }}
          onClick={() => onChange([...intervals, ["09:00", "17:00"]])}
        >
          + Add interval
        </button>
      </div>
    </div>
  );
}

function Overrides({
  schedule,
  onChange,
}: {
  schedule: Schedule | null;
  onChange: (next: Schedule) => void;
}) {
  const [date, setDate] = useState("");
  const [kind, setKind] = useState<"closed" | "reopen" | "hours">("closed");
  const [from, setFrom] = useState("09:00");
  const [to, setTo] = useState("17:00");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  if (!schedule) {
    return (
      <div>
        <h3 className="text-md font-semibold mb-2">Date overrides</h3>
        <p className="text-sm text-gray-500">
          Save a weekly schedule for this location first, then you can add
          date-specific overrides (close a day, reopen a holiday, or set special
          hours).
        </p>
      </div>
    );
  }

  async function add() {
    setBusy(true);
    setMsg(null);
    const body: Record<string, unknown> = {
      scheduleId: schedule!.id,
      date,
      closed: kind === "closed",
      reopen: kind === "reopen",
    };
    if (kind === "hours") body.hours = [[from, to]];
    const res = await fetch("/api/schedule/override", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    setBusy(false);
    if (res.ok && data.ok) {
      const newOverride: Override = {
        id: data.id,
        date,
        closed: kind === "closed",
        reopen: kind === "reopen",
        hours: kind === "hours" ? [[from, to]] : null,
      };
      onChange({ ...schedule!, overrides: [...schedule!.overrides, newOverride] });
      setDate("");
      setMsg("Override added");
    } else {
      setMsg(data.error ?? "Could not add override");
    }
  }

  async function remove(id: string) {
    const res = await fetch("/api/schedule/override", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    });
    const data = await res.json();
    if (res.ok && data.ok) {
      onChange({ ...schedule!, overrides: schedule!.overrides.filter((o) => o.id !== id) });
    }
  }

  function describe(o: Override): string {
    if (o.closed) return "Closed (day off)";
    if (o.reopen && o.hours) return `Reopened, ${o.hours[0][0]}–${o.hours[0][1]}`;
    if (o.reopen) return "Reopened (holiday)";
    if (o.hours) return `Special hours ${o.hours[0][0]}–${o.hours[0][1]}`;
    return "Override";
  }

  return (
    <div>
      <h3 className="text-md font-semibold mb-3">Date overrides</h3>

      {schedule.overrides.length > 0 && (
        <ul className="mb-4 divide-y rounded border" data-testid="override-list">
          {schedule.overrides.map((o) => (
            <li key={o.id} className="flex items-center justify-between px-3 py-2 text-sm">
              <span>
                <span className="font-medium">{o.date}</span> — {describe(o)}
              </span>
              <button
                type="button"
                className="text-red-600 hover:underline"
                onClick={() => remove(o.id)}
              >
                Delete
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="flex items-end gap-3 flex-wrap">
        <label className="text-sm">
          <span className="block mb-1 font-medium">Date</span>
          <input
            type="date"
            className={inputCls}
            value={date}
            onChange={(e) => setDate(e.target.value)}
            data-testid="override-date"
          />
        </label>
        <label className="text-sm">
          <span className="block mb-1 font-medium">Type</span>
          <select
            className={inputCls}
            value={kind}
            onChange={(e) => setKind(e.target.value as typeof kind)}
          >
            <option value="closed">Close this day</option>
            <option value="reopen">Reopen a holiday</option>
            <option value="hours">Special hours</option>
          </select>
        </label>
        {kind === "hours" && (
          <div className="flex items-center gap-2 text-sm">
            <input type="time" className={inputCls} value={from} onChange={(e) => setFrom(e.target.value)} />
            <span className="text-gray-400">–</span>
            <input type="time" className={inputCls} value={to} onChange={(e) => setTo(e.target.value)} />
          </div>
        )}
        <button
          type="button"
          onClick={add}
          disabled={busy || !date}
          className="rounded px-3 py-2 text-sm font-medium text-white disabled:opacity-60"
          style={{ background: "var(--brand-primary)" }}
        >
          {busy ? "Adding..." : "Add override"}
        </button>
        {msg && <span className="text-sm text-gray-600">{msg}</span>}
      </div>
    </div>
  );
}
