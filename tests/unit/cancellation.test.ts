import { describe, it, expect } from "vitest";
import { isWithinCancelCutoff, canSelfServe } from "@/lib/cancellation";

// Phase 4: the cutoff is a pure hours-before-start comparison on absolute UTC
// instants. `isWithinCancelCutoff` returns true when self-serve is BLOCKED
// (inside the window / already started); false when ALLOWED (strictly outside).

describe("isWithinCancelCutoff", () => {
  const now = new Date("2026-07-07T12:00:00Z");
  const CUTOFF = 24;

  it("allows well outside the cutoff (48h out)", () => {
    const start = new Date("2026-07-09T12:00:00Z"); // 48h
    expect(isWithinCancelCutoff(start, CUTOFF, now)).toBe(false);
    expect(canSelfServe(start, CUTOFF, now)).toBe(true);
  });

  it("blocks exactly at the boundary (24h out, inclusive)", () => {
    const start = new Date("2026-07-08T12:00:00Z"); // exactly 24h
    expect(isWithinCancelCutoff(start, CUTOFF, now)).toBe(true);
    expect(canSelfServe(start, CUTOFF, now)).toBe(false);
  });

  it("allows just outside the boundary (24h + 1min out)", () => {
    const start = new Date("2026-07-08T12:01:00Z"); // 24h 1m
    expect(isWithinCancelCutoff(start, CUTOFF, now)).toBe(false);
  });

  it("blocks well inside the cutoff (2h out)", () => {
    const start = new Date("2026-07-07T14:00:00Z"); // 2h
    expect(isWithinCancelCutoff(start, CUTOFF, now)).toBe(true);
  });

  it("blocks appointments already in the past", () => {
    const start = new Date("2026-07-06T12:00:00Z"); // yesterday
    expect(isWithinCancelCutoff(start, CUTOFF, now)).toBe(true);
  });

  it("honours a different cutoff (1h)", () => {
    const start = new Date("2026-07-07T14:00:00Z"); // 2h out
    expect(isWithinCancelCutoff(start, 1, now)).toBe(false); // outside a 1h window
    expect(isWithinCancelCutoff(start, 3, now)).toBe(true); // inside a 3h window
  });

  it("is timezone-independent (comparison is on absolute UTC instants)", () => {
    // Same two instants, expressed with an offset instead of Z, give the same
    // result — the location's timezone never enters the calculation.
    const start = new Date("2026-07-09T08:00:00-04:00"); // == 12:00Z, 48h out
    expect(isWithinCancelCutoff(start, CUTOFF, now)).toBe(false);
  });
});
