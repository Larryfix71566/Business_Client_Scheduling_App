import { describe, it, expect } from "vitest";
import { formatCents, addCents, applyTaxBps } from "@/lib/money";

describe("formatCents", () => {
  it("formats cents as USD", () => {
    expect(formatCents(12345)).toBe("$123.45");
    expect(formatCents(0)).toBe("$0.00");
    expect(formatCents(5)).toBe("$0.05");
    expect(formatCents(100000)).toBe("$1,000.00");
  });

  it("throws on non-integer cents", () => {
    expect(() => formatCents(12.5)).toThrow();
  });
});

describe("addCents", () => {
  it("sums integer amounts", () => {
    expect(addCents(100, 200, 50)).toBe(350);
    expect(addCents()).toBe(0);
  });

  it("throws on non-integer input", () => {
    expect(() => addCents(100, 0.5)).toThrow();
  });
});

describe("applyTaxBps", () => {
  it("applies basis-point tax with half-up rounding", () => {
    expect(applyTaxBps(10000, 825)).toBe(825); // 8.25% of $100.00
    expect(applyTaxBps(10000, 0)).toBe(0);
    expect(applyTaxBps(0, 825)).toBe(0);
    // 8.25% of $1.00 = 8.25c -> rounds to 8
    expect(applyTaxBps(100, 825)).toBe(8);
    // 5% of $9.99 = 49.95c -> rounds to 50
    expect(applyTaxBps(999, 500)).toBe(50);
  });

  it("throws on non-integer inputs", () => {
    expect(() => applyTaxBps(100.5, 825)).toThrow();
    expect(() => applyTaxBps(100, 8.25)).toThrow();
  });
});
