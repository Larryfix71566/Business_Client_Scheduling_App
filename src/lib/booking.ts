import { z } from "zod";
import type { Role, ApptStatus } from "@prisma/client";
import { formatInTimeZone } from "date-fns-tz";
import { prisma } from "./db";
import { tenantDb, type TenantContext } from "./tenant";
import { computeOpenSlots, type Slot, type WeeklyHours, type Interval } from "./slots";
import { sendSms, sendEmail } from "./notify";
import { formatCents } from "./money";

/**
 * booking.ts — public (customer-facing) booking data access + mutations (Phase 3).
 *
 * Customers are anonymous (no auth), so there is no session `TenantContext`. Once
 * the business is resolved from its slug we build a synthetic tenant context and
 * go through `tenantDb` like every other data path (guardrail #1). Slot math is
 * NOT reimplemented here — it delegates to the pure `computeOpenSlots` in slots.ts
 * (guardrail #5).
 */

/** Appointment statuses that occupy a slot (block re-booking). */
export const BLOCKING_STATUSES: ApptStatus[] = ["REQUESTED", "CONFIRMED", "COMPLETED"];

/** How many days ahead the public calendar shows. */
export const BOOKING_WINDOW_DAYS = 14;

/**
 * Synthetic tenant context for anonymous public flows. `tenantDb` scopes purely
 * on `businessId`; the userId/role are inert here because public queries filter
 * by an explicit `userId` in their `where`, never via `ownershipWhere`.
 */
export function publicCtx(businessId: string): TenantContext {
  return { businessId, userId: "__public__", role: "ADMIN" as Role };
}

// ---------------------------------------------------------------------------
// Pure helper (unit-tested): mark which candidate slots are taken.
// ---------------------------------------------------------------------------

export type SlotCell = { start: Date; end: Date; taken: boolean };

/**
 * Partition the full candidate grid against the truly-open subset. A candidate
 * whose start is NOT in the open set is `taken` (blocked by an existing
 * appointment or its buffer). Both inputs come from `computeOpenSlots` — the grid
 * is computed with `existingAppointments: []`, the open set with the real
 * appointments — so slot math is never duplicated.
 */
export function partitionSlots(candidates: Slot[], open: Slot[]): SlotCell[] {
  const openStarts = new Set(open.map((s) => s.start.getTime()));
  return candidates.map((c) => ({
    start: c.start,
    end: c.end,
    taken: !openStarts.has(c.start.getTime()),
  }));
}

// ---------------------------------------------------------------------------
// Public read queries
// ---------------------------------------------------------------------------

/** Resolve a business by slug. Business is the tenant root, not a tenant model. */
export async function getBookingBusiness(slug: string) {
  return prisma.business.findUnique({ where: { slug } });
}

export type LocationOption = { id: string; name: string; address: string };
export type StaffOption = { id: string; name: string };
export type ServiceOption = {
  id: string;
  name: string;
  description: string | null;
  durationMin: number;
  priceCents: number;
  priceLabel: string;
};

/** Locations for a business (booking picker). */
export async function getBookingLocations(businessId: string): Promise<LocationOption[]> {
  const db = tenantDb(publicCtx(businessId));
  const locations = await db.location.findMany({ orderBy: { name: "asc" } });
  return locations.map((l: any) => ({ id: l.id, name: l.name, address: l.address }));
}

/** Staff assigned to a location, for the staff picker. */
export async function getLocationStaff(
  businessId: string,
  locationId: string,
): Promise<{ location: any; staff: StaffOption[] } | null> {
  const db = tenantDb(publicCtx(businessId));
  const loc = await db.location.findFirst({ where: { id: locationId } });
  if (!loc) return null;
  const assignments = await db.userLocation.findMany({ where: { locationId } });
  const userIds = assignments.map((a: any) => a.userId);
  if (userIds.length === 0) return { location: loc, staff: [] };
  const users = await db.user.findMany({ where: { id: { in: userIds } }, orderBy: { name: "asc" } });
  return {
    location: loc,
    staff: users.map((u: any) => ({ id: u.id, name: u.name })),
  };
}

/** A staff member's active, bookable services (with formatted price). */
export async function getStaffServices(
  businessId: string,
  userId: string,
): Promise<{ user: StaffOption; services: ServiceOption[] } | null> {
  const db = tenantDb(publicCtx(businessId));
  const user = await db.user.findFirst({ where: { id: userId } });
  if (!user) return null;
  const services = await db.service.findMany({
    where: { userId, active: true },
    orderBy: { name: "asc" },
  });
  return {
    user: { id: user.id, name: user.name },
    services: services.map((s: any) => ({
      id: s.id,
      name: s.name,
      description: s.description as string | null,
      durationMin: s.durationMin,
      priceCents: s.priceCents,
      priceLabel: formatCents(s.priceCents),
    })),
  };
}

// ---------------------------------------------------------------------------
// Slot grid (delegates all schedule math to computeOpenSlots)
// ---------------------------------------------------------------------------

type SlotContext = {
  timezone: string;
  weekly: WeeklyHours;
  locationHours: WeeklyHours;
  overrides: { date: string; closed: boolean; reopen: boolean; hours?: Interval[] }[];
  closures: { date: string }[];
  durationMin: number;
  bufferMin: number;
  existing: { start: Date; end: Date }[];
  dateRange: { start: string; end: string };
};

/** Load everything the slot engine needs for (staff, location, service). */
async function loadSlotContext(
  businessId: string,
  locationId: string,
  userId: string,
  serviceId: string,
  excludeAppointmentId?: string,
): Promise<SlotContext | null> {
  const db = tenantDb(publicCtx(businessId));

  const location = await db.location.findFirst({
    where: { id: locationId },
    include: { closures: true },
  });
  if (!location) return null;

  const service = await db.service.findFirst({
    where: { id: serviceId, userId, active: true },
  });
  if (!service) return null;

  const schedule = await db.schedule.findFirst({
    where: { userId, locationId },
    include: { overrides: true },
  });
  if (!schedule) return null; // staff has no availability at this location

  const tz = location.timezone as string;
  const todayLocal = formatInTimeZone(new Date(), tz, "yyyy-MM-dd");
  const endLocal = formatInTimeZone(
    new Date(Date.now() + (BOOKING_WINDOW_DAYS - 1) * 86_400_000),
    tz,
    "yyyy-MM-dd",
  );

  const existing = await db.appointment.findMany({
    where: {
      userId,
      locationId,
      status: { in: BLOCKING_STATUSES },
      endsAt: { gte: new Date() },
      // When rescheduling, the appointment being moved must not block its own
      // new-slot picker (freeing its current slot is implicit — same row).
      ...(excludeAppointmentId ? { id: { not: excludeAppointmentId } } : {}),
    },
  });

  return {
    timezone: tz,
    weekly: (schedule.weekly ?? {}) as WeeklyHours,
    locationHours: (location.weeklyHours ?? {}) as WeeklyHours,
    overrides: (schedule.overrides ?? []).map((o: any) => ({
      date: o.date.toISOString().slice(0, 10),
      closed: o.closed,
      reopen: o.reopen,
      hours: (o.intervals ?? undefined) as Interval[] | undefined,
    })),
    closures: (location.closures ?? []).map((c: any) => ({
      date: c.date.toISOString().slice(0, 10),
    })),
    durationMin: service.durationMin,
    bufferMin: service.bufferMin,
    existing: existing.map((a: any) => ({ start: a.startsAt, end: a.endsAt })),
    dateRange: { start: todayLocal, end: endLocal },
  };
}

export type DayGrid = {
  date: string; // local YYYY-MM-DD
  label: string; // e.g. "Mon, Jul 13"
  cells: { startIso: string; endIso: string; time: string; taken: boolean }[];
};

/**
 * Build the public calendar grid: candidate slots for each future day, each
 * flagged `taken` or open. Reuses `computeOpenSlots` twice — once ignoring
 * appointments (the full grid), once with them (the bookable subset) — then
 * partitions. Past slots are dropped so a customer can't book a time gone by.
 */
export async function getSlotGrid(
  businessId: string,
  locationId: string,
  userId: string,
  serviceId: string,
  excludeAppointmentId?: string,
): Promise<DayGrid[] | null> {
  const cx = await loadSlotContext(businessId, locationId, userId, serviceId, excludeAppointmentId);
  if (!cx) return null;

  const base = {
    weekly: cx.weekly,
    locationHours: cx.locationHours,
    overrides: cx.overrides,
    closures: cx.closures,
    durationMin: cx.durationMin,
    bufferMin: cx.bufferMin,
    timezone: cx.timezone,
    dateRange: cx.dateRange,
  };

  const candidates = computeOpenSlots({ ...base, existingAppointments: [] });
  const open = computeOpenSlots({ ...base, existingAppointments: cx.existing });

  const now = Date.now();
  const cells = partitionSlots(candidates, open).filter((c) => c.start.getTime() > now);

  const byDay = new Map<string, DayGrid>();
  for (const c of cells) {
    const day = formatInTimeZone(c.start, cx.timezone, "yyyy-MM-dd");
    if (!byDay.has(day)) {
      byDay.set(day, {
        date: day,
        label: formatInTimeZone(c.start, cx.timezone, "EEE, MMM d"),
        cells: [],
      });
    }
    byDay.get(day)!.cells.push({
      startIso: c.start.toISOString(),
      endIso: c.end.toISOString(),
      time: formatInTimeZone(c.start, cx.timezone, "h:mm a"),
      taken: c.taken,
    });
  }
  return [...byDay.values()];
}

// ---------------------------------------------------------------------------
// Booking mutation
// ---------------------------------------------------------------------------

const PHONE = /^[+()\-\s\d]{7,20}$/;

export const bookingInputSchema = z.object({
  businessSlug: z.string().min(1),
  locationId: z.string().min(1),
  userId: z.string().min(1),
  serviceId: z.string().min(1),
  startIso: z.string().datetime(),
  firstName: z.string().trim().min(1).max(80),
  lastName: z.string().trim().min(1).max(80),
  phone: z.string().trim().regex(PHONE, "Enter a valid phone number"),
  email: z.string().trim().email().optional().or(z.literal("")).transform((v) => v || undefined),
  notes: z.string().trim().max(500).optional().or(z.literal("")).transform((v) => v || undefined),
});

export type BookingInput = z.infer<typeof bookingInputSchema>;

export type BookingResult = {
  appointmentId: string;
  status: ApptStatus;
  requiresApproval: boolean;
  manageToken: string;
  managePath: string; // relative link the customer uses to cancel/reschedule
};

/**
 * Create a booking from public input: validate the slot is genuinely open,
 * look up the Customer by (businessId, phone) or create one, create the
 * Appointment (REQUESTED when the staff member requires approval, else
 * CONFIRMED), and fire notifications through notify.ts.
 */
export async function createBooking(input: unknown): Promise<BookingResult> {
  const data = bookingInputSchema.parse(input);

  const business = await getBookingBusiness(data.businessSlug);
  if (!business) throw new Error("Unknown business");
  const businessId = business.id;
  const db = tenantDb(publicCtx(businessId));

  const staff = await db.user.findFirst({ where: { id: data.userId } });
  if (!staff) throw new Error("Unknown staff member");

  const service = await db.service.findFirst({
    where: { id: data.serviceId, userId: data.userId, active: true },
  });
  if (!service) throw new Error("Unknown service");

  // Re-validate the requested slot server-side against live availability.
  const grid = await getSlotGrid(businessId, data.locationId, data.userId, data.serviceId);
  if (!grid) throw new Error("No availability");
  const match = grid
    .flatMap((d) => d.cells)
    .find((c) => c.startIso === new Date(data.startIso).toISOString());
  if (!match || match.taken) {
    throw new Error("That time is no longer available");
  }

  const startsAt = new Date(match.startIso);
  const endsAt = new Date(match.endIso);

  // Customer: look up by (businessId, phone) — else create.
  let customer = await db.customer.findFirst({ where: { phone: data.phone } });
  if (!customer) {
    customer = await db.customer.create({
      data: {
        firstName: data.firstName,
        lastName: data.lastName,
        phone: data.phone,
        email: data.email ?? null,
      },
    });
  }

  const status: ApptStatus = staff.requiresApproval ? "REQUESTED" : "CONFIRMED";

  const appt = await db.appointment.create({
    data: {
      locationId: data.locationId,
      userId: data.userId,
      customerId: customer.id,
      serviceId: data.serviceId,
      startsAt,
      endsAt,
      status,
    },
  });

  const tz = (await db.location.findFirst({ where: { id: data.locationId } }))?.timezone as string;
  const when = formatInTimeZone(startsAt, tz ?? "UTC", "EEE, MMM d 'at' h:mm a");

  const managePath = `/b/${data.businessSlug}/manage/${appt.manageToken}`;
  const manageLink = absoluteUrl(managePath);

  if (status === "REQUESTED") {
    // Alert the staff member that a booking needs approval.
    await sendEmail(
      businessId,
      staff.email,
      "New booking request",
      `${data.firstName} ${data.lastName} requested ${service.name} on ${when}. ` +
        `Review it in your approval queue.`,
      "booking_request_staff",
    );
  } else {
    // Confirm immediately to the customer (with a manage/cancel link).
    await notifyCustomerConfirmed(businessId, customer, service.name, when, manageLink);
  }

  return {
    appointmentId: appt.id,
    status,
    requiresApproval: staff.requiresApproval,
    manageToken: appt.manageToken,
    managePath,
  };
}

/**
 * Build an absolute URL for links embedded in notifications. Falls back to the
 * dev origin when no explicit base is configured.
 */
export function absoluteUrl(path: string): string {
  const base =
    process.env.APP_BASE_URL ?? process.env.NEXTAUTH_URL ?? "http://localhost:3000";
  return `${base.replace(/\/$/, "")}${path}`;
}

/**
 * Send the customer their confirmation (SMS to phone, email if on file). When a
 * `manageLink` is supplied it's appended so the customer can self-serve
 * cancel/reschedule (Phase 4).
 */
export async function notifyCustomerConfirmed(
  businessId: string,
  customer: { firstName: string; phone: string; email: string | null },
  serviceName: string,
  when: string,
  manageLink?: string,
): Promise<void> {
  const tail = manageLink ? ` Manage or cancel: ${manageLink}` : "";
  const body = `Hi ${customer.firstName}, your ${serviceName} on ${when} is confirmed.${tail}`;
  await sendSms(businessId, customer.phone, body, "booking_confirmed_customer");
  if (customer.email) {
    await sendEmail(businessId, customer.email, "Your booking is confirmed", body, "booking_confirmed_customer");
  }
}
