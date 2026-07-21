/**
 * slots.ts — PURE slot-computation engine (Phase 2).
 *
 * Guardrail #5: these functions take PLAIN DATA in and return open bookable
 * slots. There are NO database calls, no I/O, and no hidden side effects. This
 * is the most test-covered file in the repo.
 *
 * Guardrail #4 (time): appointments are stored in UTC, but every business runs
 * on wall-clock hours in its Location's IANA timezone. All schedule math here
 * happens in that timezone via `date-fns-tz`, and the returned slot boundaries
 * are absolute instants (`Date`) — i.e. real UTC instants that correspond to the
 * location-local wall-clock window. A 09:00 slot in America/New_York in July is
 * 13:00Z, NOT 09:00Z.
 *
 * DST correctness: slots are stepped by REAL elapsed minutes between the
 * absolute instants of a working interval's open/close boundaries. On the
 * spring-forward day a window loses an hour of real time (fewer slots); on the
 * fall-back day it gains one (more slots). This avoids ever emitting a slot at a
 * wall-clock time that does not exist, and never double-emits the repeated hour.
 */

import { fromZonedTime } from "date-fns-tz";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * Slot granularity: candidate start times are placed every 15 minutes within a
 * working interval. 15 (rather than 30) is the finer of the two values the plan
 * allows; it divides evenly into all our seeded service durations (20/30/45/60/
 * 90/120 min) so every service's natural start times are representable. Callers
 * may override per-call via `slotStepMin`.
 */
export const SLOT_GRANULARITY_MIN = 15;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type DayKey = "sun" | "mon" | "tue" | "wed" | "thu" | "fri" | "sat";

/** ["09:00","17:00"] — a wall-clock working interval in the location's tz. */
export type Interval = [string, string];

/** {mon:[["09:00","17:00"]], ...}. Matches Schedule.weekly / Location.weeklyHours. */
export type WeeklyHours = Partial<Record<DayKey, Interval[]>>;

/**
 * A date-specific override (maps from the ScheduleOverride model, whose Json
 * `intervals` field is exposed here as `hours`). `date` is a location-local
 * calendar date "YYYY-MM-DD".
 * - `closed: true` blocks the whole day (takes precedence).
 * - `hours` replaces the weekly template for that date (precedence over weekly).
 * - `reopen: true` makes an otherwise-blocked holiday bookable.
 */
export type ScheduleOverrideInput = {
  date: string;
  closed?: boolean;
  reopen?: boolean;
  hours?: Interval[];
};

/** Business/location-level closure (vacation etc.). Always blocks the date. */
export type ClosureInput = { date: string; reason?: string };

/** A US federal holiday: local calendar date + name. */
export type Holiday = { date: string; name: string };

/** An existing appointment as an absolute instant range (UTC). */
export type ExistingAppointment = { start: Date | string; end: Date | string };

/** An open bookable slot as absolute instants. */
export type Slot = { start: Date; end: Date };

/** Inclusive location-local calendar-date range "YYYY-MM-DD". */
export type DateRange = { start: string; end: string };

export type ComputeOpenSlotsArgs = {
  /** Staff schedule template (the user's regular weekly availability). */
  weekly: WeeklyHours;
  /** Location open hours; the weekly template is intersected with these. */
  locationHours?: WeeklyHours;
  /** Date-specific overrides. */
  overrides?: ScheduleOverrideInput[];
  /** US federal holidays. Defaults to HOLIDAYS_2026_2028. */
  holidays?: Holiday[];
  /** Business/location closures (always block). */
  closures?: ClosureInput[];
  /** Existing appointments to never double-book (buffer-aware). */
  existingAppointments?: ExistingAppointment[];
  /** Service duration in minutes. */
  durationMin: number;
  /** Buffer minutes required before AND after each appointment. */
  bufferMin?: number;
  /** Location IANA timezone, e.g. "America/New_York". */
  timezone: string;
  /** Inclusive local calendar-date range to generate slots for. */
  dateRange: DateRange;
  /** Step between candidate starts (default SLOT_GRANULARITY_MIN). */
  slotStepMin?: number;
};

// ---------------------------------------------------------------------------
// US Federal Holidays 2026–2028 (actual dates; in-lieu weekend observance is
// intentionally NOT applied — bookable days are driven by the schedule, and a
// ScheduleOverride with reopen:true unblocks any of these).
// ---------------------------------------------------------------------------

export const HOLIDAYS_2026_2028: Holiday[] = [
  // 2026
  { date: "2026-01-01", name: "New Year's Day" },
  { date: "2026-01-19", name: "Martin Luther King Jr. Day" },
  { date: "2026-02-16", name: "Washington's Birthday" },
  { date: "2026-05-25", name: "Memorial Day" },
  { date: "2026-06-19", name: "Juneteenth" },
  { date: "2026-07-04", name: "Independence Day" },
  { date: "2026-09-07", name: "Labor Day" },
  { date: "2026-10-12", name: "Columbus Day" },
  { date: "2026-11-11", name: "Veterans Day" },
  { date: "2026-11-26", name: "Thanksgiving Day" },
  { date: "2026-12-25", name: "Christmas Day" },
  // 2027
  { date: "2027-01-01", name: "New Year's Day" },
  { date: "2027-01-18", name: "Martin Luther King Jr. Day" },
  { date: "2027-02-15", name: "Washington's Birthday" },
  { date: "2027-05-31", name: "Memorial Day" },
  { date: "2027-06-19", name: "Juneteenth" },
  { date: "2027-07-04", name: "Independence Day" },
  { date: "2027-09-06", name: "Labor Day" },
  { date: "2027-10-11", name: "Columbus Day" },
  { date: "2027-11-11", name: "Veterans Day" },
  { date: "2027-11-25", name: "Thanksgiving Day" },
  { date: "2027-12-25", name: "Christmas Day" },
  // 2028
  { date: "2028-01-01", name: "New Year's Day" },
  { date: "2028-01-17", name: "Martin Luther King Jr. Day" },
  { date: "2028-02-21", name: "Washington's Birthday" },
  { date: "2028-05-29", name: "Memorial Day" },
  { date: "2028-06-19", name: "Juneteenth" },
  { date: "2028-07-04", name: "Independence Day" },
  { date: "2028-09-04", name: "Labor Day" },
  { date: "2028-10-09", name: "Columbus Day" },
  { date: "2028-11-11", name: "Veterans Day" },
  { date: "2028-11-23", name: "Thanksgiving Day" },
  { date: "2028-12-25", name: "Christmas Day" },
];

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

const DAY_KEYS: DayKey[] = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];

/** "HH:mm" -> minutes since midnight. */
function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}

/** minutes since midnight -> "HH:mm". */
function toHhmm(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/** Weekday key for a "YYYY-MM-DD" calendar date (tz-independent). */
function dayKeyOf(dateStr: string): DayKey {
  // Noon UTC keeps us clear of any DST edge; the calendar date is what matters.
  const d = new Date(`${dateStr}T12:00:00Z`);
  return DAY_KEYS[d.getUTCDay()];
}

/** Inclusive list of "YYYY-MM-DD" between range.start and range.end. */
function eachDate(range: DateRange): string[] {
  const out: string[] = [];
  const start = new Date(`${range.start}T00:00:00Z`);
  const end = new Date(`${range.end}T00:00:00Z`);
  for (let t = start.getTime(); t <= end.getTime(); t += 86_400_000) {
    out.push(new Date(t).toISOString().slice(0, 10));
  }
  return out;
}

/** Intersect two sets of wall-clock intervals (minute ranges). */
function intersectIntervals(a: Interval[], b: Interval[]): Interval[] {
  const out: Interval[] = [];
  for (const [as, ae] of a) {
    const a0 = toMinutes(as);
    const a1 = toMinutes(ae);
    for (const [bs, be] of b) {
      const lo = Math.max(a0, toMinutes(bs));
      const hi = Math.min(a1, toMinutes(be));
      if (hi > lo) out.push([toHhmm(lo), toHhmm(hi)]);
    }
  }
  return out;
}

/** Absolute instant for a local wall-clock time on a given date, in `tz`. */
function instantAt(dateStr: string, minutes: number, tz: string): Date {
  return fromZonedTime(`${dateStr}T${toHhmm(minutes)}:00`, tz);
}

// ---------------------------------------------------------------------------
// Core
// ---------------------------------------------------------------------------

/**
 * Compute open, bookable slots for one staff member at one location over a
 * calendar-date range.
 *
 * @returns slots sorted ascending by start; each `{ start, end }` is an absolute
 *   UTC instant pair whose wall-clock representation in `timezone` is the booked
 *   window. Never overlaps an existing appointment (buffer-aware) and never
 *   lands on a blocked date.
 */
export function computeOpenSlots(args: ComputeOpenSlotsArgs): Slot[] {
  const {
    weekly,
    locationHours,
    overrides = [],
    holidays = HOLIDAYS_2026_2028,
    closures = [],
    existingAppointments = [],
    durationMin,
    bufferMin = 0,
    timezone,
    dateRange,
    slotStepMin = SLOT_GRANULARITY_MIN,
  } = args;

  if (durationMin <= 0) return [];

  const holidayDates = new Set(holidays.map((h) => h.date));
  const closureDates = new Set(closures.map((c) => c.date));
  const overrideByDate = new Map<string, ScheduleOverrideInput>();
  for (const o of overrides) overrideByDate.set(o.date, o);

  // Precompute buffered busy ranges (in ms) for conflict checks.
  const busy = existingAppointments.map((a) => ({
    start: new Date(a.start).getTime(),
    end: new Date(a.end).getTime(),
  }));
  const bufferMs = bufferMin * 60_000;
  const durationMs = durationMin * 60_000;
  const stepMs = slotStepMin * 60_000;

  const conflicts = (startMs: number, endMs: number): boolean => {
    // Two appointments need a `bufferMin` gap. Slot [s,e] conflicts with busy
    // [bs,be] unless it clears the buffer on both sides.
    for (const b of busy) {
      if (startMs < b.end + bufferMs && b.start < endMs + bufferMs) return true;
    }
    return false;
  };

  const slots: Slot[] = [];

  for (const dateStr of eachDate(dateRange)) {
    // Closures always block, no reopen concept.
    if (closureDates.has(dateStr)) continue;

    const override = overrideByDate.get(dateStr);

    // Explicit day-off override wins over everything else.
    if (override?.closed) continue;

    // Holidays block unless explicitly reopened for this date.
    if (holidayDates.has(dateStr) && !override?.reopen) continue;

    // Determine the working intervals for this date.
    let intervals: Interval[];
    if (override?.hours && override.hours.length > 0) {
      // Date-specific hours are an explicit authorization: used as-is (they may
      // legitimately extend beyond the regular location hours).
      intervals = override.hours;
    } else {
      const base = weekly[dayKeyOf(dateStr)] ?? [];
      intervals = locationHours
        ? intersectIntervals(base, locationHours[dayKeyOf(dateStr)] ?? [])
        : base;
    }

    if (intervals.length === 0) continue;

    for (const [openStr, closeStr] of intervals) {
      const openInstant = instantAt(dateStr, toMinutes(openStr), timezone).getTime();
      const closeInstant = instantAt(dateStr, toMinutes(closeStr), timezone).getTime();

      // Step by REAL elapsed minutes so DST transitions are handled correctly.
      for (let s = openInstant; s + durationMs <= closeInstant; s += stepMs) {
        const e = s + durationMs;
        if (conflicts(s, e)) continue;
        slots.push({ start: new Date(s), end: new Date(e) });
      }
    }
  }

  slots.sort((a, b) => a.start.getTime() - b.start.getTime());
  return slots;
}
