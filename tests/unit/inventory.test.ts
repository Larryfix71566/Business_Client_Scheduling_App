import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomBytes } from "node:crypto";
import { prisma } from "@/lib/db";
import type { TenantContext } from "@/lib/tenant";
import {
  applyDelta,
  isLowStock,
  resolveOwner,
  createItem,
  updateItem,
  adjustStock,
  getInventoryPageData,
} from "@/lib/inventory";

// ---------------------------------------------------------------------------
// Pure functions (no DB)
// ---------------------------------------------------------------------------

describe("applyDelta", () => {
  it("adds a positive delta", () => {
    expect(applyDelta(10, 5)).toBe(15);
  });
  it("subtracts a negative delta", () => {
    expect(applyDelta(10, -4)).toBe(6);
  });
  it("can reach exactly zero", () => {
    expect(applyDelta(3, -3)).toBe(0);
  });
  it("can go negative (guarded by callers, not the pure fn)", () => {
    expect(applyDelta(2, -5)).toBe(-3);
  });
});

describe("isLowStock", () => {
  it("is low below the threshold", () => {
    expect(isLowStock(2, 5)).toBe(true);
  });
  it("is low exactly at the threshold", () => {
    expect(isLowStock(5, 5)).toBe(true);
  });
  it("is not low above the threshold", () => {
    expect(isLowStock(6, 5)).toBe(false);
  });
  it("treats zero qty as low when threshold is zero", () => {
    expect(isLowStock(0, 0)).toBe(true);
  });
  it("treats negative qty as low", () => {
    expect(isLowStock(-1, 0)).toBe(true);
  });
});

describe("resolveOwner (exactly one owner)", () => {
  it("resolves a location owner", () => {
    expect(resolveOwner({ locationId: "loc1" })).toEqual({ kind: "location", locationId: "loc1" });
  });
  it("resolves a user owner", () => {
    expect(resolveOwner({ userId: "u1" })).toEqual({ kind: "user", userId: "u1" });
  });
  it("throws when both owners are set", () => {
    expect(() => resolveOwner({ locationId: "loc1", userId: "u1" })).toThrow();
  });
  it("throws when no owner is set", () => {
    expect(() => resolveOwner({})).toThrow();
  });
  it("ignores empty-string owners as unset", () => {
    expect(() => resolveOwner({ locationId: "", userId: "" })).toThrow();
  });
});

// ---------------------------------------------------------------------------
// DB-backed tenant + ownership isolation
// ---------------------------------------------------------------------------

const suffix = randomBytes(4).toString("hex");
let bizA: { id: string };
let bizB: { id: string };
let loc1: { id: string };
let loc2: { id: string };
let user1: { id: string };
let user2: { id: string };
let userB: { id: string };
let item1Own: { id: string }; // user1-owned
let item2Own: { id: string }; // user2-owned
let itemShared1: { id: string }; // shared at loc1
let itemShared2: { id: string }; // shared at loc2 (user1 not assigned)
let itemB: { id: string }; // biz B item
let ctx1: TenantContext; // USER in bizA at loc1
let ctxB: TenantContext; // ADMIN in bizB

beforeAll(async () => {
  bizA = await prisma.business.create({ data: { slug: `inv-a-${suffix}`, name: "Inv A" } });
  bizB = await prisma.business.create({ data: { slug: `inv-b-${suffix}`, name: "Inv B" } });

  loc1 = await prisma.location.create({
    data: { businessId: bizA.id, name: "L1", address: "x", weeklyHours: {} },
  });
  loc2 = await prisma.location.create({
    data: { businessId: bizA.id, name: "L2", address: "y", weeklyHours: {} },
  });

  user1 = await prisma.user.create({
    data: { businessId: bizA.id, role: "USER", email: `u1-${suffix}@t.test`, name: "U1", passwordHash: "x" },
  });
  user2 = await prisma.user.create({
    data: { businessId: bizA.id, role: "USER", email: `u2-${suffix}@t.test`, name: "U2", passwordHash: "x" },
  });
  userB = await prisma.user.create({
    data: { businessId: bizB.id, role: "ADMIN", email: `ub-${suffix}@t.test`, name: "UB", passwordHash: "x" },
  });

  // user1 is assigned to loc1 only.
  await prisma.userLocation.create({
    data: { businessId: bizA.id, userId: user1.id, locationId: loc1.id },
  });
  await prisma.userLocation.create({
    data: { businessId: bizA.id, userId: user2.id, locationId: loc2.id },
  });

  item1Own = await prisma.inventoryItem.create({
    data: { businessId: bizA.id, userId: user1.id, name: "U1 Serum", costCents: 100, priceCents: 500, qtyOnHand: 10, lowStockAt: 3 },
  });
  item2Own = await prisma.inventoryItem.create({
    data: { businessId: bizA.id, userId: user2.id, name: "U2 Oil", costCents: 100, priceCents: 500, qtyOnHand: 10, lowStockAt: 3 },
  });
  itemShared1 = await prisma.inventoryItem.create({
    data: { businessId: bizA.id, locationId: loc1.id, name: "Loc1 Towels", costCents: 100, priceCents: 0, qtyOnHand: 10, lowStockAt: 3 },
  });
  itemShared2 = await prisma.inventoryItem.create({
    data: { businessId: bizA.id, locationId: loc2.id, name: "Loc2 Towels", costCents: 100, priceCents: 0, qtyOnHand: 10, lowStockAt: 3 },
  });
  itemB = await prisma.inventoryItem.create({
    data: { businessId: bizB.id, locationId: null, userId: userB.id, name: "B Item", costCents: 100, priceCents: 500, qtyOnHand: 10, lowStockAt: 3 },
  });

  ctx1 = { businessId: bizA.id, userId: user1.id, role: "USER" };
  ctxB = { businessId: bizB.id, userId: userB.id, role: "ADMIN" };
});

afterAll(async () => {
  await prisma.stockAdjustment.deleteMany({ where: { businessId: { in: [bizA.id, bizB.id] } } });
  await prisma.inventoryItem.deleteMany({ where: { businessId: { in: [bizA.id, bizB.id] } } });
  await prisma.userLocation.deleteMany({ where: { businessId: { in: [bizA.id, bizB.id] } } });
  await prisma.user.deleteMany({ where: { businessId: { in: [bizA.id, bizB.id] } } });
  await prisma.location.deleteMany({ where: { businessId: { in: [bizA.id, bizB.id] } } });
  await prisma.business.deleteMany({ where: { id: { in: [bizA.id, bizB.id] } } });
  await prisma.$disconnect();
});

describe("inventory ownership + tenant isolation", () => {
  it("USER sees own item + shared stock at their location, not other users' items", async () => {
    const data = await getInventoryPageData(ctx1);
    const names = data.items.map((i) => i.name).sort();
    expect(names).toEqual(["Loc1 Towels", "U1 Serum"]);
    // shared item at unassigned loc2 and user2's own item are invisible
    expect(names).not.toContain("Loc2 Towels");
    expect(names).not.toContain("U2 Oil");
  });

  it("USER can adjust their own item (atomic qty + adjustment row)", async () => {
    const before = await prisma.stockAdjustment.count({ where: { itemId: item1Own.id } });
    const res = await adjustStock(ctx1, { itemId: item1Own.id, delta: -8, reason: "SOLD" });
    expect(res.qtyOnHand).toBe(2);
    expect(res.lowStock).toBe(true);
    const after = await prisma.stockAdjustment.count({ where: { itemId: item1Own.id } });
    expect(after).toBe(before + 1);
    const item = await prisma.inventoryItem.findUnique({ where: { id: item1Own.id } });
    expect(item?.qtyOnHand).toBe(2);
  });

  it("USER can adjust shared stock at their assigned location", async () => {
    const res = await adjustStock(ctx1, { itemId: itemShared1.id, delta: 5, reason: "RECEIVED" });
    expect(res.qtyOnHand).toBe(15);
  });

  it("USER cannot adjust shared stock at a location they are not assigned to", async () => {
    await expect(adjustStock(ctx1, { itemId: itemShared2.id, delta: 1, reason: "RECEIVED" })).rejects.toThrow();
  });

  it("USER cannot edit another user's own item", async () => {
    await expect(
      updateItem(ctx1, { id: item2Own.id, name: "HACKED", costCents: 1, priceCents: 1, lowStockAt: 0 }),
    ).rejects.toThrow();
    const still = await prisma.inventoryItem.findUnique({ where: { id: item2Own.id } });
    expect(still?.name).toBe("U2 Oil");
  });

  it("USER cannot create a shared location item", async () => {
    await expect(
      createItem(ctx1, { name: "Sneaky", costCents: 1, priceCents: 1, locationId: loc1.id }),
    ).rejects.toThrow();
  });

  it("cross-tenant: a session cannot adjust another business's item", async () => {
    await expect(adjustStock(ctx1, { itemId: itemB.id, delta: 1, reason: "RECEIVED" })).rejects.toThrow();
    // and the reverse
    await expect(adjustStock(ctxB, { itemId: item1Own.id, delta: 1, reason: "RECEIVED" })).rejects.toThrow();
    const still = await prisma.inventoryItem.findUnique({ where: { id: itemB.id } });
    expect(still?.qtyOnHand).toBe(10);
  });
});
