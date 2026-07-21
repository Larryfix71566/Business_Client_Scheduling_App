import { describe, it, expect } from "vitest";
import {
  computeOpenSlots,
  HOLIDAYS_2026_2028,
  SLOT_GRANULARITY_MIN,
  type WeeklyHours,
} from "@/lib/slots";

// Mon–Fri 09:00–17:00 template used by many cases.
const WEEKDAYS_9_5: WeeklyHours = {
  mon: [["09:00", "17:00"]],
  tue: [["09:00", "17:00"]],
  wed: [["09:00", "17:00"]],
  thu: [["09:00", "17:00"]],
  fri: [["09:00", "17:00"]],
  sat: [],
  sun: [],
};

const NY = "America/New_York";

// A single weekday, open 09:00–17:00, for a given date.
function oneDay(date: string, extra: Partial<Parameters<typeof computeOpenSlots>[0]> = {}) {
  return computeOpenSlots({
    weekly: WEEKDAYS_9_5,
    timezone: NY,
    durationMin: 60,
    slotStepMin: 60,
    dateRange: { start: date, end: date },
    ...extra,
  });
}

describe("computeOpenSlots", () => {
  // ---- 1. Holiday blocked -------------------------------------------------
  it("blocks bookings on a US federal holiday", () => {
    // 2026-01-01 (New Year's Day) is a Thursday — normally open.
    const slots = oneDay("2026-01-01");
    expect(slots).toHaveLength(0);
  });

  // ---- 2. Holiday reopened via override ----------------------------------
  it("allows bookings on a holiday when an override reopens it", () => {
    const slots = oneDay("2026-01-01", {
      overrides: [{ date: "2026-01-01", reopen: true }],
    });
    // Thursday 09:00–17:00, 60-min slots, 60-min step => 8 slots.
    expect(slots).toHaveLength(8);
  });

  // ---- 3. Override closure (day off) -------------------------------------
  it("blocks a normally-open day closed by an override", () => {
    // 2026-07-06 is a Monday, not a holiday.
    const slots = oneDay("2026-07-06", {
      overrides: [{ date: "2026-07-06", closed: true }],
    });
    expect(slots).toHaveLength(0);
  });

  // ---- 4. Buffer time causes overlap rejection ---------------------------
  it("rejects a slot whose buffer overlaps an existing appointment", () => {
    // Appt 10:00–11:00 local (14:00–15:00Z in July EDT), 15-min buffer.
    const appt = {
      start: "2026-07-06T14:00:00Z",
      end: "2026-07-06T15:00:00Z",
    };
    const slots = oneDay("2026-07-06", {
      bufferMin: 15,
      slotStepMin: 30,
      existingAppointments: [appt],
    });
    const locals = slots.map((s) => s.start.toISOString());
    // 09:30 slot (ends 10:30Z... i.e. 13:30-14:30Z) ends at 10:30 local which is
    // within 15 min of the 10:00 appointment => rejected.
    expect(locals).not.toContain("2026-07-06T13:30:00.000Z"); // 09:30 local
    // 09:00 slot ends 10:00 local; needs 15-min gap before 10:00 appt -> blocked.
    expect(locals).not.toContain("2026-07-06T13:00:00.000Z"); // 09:00 local
    // 08:xx impossible (opens 09:00). First valid start after the appt+buffer:
    // 11:00 appt end + 15 buffer = 11:15; 30-min grid => 11:30 local = 15:30Z.
    expect(locals).toContain("2026-07-06T15:30:00.000Z");
  });

  it("allows an adjacent slot when the buffer gap is exactly satisfied", () => {
    // Appt 10:00–11:00 local, buffer 0 => a slot ending exactly at 10:00 is fine.
    const slots = oneDay("2026-07-06", {
      bufferMin: 0,
      slotStepMin: 60,
      existingAppointments: [
        { start: "2026-07-06T14:00:00Z", end: "2026-07-06T15:00:00Z" },
      ],
    });
    const locals = slots.map((s) => s.start.toISOString());
    expect(locals).toContain("2026-07-06T13:00:00.000Z"); // 09:00–10:00 local
    expect(locals).not.toContain("2026-07-06T14:00:00.000Z"); // 10:00 taken
  });

  // ---- 5. DST spring-forward date ----------------------------------------
  it("loses an hour of real availability on the spring-forward day", () => {
    // 2026-03-08: clocks jump 02:00 -> 03:00 in America/New_York.
    // Window 00:00–05:00 wall-clock is only 4 real hours that day.
    const slots = computeOpenSlots({
      weekly: { sun: [["00:00", "05:00"]] },
      timezone: NY,
      durationMin: 60,
      slotStepMin: 60,
      // Not a holiday; Sunday. Use only the weekly template.
      holidays: [],
      dateRange: { start: "2026-03-08", end: "2026-03-08" },
    });
    // 4 real hours / 60-min slots => 4 slots (a naive wall-clock count says 5).
    expect(slots).toHaveLength(4);
    // First slot: 00:00 EST = 05:00Z.
    expect(slots[0].start.toISOString()).toBe("2026-03-08T05:00:00.000Z");
  });

  // ---- 6. DST fall-back date ---------------------------------------------
  it("gains an hour of real availability on the fall-back day", () => {
    // 2026-11-01: clocks fall 02:00 -> 01:00 in America/New_York.
    const slots = computeOpenSlots({
      weekly: { sun: [["00:00", "05:00"]] },
      timezone: NY,
      durationMin: 60,
      slotStepMin: 60,
      holidays: [],
      dateRange: { start: "2026-11-01", end: "2026-11-01" },
    });
    // 6 real hours => 6 slots (naive wall-clock count says 5).
    expect(slots).toHaveLength(6);
    // First slot: 00:00 EDT = 04:00Z.
    expect(slots[0].start.toISOString()).toBe("2026-11-01T04:00:00.000Z");
  });

  // ---- 7. Appointment collision (slot already taken) ---------------------
  it("does not offer a slot that collides with an existing appointment", () => {
    const slots = oneDay("2026-07-06", {
      existingAppointments: [
        { start: "2026-07-06T13:00:00Z", end: "2026-07-06T14:00:00Z" }, // 09:00-10:00 local
      ],
    });
    const locals = slots.map((s) => s.start.toISOString());
    expect(locals).not.toContain("2026-07-06T13:00:00.000Z"); // 09:00 taken
    expect(locals).toContain("2026-07-06T14:00:00.000Z"); // 10:00 free
    expect(slots).toHaveLength(7); // 8 normally, minus the taken 09:00.
  });

  // ---- 8. Multi-interval day (morning + afternoon with a gap) ------------
  it("handles a lunch-split day as two working intervals", () => {
    const slots = computeOpenSlots({
      weekly: { mon: [["09:00", "12:00"], ["13:00", "17:00"]] },
      timezone: NY,
      durationMin: 60,
      slotStepMin: 60,
      dateRange: { start: "2026-07-06", end: "2026-07-06" },
    });
    // Morning 09,10,11 = 3; afternoon 13,14,15,16 = 4 => 7. Nothing at 12:00.
    expect(slots).toHaveLength(7);
    const locals = slots.map((s) => s.start.toISOString());
    expect(locals).not.toContain("2026-07-06T16:00:00.000Z"); // 12:00 local (lunch)
    expect(locals).toContain("2026-07-06T17:00:00.000Z"); // 13:00 local
  });

  // ---- 9. Empty day (no template) ----------------------------------------
  it("returns no slots on a day the staff member does not work", () => {
    // 2026-07-11 is a Saturday; template has sat: [].
    const slots = oneDay("2026-07-11");
    expect(slots).toHaveLength(0);
  });

  // ---- 9b. Fully-booked day ----------------------------------------------
  it("returns no slots when the whole working window is booked", () => {
    const slots = oneDay("2026-07-06", {
      existingAppointments: [
        { start: "2026-07-06T13:00:00Z", end: "2026-07-06T21:00:00Z" }, // 09:00-17:00 local
      ],
    });
    expect(slots).toHaveLength(0);
  });

  // ---- 10. Single available slot -----------------------------------------
  it("offers exactly one slot when only one fits the window", () => {
    const slots = computeOpenSlots({
      weekly: { mon: [["09:00", "10:00"]] },
      timezone: NY,
      durationMin: 60,
      slotStepMin: 60,
      dateRange: { start: "2026-07-06", end: "2026-07-06" },
    });
    expect(slots).toHaveLength(1);
    expect(slots[0].start.toISOString()).toBe("2026-07-06T13:00:00.000Z");
  });

  // ---- 11. Service duration longer than remaining window -----------------
  it("returns no slots when the service is longer than the window", () => {
    const slots = computeOpenSlots({
      weekly: { mon: [["09:00", "10:00"]] },
      timezone: NY,
      durationMin: 90,
      slotStepMin: 15,
      dateRange: { start: "2026-07-06", end: "2026-07-06" },
    });
    expect(slots).toHaveLength(0);
  });

  // ---- 12. Closure vs. holiday interaction (closure wins) ----------------
  it("keeps a date blocked by a closure even if a holiday override reopens it", () => {
    const slots = oneDay("2026-01-01", {
      overrides: [{ date: "2026-01-01", reopen: true }],
      closures: [{ date: "2026-01-01", reason: "Business vacation" }],
    });
    expect(slots).toHaveLength(0);
  });

  it("blocks a closure on a normal working day", () => {
    const slots = oneDay("2026-07-06", {
      closures: [{ date: "2026-07-06", reason: "Vacation" }],
    });
    expect(slots).toHaveLength(0);
  });

  // ---- 13. Timezone correctness ------------------------------------------
  it("maps a 09:00 location-local slot to the correct UTC instant (not 09:00Z)", () => {
    const slots = oneDay("2026-07-06"); // NY in July => EDT (UTC-4)
    expect(slots[0].start.toISOString()).toBe("2026-07-06T13:00:00.000Z");
    expect(slots[0].start.toISOString()).not.toBe("2026-07-06T09:00:00.000Z");

    // Same wall-clock hours in Los Angeles resolve to a different instant.
    const la = computeOpenSlots({
      weekly: WEEKDAYS_9_5,
      timezone: "America/Los_Angeles",
      durationMin: 60,
      slotStepMin: 60,
      dateRange: { start: "2026-07-06", end: "2026-07-06" },
    });
    expect(la[0].start.toISOString()).toBe("2026-07-06T16:00:00.000Z"); // 09:00 PDT
  });

  // ---- 14. Overrides take precedence over the weekly template ------------
  it("uses override hours in place of the weekly template for that date", () => {
    // Monday normally 09:00–17:00; override to 14:00–16:00 only.
    const slots = oneDay("2026-07-06", {
      overrides: [{ date: "2026-07-06", hours: [["14:00", "16:00"]] }],
    });
    expect(slots).toHaveLength(2); // 14:00 and 15:00
    const locals = slots.map((s) => s.start.toISOString());
    expect(locals).toContain("2026-07-06T18:00:00.000Z"); // 14:00 local
    expect(locals).not.toContain("2026-07-06T13:00:00.000Z"); // 09:00 not offered
  });

  // ---- 15. Full week generates the expected slot count -------------------
  it("generates the expected slot count across a full week", () => {
    // 2026-07-06 (Mon) through 2026-07-12 (Sun). Mon–Fri open 09–17, Sat/Sun off.
    // No holiday in this window (July 4 was the previous Saturday).
    const slots = computeOpenSlots({
      weekly: WEEKDAYS_9_5,
      timezone: NY,
      durationMin: 60,
      slotStepMin: 60,
      dateRange: { start: "2026-07-06", end: "2026-07-12" },
    });
    // 5 weekdays * 8 slots each = 40.
    expect(slots).toHaveLength(40);
    // Sorted ascending.
    for (let i = 1; i < slots.length; i++) {
      expect(slots[i].start.getTime()).toBeGreaterThanOrEqual(slots[i - 1].start.getTime());
    }
  });

  // ---- 16. Location hours constrain the staff template -------------------
  it("intersects the staff template with the location's open hours", () => {
    // Staff would work 09:00–17:00 but the location is only open 12:00–15:00.
    const slots = oneDay("2026-07-06", {
      locationHours: { mon: [["12:00", "15:00"]] },
    });
    expect(slots).toHaveLength(3); // 12,13,14 local
    const locals = slots.map((s) => s.start.toISOString());
    expect(locals).toContain("2026-07-06T16:00:00.000Z"); // 12:00 local
    expect(locals).not.toContain("2026-07-06T13:00:00.000Z"); // 09:00 (location shut)
  });

  // ---- Sanity: constant + holiday table ----------------------------------
  it("uses a 15-minute default granularity", () => {
    expect(SLOT_GRANULARITY_MIN).toBe(15);
    const slots = computeOpenSlots({
      weekly: { mon: [["09:00", "10:00"]] },
      timezone: NY,
      durationMin: 15,
      dateRange: { start: "2026-07-06", end: "2026-07-06" },
    });
    // 09:00,09:15,09:30,09:45 => 4 quarter-hour slots.
    expect(slots).toHaveLength(4);
  });

  it("hardcodes US federal holidays for 2026–2028", () => {
    const years = new Set(HOLIDAYS_2026_2028.map((h) => h.date.slice(0, 4)));
    expect([...years].sort()).toEqual(["2026", "2027", "2028"]);
    // 11 federal holidays per year * 3 years.
    expect(HOLIDAYS_2026_2028).toHaveLength(33);
  });
});
