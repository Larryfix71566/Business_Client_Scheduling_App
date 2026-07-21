import { describe, it, expect } from "vitest";
import { partitionSlots, bookingInputSchema } from "@/lib/booking";
import type { Slot } from "@/lib/slots";

function slot(iso: string): Slot {
  const start = new Date(iso);
  return { start, end: new Date(start.getTime() + 30 * 60_000) };
}

describe("partitionSlots", () => {
  const a = slot("2026-07-13T13:00:00Z");
  const b = slot("2026-07-13T13:30:00Z");
  const c = slot("2026-07-13T14:00:00Z");

  it("marks candidates absent from the open set as taken", () => {
    const cells = partitionSlots([a, b, c], [a, c]); // b is booked
    expect(cells.map((x) => x.taken)).toEqual([false, true, false]);
  });

  it("marks every candidate open when nothing is booked", () => {
    const cells = partitionSlots([a, b, c], [a, b, c]);
    expect(cells.every((x) => !x.taken)).toBe(true);
  });

  it("marks every candidate taken when none are open", () => {
    const cells = partitionSlots([a, b, c], []);
    expect(cells.every((x) => x.taken)).toBe(true);
  });

  it("preserves the candidate order and boundaries", () => {
    const cells = partitionSlots([a, b], [a, b]);
    expect(cells[0].start.getTime()).toBe(a.start.getTime());
    expect(cells[1].end.getTime()).toBe(b.end.getTime());
  });
});

describe("bookingInputSchema", () => {
  const base = {
    businessSlug: "acme-styling",
    locationId: "loc1",
    userId: "u1",
    serviceId: "s1",
    startIso: "2026-07-13T13:00:00.000Z",
    firstName: "Test",
    lastName: "Customer",
    phone: "+15551234567",
  };

  it("accepts a valid booking with optional fields omitted", () => {
    const parsed = bookingInputSchema.parse(base);
    expect(parsed.email).toBeUndefined();
    expect(parsed.notes).toBeUndefined();
  });

  it("coerces empty-string email/notes to undefined", () => {
    const parsed = bookingInputSchema.parse({ ...base, email: "", notes: "" });
    expect(parsed.email).toBeUndefined();
    expect(parsed.notes).toBeUndefined();
  });

  it("rejects a missing phone", () => {
    expect(() => bookingInputSchema.parse({ ...base, phone: "" })).toThrow();
  });

  it("rejects a bad phone", () => {
    expect(() => bookingInputSchema.parse({ ...base, phone: "abc" })).toThrow();
  });

  it("rejects an invalid email when provided", () => {
    expect(() => bookingInputSchema.parse({ ...base, email: "not-an-email" })).toThrow();
  });

  it("rejects a blank first name", () => {
    expect(() => bookingInputSchema.parse({ ...base, firstName: "  " })).toThrow();
  });
});
