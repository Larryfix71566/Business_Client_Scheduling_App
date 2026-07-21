// Money is ALWAYS integer cents. Never use floats for money.
// These helpers are the only place cents get formatted or combined.

/** Format integer cents as a currency string, e.g. 12345 -> "$123.45". */
export function formatCents(cents: number, currency = "USD", locale = "en-US"): string {
  if (!Number.isInteger(cents)) {
    throw new Error(`formatCents expects integer cents, got ${cents}`);
  }
  return new Intl.NumberFormat(locale, { style: "currency", currency }).format(cents / 100);
}

/** Sum any number of integer-cent amounts. Throws on non-integers. */
export function addCents(...amounts: number[]): number {
  return amounts.reduce((sum, c) => {
    if (!Number.isInteger(c)) {
      throw new Error(`addCents expects integer cents, got ${c}`);
    }
    return sum + c;
  }, 0);
}

/**
 * Apply a tax rate expressed in basis points (1% = 100 bps) to integer cents.
 * Returns the tax amount in integer cents, rounded half-up.
 * e.g. applyTaxBps(10000, 825) -> 825 (8.25% of $100.00).
 */
export function applyTaxBps(cents: number, taxRateBps: number): number {
  if (!Number.isInteger(cents)) {
    throw new Error(`applyTaxBps expects integer cents, got ${cents}`);
  }
  if (!Number.isInteger(taxRateBps)) {
    throw new Error(`applyTaxBps expects integer basis points, got ${taxRateBps}`);
  }
  return Math.round((cents * taxRateBps) / 10000);
}
