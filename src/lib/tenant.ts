import { prisma } from "./db";
import type { Role } from "@prisma/client";

/**
 * Tenant isolation gateway.
 *
 * Every tenant table carries `businessId`. Route handlers MUST access tenant
 * data only through `tenantDb(ctx)` — never `prisma.<model>` directly. Each
 * scoped delegate forces `where: { businessId }` on reads and stamps
 * `businessId` on writes, so a session for Business A can never see or mutate
 * Business B's rows. There is a vitest guard that greps `src/app/**` and fails
 * if any route touches a tenant model on the raw client.
 *
 * Ownership scoping (guardrail #2): staff-owned resources additionally filter
 * by `userId` unless the session role is ADMIN. Use `ownershipWhere(ctx)`.
 */

export type TenantContext = {
  businessId: string;
  userId: string;
  role: Role;
};

/**
 * Canonical list of tenant models (Prisma camelCase delegate names). Every
 * model here has a `businessId` column. Kept in sync with schema.prisma and
 * consumed by the direct-`prisma.`-usage guard test.
 */
export const TENANT_MODELS = [
  "location",
  "user",
  "userLocation",
  "branding",
  "customer",
  "service",
  "serviceProduct",
  "inventoryItem",
  "stockAdjustment",
  "schedule",
  "scheduleOverride",
  "dateClosure",
  "appointment",
  "payment",
  "notificationLog",
] as const;

export type TenantModel = (typeof TENANT_MODELS)[number];

type AnyArgs = Record<string, unknown> & { where?: Record<string, unknown> };
type CreateArgs = Record<string, unknown> & { data: Record<string, unknown> };
type CreateManyArgs = Record<string, unknown> & { data: Record<string, unknown>[] };

/**
 * Wrap a raw Prisma delegate so every operation is constrained to one business.
 * Reads inject `where.businessId`; writes stamp `data.businessId`. Update/delete
 * are routed through `updateMany`/`deleteMany` so a stray id from another tenant
 * simply matches zero rows instead of leaking across the boundary.
 */
function scope(model: any, businessId: string) {
  const withBiz = (where?: Record<string, unknown>) => ({ ...(where ?? {}), businessId });
  return {
    findMany: (args: AnyArgs = {}) => model.findMany({ ...args, where: withBiz(args.where) }),
    findFirst: (args: AnyArgs = {}) => model.findFirst({ ...args, where: withBiz(args.where) }),
    // findUnique can't carry a non-unique businessId filter, so use findFirst.
    findUnique: (args: AnyArgs) => model.findFirst({ ...args, where: withBiz(args.where) }),
    count: (args: AnyArgs = {}) => model.count({ ...args, where: withBiz(args.where) }),
    aggregate: (args: AnyArgs = {}) => model.aggregate({ ...args, where: withBiz(args.where) }),
    groupBy: (args: AnyArgs) => model.groupBy({ ...args, where: withBiz(args.where) }),
    create: (args: CreateArgs) => model.create({ ...args, data: { ...args.data, businessId } }),
    createMany: (args: CreateManyArgs) =>
      model.createMany({ ...args, data: args.data.map((d) => ({ ...d, businessId })) }),
    update: (args: AnyArgs & CreateArgs) =>
      model.updateMany({ where: withBiz(args.where), data: args.data }),
    updateMany: (args: AnyArgs & CreateArgs) =>
      model.updateMany({ ...args, where: withBiz(args.where), data: args.data }),
    delete: (args: AnyArgs) => model.deleteMany({ where: withBiz(args.where) }),
    deleteMany: (args: AnyArgs = {}) => model.deleteMany({ ...args, where: withBiz(args.where) }),
  };
}

export type ScopedDelegate = ReturnType<typeof scope>;

/**
 * Build the tenant-scoped data-access surface for a session. This is the ONLY
 * sanctioned way route handlers read or write tenant data.
 */
export function tenantDb(ctx: TenantContext): Record<TenantModel, ScopedDelegate> {
  const out = {} as Record<TenantModel, ScopedDelegate>;
  for (const name of TENANT_MODELS) {
    out[name] = scope((prisma as any)[name], ctx.businessId);
  }
  return out;
}

/**
 * Ownership filter for staff-owned resources. Returns `{ userId }` for USER
 * sessions so they only see their own rows; ADMIN sees everything in the tenant.
 * Merge into a `where` clause, e.g. `where: { ...ownershipWhere(ctx), active: true }`.
 */
export function ownershipWhere(ctx: TenantContext): { userId?: string } {
  return ctx.role === "ADMIN" ? {} : { userId: ctx.userId };
}
