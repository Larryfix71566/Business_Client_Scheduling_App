import { z } from "zod";
import type { AdjReason } from "@prisma/client";
import { prisma } from "./db";
import { tenantDb, ownershipWhere, type TenantContext } from "./tenant";
import { formatCents } from "./money";
import { getImageUrl } from "./storage";

/**
 * inventory.ts — inventory items, stock adjustments, and service→product
 * consumption links (Phase 5).
 *
 * All tenant data access goes through `tenantDb(ctx)` (guardrail #1). Ownership
 * (guardrail #2) is enforced per operation:
 *
 *   - An item is owned EITHER by a location (shared stock: `locationId` set,
 *     `userId` null) OR by a user (their own product: `userId` set, `locationId`
 *     null). Exactly one owner — enforced by the pure `resolveOwner` below.
 *   - A USER may fully CRUD their OWN user-owned items, and may ADJUST STOCK on
 *     shared items at their assigned locations. A USER may not create/edit shared
 *     items or another user's items.
 *   - An ADMIN may CRUD anything in the tenant.
 *
 * Stock adjustment writes a `StockAdjustment` row AND updates
 * `InventoryItem.qtyOnHand` in ONE transaction (via raw `prisma.$transaction` —
 * allowed here because this file lives in `src/lib`; the item is tenant-verified
 * through `tenantDb` before the write).
 */

// ---------------------------------------------------------------------------
// Pure, DB-free helpers (unit-tested without a database)
// ---------------------------------------------------------------------------

/** New on-hand quantity after applying a signed delta. */
export function applyDelta(qtyOnHand: number, delta: number): number {
  return qtyOnHand + delta;
}

/** Low-stock predicate: at or below the threshold counts as low. */
export function isLowStock(qtyOnHand: number, lowStockAt: number): boolean {
  return qtyOnHand <= lowStockAt;
}

export type OwnerRef =
  | { kind: "location"; locationId: string }
  | { kind: "user"; userId: string };

/**
 * Enforce "exactly one owner" for an item: either a location (shared) or a user
 * (own), never both, never neither. Pure and unit-tested.
 */
export function resolveOwner(input: {
  locationId?: string | null;
  userId?: string | null;
}): OwnerRef {
  const hasLocation = !!input.locationId;
  const hasUser = !!input.userId;
  if (hasLocation && hasUser) {
    throw new Error("An item cannot be owned by both a location and a user");
  }
  if (!hasLocation && !hasUser) {
    throw new Error("An item must be owned by a location or a user");
  }
  return hasLocation
    ? { kind: "location", locationId: input.locationId! }
    : { kind: "user", userId: input.userId! };
}

// ---------------------------------------------------------------------------
// Zod schemas
// ---------------------------------------------------------------------------

const cents = z.number().int().nonnegative();

export const itemInputSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    barcode: z.string().trim().max(64).optional().or(z.literal("")).transform((v) => v || undefined),
    photoPath: z.string().trim().max(256).optional().or(z.literal("")).transform((v) => v || undefined),
    costCents: cents,
    priceCents: cents,
    lowStockAt: z.number().int().nonnegative().default(0),
    qtyOnHand: z.number().int().default(0),
    // Owner: exactly one of these. For a USER, the server forces user ownership.
    locationId: z.string().min(1).optional(),
    userId: z.string().min(1).optional(),
  })
  .refine((v) => !(v.locationId && v.userId), {
    message: "An item cannot be owned by both a location and a user",
  });

export const updateItemSchema = z.object({
  id: z.string().min(1),
  name: z.string().trim().min(1).max(120),
  barcode: z.string().trim().max(64).optional().or(z.literal("")).transform((v) => v || undefined),
  photoPath: z.string().trim().max(256).optional().or(z.literal("")).transform((v) => v || undefined),
  costCents: cents,
  priceCents: cents,
  lowStockAt: z.number().int().nonnegative(),
});

export const deleteItemSchema = z.object({ id: z.string().min(1) });

export const adjustSchema = z.object({
  itemId: z.string().min(1),
  delta: z.number().int().refine((d) => d !== 0, "Delta must be non-zero"),
  reason: z.enum(["RECEIVED", "SOLD", "DAMAGED", "MANUAL"]),
});

export const serviceProductsSchema = z.object({
  serviceId: z.string().min(1),
  links: z
    .array(z.object({ itemId: z.string().min(1), qty: z.number().int().positive() }))
    .max(50),
});

// ---------------------------------------------------------------------------
// Owner / permission helpers
// ---------------------------------------------------------------------------

/** Location ids the current user is assigned to (used for shared-item scope). */
async function myLocationIds(ctx: TenantContext): Promise<string[]> {
  const db = tenantDb(ctx);
  const assignments = await db.userLocation.findMany({ where: { userId: ctx.userId } });
  return assignments.map((a: any) => a.locationId);
}

/** Can this session edit an item's metadata (name/price/etc.)? */
function canEdit(ctx: TenantContext, item: { userId: string | null }): boolean {
  if (ctx.role === "ADMIN") return true;
  // USER: only their own user-owned items.
  return item.userId === ctx.userId;
}

/** Can this session adjust stock on an item? */
function canAdjust(
  ctx: TenantContext,
  item: { userId: string | null; locationId: string | null },
  locationIds: string[],
): boolean {
  if (ctx.role === "ADMIN") return true;
  if (item.userId === ctx.userId) return true; // own product
  // shared item at one of the user's assigned locations
  return !!item.locationId && locationIds.includes(item.locationId);
}

// ---------------------------------------------------------------------------
// Read: list + single item
// ---------------------------------------------------------------------------

export type ItemRow = {
  id: string;
  name: string;
  barcode: string | null;
  photoPath: string | null;
  photoUrl: string | null;
  costCents: number;
  priceCents: number;
  costLabel: string;
  priceLabel: string;
  qtyOnHand: number;
  lowStockAt: number;
  lowStock: boolean;
  ownerType: "location" | "user";
  ownerId: string;
  ownerName: string;
  editable: boolean;
  adjustable: boolean;
};

/**
 * Where-clause for items VISIBLE to the session: ADMIN sees the whole tenant; a
 * USER sees their own user-owned items PLUS shared items at their locations.
 */
async function visibleWhere(ctx: TenantContext): Promise<Record<string, unknown>> {
  if (ctx.role === "ADMIN") return {};
  const locIds = await myLocationIds(ctx);
  return { OR: [{ userId: ctx.userId }, { locationId: { in: locIds } }] };
}

function decorateItems(
  ctx: TenantContext,
  items: any[],
  locationNames: Map<string, string>,
  userNames: Map<string, string>,
  locationIds: string[],
): ItemRow[] {
  return items.map((it) => {
    const ownerType: "location" | "user" = it.userId ? "user" : "location";
    const ownerId = it.userId ?? it.locationId ?? "";
    const ownerName =
      ownerType === "user"
        ? userNames.get(ownerId) ?? "Staff"
        : locationNames.get(ownerId) ?? "Location";
    return {
      id: it.id,
      name: it.name,
      barcode: it.barcode ?? null,
      photoPath: it.photoPath ?? null,
      photoUrl: it.photoPath ? getImageUrl(it.photoPath) : null,
      costCents: it.costCents,
      priceCents: it.priceCents,
      costLabel: formatCents(it.costCents),
      priceLabel: formatCents(it.priceCents),
      qtyOnHand: it.qtyOnHand,
      lowStockAt: it.lowStockAt,
      lowStock: isLowStock(it.qtyOnHand, it.lowStockAt),
      ownerType,
      ownerId,
      ownerName,
      editable: canEdit(ctx, it),
      adjustable: canAdjust(ctx, it, locationIds),
    };
  });
}

/** Everything the inventory page needs: visible items + owner options. */
export async function getInventoryPageData(ctx: TenantContext) {
  const db = tenantDb(ctx);
  const locIds = await myLocationIds(ctx);
  const where = await visibleWhere(ctx);

  const [items, locations, users, services] = await Promise.all([
    db.inventoryItem.findMany({ where, orderBy: { name: "asc" } }),
    db.location.findMany({ orderBy: { name: "asc" } }),
    db.user.findMany({ orderBy: { name: "asc" } }),
    db.service.findMany({ where: ownershipWhere(ctx), orderBy: { name: "asc" } }),
  ]);

  const locationNames = new Map<string, string>(locations.map((l: any) => [l.id, l.name]));
  const userNames = new Map<string, string>(users.map((u: any) => [u.id, u.name]));

  const rows = decorateItems(ctx, items, locationNames, userNames, locIds);

  // Owner options for the create form. USER can only create their OWN items;
  // ADMIN can assign to any location (shared) or any user (own).
  const myLocations = locations.filter((l: any) => locIds.includes(l.id));
  return {
    role: ctx.role,
    items: rows,
    ownerOptions: {
      locations: (ctx.role === "ADMIN" ? locations : myLocations).map((l: any) => ({
        id: l.id,
        name: l.name,
      })),
      users: (ctx.role === "ADMIN" ? users : users.filter((u: any) => u.id === ctx.userId)).map(
        (u: any) => ({ id: u.id, name: u.name }),
      ),
      canCreateShared: ctx.role === "ADMIN",
    },
    services: services.map((s: any) => ({ id: s.id, name: s.name })),
    myUserId: ctx.userId,
  };
}

// ---------------------------------------------------------------------------
// Create / update / delete
// ---------------------------------------------------------------------------

/** Verify a proposed owner exists in the tenant and the session may use it. */
async function assertOwnerAllowed(ctx: TenantContext, owner: OwnerRef): Promise<void> {
  const db = tenantDb(ctx);
  if (owner.kind === "location") {
    if (ctx.role !== "ADMIN") throw new Error("Only an admin can create shared location items");
    const loc = await db.location.findFirst({ where: { id: owner.locationId } });
    if (!loc) throw new Error("Unknown location");
  } else {
    if (ctx.role !== "ADMIN" && owner.userId !== ctx.userId) {
      throw new Error("You can only create your own items");
    }
    const user = await db.user.findFirst({ where: { id: owner.userId } });
    if (!user) throw new Error("Unknown user");
  }
}

export async function createItem(ctx: TenantContext, input: unknown) {
  const data = itemInputSchema.parse(input);
  const db = tenantDb(ctx);

  // A USER may only create their OWN user-owned item. Reject an explicit attempt
  // to create a shared/location item or one owned by someone else, rather than
  // silently reassigning ownership.
  let owner: OwnerRef;
  if (ctx.role === "ADMIN") {
    owner = resolveOwner({ locationId: data.locationId, userId: data.userId });
  } else {
    if (data.locationId) throw new Error("Only an admin can create shared location items");
    if (data.userId && data.userId !== ctx.userId) {
      throw new Error("You can only create your own items");
    }
    owner = { kind: "user", userId: ctx.userId };
  }

  await assertOwnerAllowed(ctx, owner);

  const created = await db.inventoryItem.create({
    data: {
      name: data.name,
      barcode: data.barcode ?? null,
      photoPath: data.photoPath ?? null,
      costCents: data.costCents,
      priceCents: data.priceCents,
      qtyOnHand: data.qtyOnHand ?? 0,
      lowStockAt: data.lowStockAt ?? 0,
      locationId: owner.kind === "location" ? owner.locationId : null,
      userId: owner.kind === "user" ? owner.userId : null,
    },
  });
  return { id: created.id };
}

export async function updateItem(ctx: TenantContext, input: unknown) {
  const data = updateItemSchema.parse(input);
  const db = tenantDb(ctx);

  const item = await db.inventoryItem.findFirst({ where: { id: data.id } });
  if (!item) throw new Error("Unknown item");
  if (!canEdit(ctx, item)) throw new Error("Not allowed to edit this item");

  await db.inventoryItem.update({
    where: { id: data.id },
    data: {
      name: data.name,
      barcode: data.barcode ?? null,
      photoPath: data.photoPath ?? item.photoPath,
      costCents: data.costCents,
      priceCents: data.priceCents,
      lowStockAt: data.lowStockAt,
    },
  });
  return { id: data.id };
}

export async function deleteItem(ctx: TenantContext, input: unknown) {
  const { id } = deleteItemSchema.parse(input);
  const db = tenantDb(ctx);

  const item = await db.inventoryItem.findFirst({ where: { id } });
  if (!item) throw new Error("Unknown item");
  if (!canEdit(ctx, item)) throw new Error("Not allowed to delete this item");

  await db.inventoryItem.delete({ where: { id } });
  return { id };
}

// ---------------------------------------------------------------------------
// Stock adjustment (atomic: StockAdjustment row + qtyOnHand update)
// ---------------------------------------------------------------------------

export async function adjustStock(ctx: TenantContext, input: unknown) {
  const { itemId, delta, reason } = adjustSchema.parse(input);
  const db = tenantDb(ctx);

  const item = await db.inventoryItem.findFirst({ where: { id: itemId } });
  if (!item) throw new Error("Unknown item");

  const locIds = await myLocationIds(ctx);
  if (!canAdjust(ctx, item, locIds)) throw new Error("Not allowed to adjust this item");

  const newQty = applyDelta(item.qtyOnHand, delta);
  if (newQty < 0) throw new Error("Insufficient stock for this adjustment");

  // The item is already tenant-verified above (tenantDb-scoped read), so writing
  // by primary id in a raw transaction stays inside the tenant boundary. Both
  // writes commit together or not at all.
  await prisma.$transaction([
    prisma.stockAdjustment.create({
      data: {
        businessId: ctx.businessId,
        itemId,
        delta,
        reason: reason as AdjReason,
        byUserId: ctx.userId,
      },
    }),
    prisma.inventoryItem.update({ where: { id: itemId }, data: { qtyOnHand: newQty } }),
  ]);

  return { qtyOnHand: newQty, lowStock: isLowStock(newQty, item.lowStockAt) };
}

// ---------------------------------------------------------------------------
// Per-user stock report / admin per-location rollup
// ---------------------------------------------------------------------------

export type ReportItem = {
  id: string;
  name: string;
  qtyOnHand: number;
  lowStockAt: number;
  lowStock: boolean;
  recent: { delta: number; reason: string; when: string }[];
};

export type ReportGroup = { key: string; label: string; items: ReportItem[] };

/**
 * Stock report. A USER sees their own items plus shared stock at their assigned
 * locations. An ADMIN sees a per-location rollup of shared stock plus a per-user
 * rollup of staff-owned items. Each item carries its recent adjustments.
 */
export async function getStockReport(
  ctx: TenantContext,
): Promise<{ role: string; groups: ReportGroup[] }> {
  const db = tenantDb(ctx);
  const where = await visibleWhere(ctx);
  const items = await db.inventoryItem.findMany({ where, orderBy: { name: "asc" } });

  const [locations, users, adjustments] = await Promise.all([
    db.location.findMany(),
    db.user.findMany(),
    items.length
      ? db.stockAdjustment.findMany({
          where: { itemId: { in: items.map((i: any) => i.id) } },
          orderBy: { createdAt: "desc" },
        })
      : Promise.resolve([]),
  ]);

  const locationNames = new Map<string, string>(locations.map((l: any) => [l.id, l.name]));
  const userNames = new Map<string, string>(users.map((u: any) => [u.id, u.name]));

  // Recent adjustments per item (latest 5).
  const recentByItem = new Map<string, ReportItem["recent"]>();
  for (const a of adjustments as any[]) {
    const list = recentByItem.get(a.itemId) ?? [];
    if (list.length < 5) {
      list.push({
        delta: a.delta,
        reason: a.reason,
        when: new Date(a.createdAt).toISOString(),
      });
      recentByItem.set(a.itemId, list);
    }
  }

  const toReportItem = (it: any): ReportItem => ({
    id: it.id,
    name: it.name,
    qtyOnHand: it.qtyOnHand,
    lowStockAt: it.lowStockAt,
    lowStock: isLowStock(it.qtyOnHand, it.lowStockAt),
    recent: recentByItem.get(it.id) ?? [],
  });

  const groups: ReportGroup[] = [];

  if (ctx.role === "ADMIN") {
    // Per-location rollup of shared stock.
    const byLocation = new Map<string, any[]>();
    const byUser = new Map<string, any[]>();
    for (const it of items as any[]) {
      if (it.locationId) {
        const arr = byLocation.get(it.locationId) ?? [];
        arr.push(it);
        byLocation.set(it.locationId, arr);
      } else if (it.userId) {
        const arr = byUser.get(it.userId) ?? [];
        arr.push(it);
        byUser.set(it.userId, arr);
      }
    }
    for (const [locId, its] of byLocation) {
      groups.push({
        key: `loc:${locId}`,
        label: `${locationNames.get(locId) ?? "Location"} (shared)`,
        items: its.map(toReportItem),
      });
    }
    for (const [uid, its] of byUser) {
      groups.push({
        key: `user:${uid}`,
        label: `${userNames.get(uid) ?? "Staff"} (own)`,
        items: its.map(toReportItem),
      });
    }
  } else {
    // USER: own items, then shared stock grouped by location.
    const own = (items as any[]).filter((it) => it.userId === ctx.userId);
    const shared = (items as any[]).filter((it) => it.locationId);
    if (own.length) {
      groups.push({ key: "mine", label: "My items", items: own.map(toReportItem) });
    }
    const byLocation = new Map<string, any[]>();
    for (const it of shared) {
      const arr = byLocation.get(it.locationId) ?? [];
      arr.push(it);
      byLocation.set(it.locationId, arr);
    }
    for (const [locId, its] of byLocation) {
      groups.push({
        key: `loc:${locId}`,
        label: `${locationNames.get(locId) ?? "Location"} (shared)`,
        items: its.map(toReportItem),
      });
    }
  }

  return { role: ctx.role, groups };
}

// ---------------------------------------------------------------------------
// Service → product consumption links (data for Phase 6 checkout decrement)
// ---------------------------------------------------------------------------

export type ServiceProductLink = { id: string; itemId: string; itemName: string; qty: number };

/** List the item-consumption links for one of the caller's services. */
export async function getServiceProducts(
  ctx: TenantContext,
  serviceId: string,
): Promise<ServiceProductLink[]> {
  const db = tenantDb(ctx);
  const service = await db.service.findFirst({ where: { id: serviceId, ...ownershipWhere(ctx) } });
  if (!service) throw new Error("Unknown service");

  const links = await db.serviceProduct.findMany({ where: { serviceId } });
  if (links.length === 0) return [];
  const items = await db.inventoryItem.findMany({
    where: { id: { in: links.map((l: any) => l.itemId) } },
  });
  const names = new Map<string, string>(items.map((i: any) => [i.id, i.name]));
  return links.map((l: any) => ({
    id: l.id,
    itemId: l.itemId,
    itemName: names.get(l.itemId) ?? "Item",
    qty: l.qty,
  }));
}

/**
 * Replace all consumption links for one of the caller's services. Each linked
 * item must belong to the tenant. Ownership: the service must be the caller's
 * (or any, for ADMIN).
 */
export async function setServiceProducts(ctx: TenantContext, input: unknown) {
  const { serviceId, links } = serviceProductsSchema.parse(input);
  const db = tenantDb(ctx);

  const service = await db.service.findFirst({ where: { id: serviceId, ...ownershipWhere(ctx) } });
  if (!service) throw new Error("Unknown service");

  // Validate every referenced item is in the tenant.
  if (links.length) {
    const items = await db.inventoryItem.findMany({
      where: { id: { in: links.map((l) => l.itemId) } },
    });
    const known = new Set(items.map((i: any) => i.id));
    for (const l of links) {
      if (!known.has(l.itemId)) throw new Error("Unknown item in consumption links");
    }
  }

  // Replace the set: delete existing (tenant-scoped) then recreate.
  await db.serviceProduct.deleteMany({ where: { serviceId } });
  for (const l of links) {
    await db.serviceProduct.create({ data: { serviceId, itemId: l.itemId, qty: l.qty } });
  }
  return { count: links.length };
}
