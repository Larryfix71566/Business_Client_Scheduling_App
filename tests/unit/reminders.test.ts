import { describe, it, expect } from "vitest";
import {
  reminderWindow,
  isDueForReminder,
  buildReminderMessage,
  REMINDER_MIN_HOURS,
  REMINDER_MAX_HOURS,
} from "@/lib/reminders";

const now = new Date("2026-07-07T12:00:00Z");
const H = 3_600_000;

describe("reminderWindow", () => {
  it("spans ~23h to ~25h out from now", () => {
    const { gte, lte } = reminderWindow(now);
    expect(gte.getTime()).toBe(now.getTime() + REMINDER_MIN_HOURS * H);
    expect(lte.getTime()).toBe(now.getTime() + REMINDER_MAX_HOURS * H);
  });
});

describe("isDueForReminder (dedup + window)", () => {
  const at = (hoursOut: number) => new Date(now.getTime() + hoursOut * H);

  it("is due for a CONFIRMED, un-reminded appt inside the window (24h)", () => {
    expect(isDueForReminder({ status: "CONFIRMED", startsAt: at(24), reminderSentAt: null }, now)).toBe(true);
  });

  it("skips one already reminded (reminderSentAt set) — dedup", () => {
    expect(
      isDueForReminder({ status: "CONFIRMED", startsAt: at(24), reminderSentAt: new Date() }, now),
    ).toBe(false);
  });

  it("skips non-CONFIRMED statuses", () => {
    for (const status of ["REQUESTED", "CANCELLED", "COMPLETED", "NO_SHOW"]) {
      expect(isDueForReminder({ status, startsAt: at(24), reminderSentAt: null }, now)).toBe(false);
    }
  });

  it("skips appts outside the window (too soon / too far)", () => {
    expect(isDueForReminder({ status: "CONFIRMED", startsAt: at(2), reminderSentAt: null }, now)).toBe(false);
    expect(isDueForReminder({ status: "CONFIRMED", startsAt: at(48), reminderSentAt: null }, now)).toBe(false);
  });

  it("includes the window boundaries (23h and 25h)", () => {
    expect(isDueForReminder({ status: "CONFIRMED", startsAt: at(23), reminderSentAt: null }, now)).toBe(true);
    expect(isDueForReminder({ status: "CONFIRMED", startsAt: at(25), reminderSentAt: null }, now)).toBe(true);
    expect(isDueForReminder({ status: "CONFIRMED", startsAt: at(22.5), reminderSentAt: null }, now)).toBe(false);
    expect(isDueForReminder({ status: "CONFIRMED", startsAt: at(25.5), reminderSentAt: null }, now)).toBe(false);
  });
});

describe("buildReminderMessage", () => {
  it("names the customer, service, and time", () => {
    const msg = buildReminderMessage("Carol", "Cut", "Wed, Jul 8 at 12:00 PM");
    expect(msg).toContain("Carol");
    expect(msg).toContain("Cut");
    expect(msg).toContain("Wed, Jul 8 at 12:00 PM");
  });
});
