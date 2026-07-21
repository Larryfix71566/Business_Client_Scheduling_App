/**
 * branding-contrast.ts — PURE color/contrast helpers (Phase 8).
 *
 * Deliberately dependency-free (no node built-ins, no Prisma) so it is safe to
 * import from client components (the branding editor's live contrast warning) as
 * well as from server code and unit tests. `branding.ts` re-exports these.
 */

/** Parse "#rgb" / "#rrggbb" into 0–255 channels, or null if unparseable. */
export function parseHexColor(hex: string): { r: number; g: number; b: number } | null {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  let h = m[1];
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  const n = parseInt(h, 16);
  return { r: (n >> 16) & 0xff, g: (n >> 8) & 0xff, b: n & 0xff };
}

/** WCAG relative luminance of a hex color (0 = black, 1 = white). */
export function relativeLuminance(hex: string): number {
  const c = parseHexColor(hex);
  if (!c) return 0;
  const chan = (v: number) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * chan(c.r) + 0.7152 * chan(c.g) + 0.0722 * chan(c.b);
}

/** WCAG contrast ratio between two hex colors (1–21). */
export function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const light = Math.max(la, lb);
  const dark = Math.min(la, lb);
  return (light + 0.05) / (dark + 0.05);
}

/** WCAG AA threshold for normal-size text. */
export const AA_NORMAL_TEXT = 4.5;

/**
 * True when white text on `primaryColor` fails WCAG AA for normal text — i.e.
 * the chosen primary is too light to carry white button/header text. Used to
 * warn (not block) in the branding editor; user-chosen colors are their call.
 */
export function isLowContrastOnWhite(primaryColor: string): boolean {
  return contrastRatio(primaryColor, "#ffffff") < AA_NORMAL_TEXT;
}
