import { z } from "zod";
import { tenantDb, ownershipWhere, type TenantContext } from "./tenant";
import type { WeeklyHours, Interval } from "./slots";

/**
 * Schedule persistence (Phase 2). All tenant data access goes through
 * `tenantDb(ctx)` / `ownershipWhere(ctx)` — never the raw client — so a session
 * can only read/write its own business, and USER sessions only their own
 * schedules (guardrails #1 and #2).
 */

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

const intervalSchema = z
  .tuple([z.string().regex(HHMM), z.string().regex(HHMM)])
  .refine(([a, b]) => a < b, { message: "Interval start must be before end" });

const DAY_KEYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const;

export const weeklySchema = z.object(
  Object.fromEntries(DAY_KEYS.map((d) => [d, z.array(intervalSchema).default([])])),
);

export const saveWeeklySchema = z.object({
  locationId: z.string().min(1),
  weekly: weeklySchema,
});

export const addOverrideSchema = z
  .object({
    scheduleId: z.string().min(1),
    date: z.string().regex(DATE),
    closed: z.boolean().default(false),
    reopen: z.boolean().default(false),
    hours: z.array(intervalSchema).optional(),
  })
  .refine((v) => v.closed || v.reopen || (v.hours && v.hours.length > 0), {
    message: "An override must close the day, reopen a holiday, or set hours",
  });

export const deleteOverrideSchema = z.object({ id: z.string().min(1) });

export const settingsSchema = z.object({
  requiresApproval: z.boolean(),
  depositEnabled: z.boolean(),
  depositCents: z.number().int().nonnegative(),
});

const EMPTY_WEEKLY: WeeklyHours = {
  sun: [], mon: [], tue: [], wed: [], thu: [], fri: [], sat: [],
};

/**
 * Everything the schedule editor needs: the current user's locations, their
 * per-location schedules (with overrides), and their booking settings.
 */
export async function getScheduleEditorData(ctx: TenantContext) {
  const db = tenantDb(ctx);

  // Locations this user is assigned to (own assignments only for USER role).
  const userLocations = await db.userLocation.findMany({
    where: ownershipWhere(ctx),
  });
  const locationIds = userLocations.map((ul: any) => ul.locationId);
  const locations = locationIds.length
    ? await db.location.findMany({ where: { id: { in: locationIds } } })
    : [];

  const schedules = await db.schedule.findMany({
    where: ownershipWhere(ctx),
    include: { overrides: { orderBy: { date: "asc" } } },
  });

  const me = await db.user.findFirst({ where: { id: ctx.userId } });

  return {
    locations: locations.map((l: any) => ({ id: l.id, name: l.name })),
    schedules: schedules.map((s: any) => ({
      id: s.id,
      locationId: s.locationId,
      weekly: (s.weekly ?? EMPTY_WEEKLY) as WeeklyHours,
      overrides: s.overrides.map((o: any) => ({
        id: o.id,
        date: o.date.toISOString().slice(0, 10),
        closed: o.closed,
        reopen: o.reopen,
        hours: (o.intervals ?? null) as Interval[] | null,
      })),
    })),
    settings: {
      requiresApproval: me?.requiresApproval ?? false,
      depositEnabled: me?.depositEnabled ?? false,
      depositCents: me?.depositCents ?? 0,
    },
  };
}

/** Create or update the weekly template for (current user, location). */
export async function saveWeekly(ctx: TenantContext, input: unknown) {
  const { locationId, weekly } = saveWeeklySchema.parse(input);
  const db = tenantDb(ctx);

  // Confirm the location belongs to this tenant.
  const loc = await db.location.findFirst({ where: { id: locationId } });
  if (!loc) throw new Error("Unknown location");

  const existing = await db.schedule.findFirst({
    where: { locationId, ...ownershipWhere(ctx) },
  });

  if (existing) {
    await db.schedule.update({ where: { id: existing.id }, data: { weekly } });
    return { id: existing.id };
  }

  const created = await db.schedule.create({
    data: { userId: ctx.userId, locationId, weekly },
  });
  return { id: created.id };
}

/** Add a date override to one of the current user's schedules. */
export async function addOverride(ctx: TenantContext, input: unknown) {
  const data = addOverrideSchema.parse(input);
  const db = tenantDb(ctx);

  // Ownership: the schedule must belong to this tenant AND (for USER) this user.
  const schedule = await db.schedule.findFirst({
    where: { id: data.scheduleId, ...ownershipWhere(ctx) },
  });
  if (!schedule) throw new Error("Unknown schedule");

  const created = await db.scheduleOverride.create({
    data: {
      scheduleId: data.scheduleId,
      date: new Date(`${data.date}T00:00:00Z`),
      closed: data.closed,
      reopen: data.reopen,
      intervals: data.hours && data.hours.length > 0 ? data.hours : undefined,
    },
  });
  return { id: created.id };
}

/** Delete an override (tenant-scoped; parent schedule ownership enforced). */
export async function deleteOverride(ctx: TenantContext, input: unknown) {
  const { id } = deleteOverrideSchema.parse(input);
  const db = tenantDb(ctx);

  const ownScheduleIds = (
    await db.schedule.findMany({ where: ownershipWhere(ctx) })
  ).map((s: any) => s.id);

  // deleteMany is tenant-scoped by tenantDb; also constrain to owned schedules.
  await db.scheduleOverride.deleteMany({
    where: { id, scheduleId: { in: ownScheduleIds } },
  });
  return { ok: true };
}

/** Update the current user's booking settings (approval + deposit). */
export async function updateMySettings(ctx: TenantContext, input: unknown) {
  const data = settingsSchema.parse(input);
  if (!data.depositEnabled) data.depositCents = 0;
  const db = tenantDb(ctx);
  await db.user.update({ where: { id: ctx.userId }, data });
  return { ok: true };
}
