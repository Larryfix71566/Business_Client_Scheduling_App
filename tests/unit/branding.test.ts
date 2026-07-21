import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomBytes } from "node:crypto";
import { prisma } from "@/lib/db";
import {
  resolveBranding,
  DEFAULT_PRIMARY,
  DEFAULT_ACCENT,
  isLowContrastOnWhite,
  contrastRatio,
  relativeLuminance,
  parseHexColor,
} from "@/lib/branding";

// ---------------------------------------------------------------------------
// Pure contrast-check function (no DB)
// ---------------------------------------------------------------------------

describe("contrast check (pure)", () => {
  it("parses #rgb and #rrggbb", () => {
    expect(parseHexColor("#fff")).toEqual({ r: 255, g: 255, b: 255 });
    expect(parseHexColor("#000000")).toEqual({ r: 0, g: 0, b: 0 });
    expect(parseHexColor("1a1a2e")).toEqual({ r: 26, g: 26, b: 46 });
    expect(parseHexColor("nope")).toBeNull();
  });

  it("computes relative luminance endpoints", () => {
    expect(relativeLuminance("#000000")).toBeCloseTo(0, 5);
    expect(relativeLuminance("#ffffff")).toBeCloseTo(1, 5);
  });

  it("black on white is the maximum contrast ratio (~21)", () => {
    expect(contrastRatio("#000000", "#ffffff")).toBeCloseTo(21, 0);
  });

  it("flags a known-failing light color as low contrast on white", () => {
    // Yellow: white text fails WCAG AA badly.
    expect(isLowContrastOnWhite("#ffff00")).toBe(true);
    // Light gray: also fails.
    expect(isLowContrastOnWhite("#dddddd")).toBe(true);
  });

  it("passes a known-good dark color (the default primary)", () => {
    expect(isLowContrastOnWhite(DEFAULT_PRIMARY)).toBe(false);
    expect(isLowContrastOnWhite("#000000")).toBe(false);
    expect(isLowContrastOnWhite("#0f766e")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// resolveBranding precedence + tenant isolation (DB-backed)
// ---------------------------------------------------------------------------

const suffix = randomBytes(4).toString("hex");

let bizA: { id: string };
let bizB: { id: string };
let userWithBrand: { id: string };
let userNoBrand: { id: string };
let locWithBrand: { id: string };
let locNoBrand: { id: string };
let brandBizA: { id: string };
let userBcross: { id: string };

const P_USER = "#333333";
const P_LOC = "#222222";
const P_BIZ = "#111111";

beforeAll(async () => {
  bizA = await prisma.business.create({ data: { slug: `brand-a-${suffix}`, name: "Brand A" } });
  bizB = await prisma.business.create({ data: { slug: `brand-b-${suffix}`, name: "Brand B" } });

  // Business-level branding for A.
  brandBizA = await prisma.branding.create({
    data: { businessId: bizA.id, primaryColor: P_BIZ, accentColor: "#aaaaaa" },
  });
  await prisma.business.update({ where: { id: bizA.id }, data: { brandingId: brandBizA.id } });

  // Location branding for A.
  const brandLoc = await prisma.branding.create({
    data: { businessId: bizA.id, primaryColor: P_LOC, accentColor: "#bbbbbb" },
  });
  locWithBrand = await prisma.location.create({
    data: {
      businessId: bizA.id,
      name: "Loc Branded",
      address: "1 St",
      weeklyHours: {},
      brandingId: brandLoc.id,
    },
  });
  locNoBrand = await prisma.location.create({
    data: { businessId: bizA.id, name: "Loc Plain", address: "2 St", weeklyHours: {} },
  });

  // User branding for A.
  const brandUser = await prisma.branding.create({
    data: { businessId: bizA.id, primaryColor: P_USER, accentColor: "#cccccc" },
  });
  userWithBrand = await prisma.user.create({
    data: {
      businessId: bizA.id,
      role: "USER",
      email: `u1-${suffix}@t.test`,
      name: "U1",
      passwordHash: "x",
      brandingId: brandUser.id,
    },
  });
  userNoBrand = await prisma.user.create({
    data: { businessId: bizA.id, role: "USER", email: `u2-${suffix}@t.test`, name: "U2", passwordHash: "x" },
  });

  // Cross-tenant attack: a Business-B user whose brandingId points at a
  // Business-A branding row. Tenant scoping must refuse to resolve it.
  userBcross = await prisma.user.create({
    data: {
      businessId: bizB.id,
      role: "USER",
      email: `ub-${suffix}@t.test`,
      name: "UB",
      passwordHash: "x",
      brandingId: brandBizA.id, // belongs to bizA!
    },
  });
});

afterAll(async () => {
  await prisma.user.deleteMany({ where: { businessId: { in: [bizA.id, bizB.id] } } });
  await prisma.location.deleteMany({ where: { businessId: { in: [bizA.id, bizB.id] } } });
  await prisma.branding.deleteMany({ where: { businessId: { in: [bizA.id, bizB.id] } } });
  await prisma.business.deleteMany({ where: { id: { in: [bizA.id, bizB.id] } } });
  await prisma.$disconnect();
});

describe("resolveBranding precedence (user → location → business → defaults)", () => {
  it("user branding wins over location and business", async () => {
    const b = await resolveBranding(bizA.id, {
      userId: userWithBrand.id,
      locationId: locWithBrand.id,
    });
    expect(b.primaryColor).toBe(P_USER);
  });

  it("falls through to location when the user has none", async () => {
    const b = await resolveBranding(bizA.id, {
      userId: userNoBrand.id,
      locationId: locWithBrand.id,
    });
    expect(b.primaryColor).toBe(P_LOC);
  });

  it("falls through to business when neither user nor location has branding", async () => {
    const b = await resolveBranding(bizA.id, {
      userId: userNoBrand.id,
      locationId: locNoBrand.id,
    });
    expect(b.primaryColor).toBe(P_BIZ);
  });

  it("returns defaults when nothing is set anywhere", async () => {
    const b = await resolveBranding(bizB.id);
    expect(b.primaryColor).toBe(DEFAULT_PRIMARY);
    expect(b.accentColor).toBe(DEFAULT_ACCENT);
  });
});

describe("resolveBranding tenant isolation", () => {
  it("a Business-A branding row never resolves for a Business-B request", async () => {
    // userBcross.brandingId points at a Business-A branding row; scoping to
    // bizB must not find it → falls through to bizB (no branding) → defaults.
    const b = await resolveBranding(bizB.id, { userId: userBcross.id });
    expect(b.primaryColor).toBe(DEFAULT_PRIMARY);
    expect(b.primaryColor).not.toBe(P_BIZ);
  });
});
