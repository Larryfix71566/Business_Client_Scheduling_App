import { z } from "zod";
import { formatInTimeZone } from "date-fns-tz";
import { tenantDb } from "./tenant";
import {
  publicCtx,
  getBookingBusiness,
  getSlotGrid,
  absoluteUrl,
  type DayGrid,
} from "./booking";
import { sendSms, sendEmail } from "./notify";

/**
 * cancellation.ts — Phase 4 customer self-serve cancel/reschedule via a
 * login-less magic link `/b/[businessSlug]/manage/[manageToken]`.
 *
 * Customers are anonymous: the opaque `manageToken` on the Appointment is the
 * only credential. All tenant data access goes through `tenantDb` with the same
 * synthetic public context booking.ts uses (guardrail #1). Slot math for the
 * reschedule picker delegates to `getSlotGrid` → `computeOpenSlots` (guardrail
 * #5) — never reimplemented here.
 *
 * The cutoff rule (`isWithinCancelCutoff`) is a PURE, unit-tested function so it
 * can be exercised without a DB.
 */

// ---------------------------------------------------------------------------
// Pure cutoff enforcement (unit-tested)
// ---------------------------------------------------------------------------

/**
 * Is the appointment inside its cancellation cutoff window (i.e. too late for
 * the customer to self-serve cancel/reschedule)?
 *
 * The rule is a pure hours-before-start comparison against absolute UTC
 * instants, so the location's timezone does NOT affect the result — `startUtc`
 * and `now` are both real instants and the gap between them is timezone-free.
 *
 * Returns `true` (blocked) when the appointment starts in `cutoffHours` or less
 * (boundary inclusive → at exactly the cutoff it is blocked, the conservative
 * choice), or has already started/passed. Returns `false` (allowed) only when
 * the start is strictly more than `cutoffHours` in the future.
 */
export function isWithinCancelCutoff(
  apptStartUtc: Date,
  cutoffHours: number,
  now: Date = new Date(),
): boolean {
  const msUntilStart = apptStartUtc.getTime() - now.getTime();
  return msUntilStart <= cutoffHours * 3_600_000;
}

/** Convenience inverse: may the customer self-serve act on this appointment? */
export function canSelfServe(
  apptStartUtc: Date,
  cutoffHours: number,
  now: Date = new Date(),
): boolean {
  return !isWithinCancelCutoff(apptStartUtc, cutoffHours, now);
}

/** Statuses a customer can still act on via the manage link. */
const MANAGEABLE_STATUSES = ["REQUESTED", "CONFIRMED"] as const;

// ---------------------------------------------------------------------------
// Manage view (public, token-authenticated)
// ---------------------------------------------------------------------------

export type ManageView = {
  businessSlug: string;
  businessId: string;
  businessName: string;
  userId: string;
  locationId: string;
  manageToken: string;
  status: string;
  when: string; // formatted in the location's timezone
  serviceName: string;
  staffName: string;
  locationName: string;
  cutoffHours: number;
  /** true when self-serve cancel/reschedule is allowed (outside cutoff + active). */
  canManage: boolean;
  /** why not, when canManage is false (for messaging). */
  reason: "cutoff" | "inactive" | null;
};

type ResolvedAppointment = {
  business: { id: string; slug: string; name: string; cancelCutoffHours: number };
  appt: any;
  service: any;
  staff: any;
  location: any;
};

/** Resolve an appointment from (slug, token) with everything the UI needs. */
async function resolve(
  businessSlug: string,
  manageToken: string,
): Promise<ResolvedAppointment | null> {
  const business = await getBookingBusiness(businessSlug);
  if (!business) return null;
  const db = tenantDb(publicCtx(business.id));

  const appt = await db.appointment.findFirst({ where: { manageToken } });
  if (!appt) return null;

  const [service, staff, location] = await Promise.all([
    db.service.findFirst({ where: { id: appt.serviceId } }),
    db.user.findFirst({ where: { id: appt.userId } }),
    db.location.findFirst({ where: { id: appt.locationId } }),
  ]);

  return { business, appt, service, staff, location };
}

export async function getManageView(
  businessSlug: string,
  manageToken: string,
): Promise<ManageView | null> {
  const r = await resolve(businessSlug, manageToken);
  if (!r) return null;

  const tz = (r.location?.timezone as string) ?? "UTC";
  const active = (MANAGEABLE_STATUSES as readonly string[]).includes(r.appt.status);
  const withinCutoff = isWithinCancelCutoff(r.appt.startsAt, r.business.cancelCutoffHours);
  const canManage = active && !withinCutoff;
  const reason = !active ? "inactive" : withinCutoff ? "cutoff" : null;

  return {
    businessSlug: r.business.slug,
    businessId: r.business.id,
    businessName: r.business.name,
    userId: r.appt.userId,
    locationId: r.appt.locationId,
    manageToken,
    status: r.appt.status,
    when: formatInTimeZone(r.appt.startsAt, tz, "EEE, MMM d 'at' h:mm a"),
    serviceName: r.service?.name ?? "Service",
    staffName: r.staff?.name ?? "",
    locationName: r.location?.name ?? "",
    cutoffHours: r.business.cancelCutoffHours,
    canManage,
    reason,
  };
}

/** The reschedule slot grid for an appointment (excludes its own current slot). */
export async function getManageSlots(
  businessSlug: string,
  manageToken: string,
): Promise<DayGrid[] | null> {
  const r = await resolve(businessSlug, manageToken);
  if (!r) return null;
  if (!(MANAGEABLE_STATUSES as readonly string[]).includes(r.appt.status)) return null;
  if (isWithinCancelCutoff(r.appt.startsAt, r.business.cancelCutoffHours)) return null;
  return getSlotGrid(
    r.business.id,
    r.appt.locationId,
    r.appt.userId,
    r.appt.serviceId,
    r.appt.id, // exclude this appointment so its current slot is pickable/freed
  );
}

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------

export const manageTokenSchema = z.object({
  businessSlug: z.string().min(1),
  manageToken: z.string().min(1),
});

export const rescheduleSchema = manageTokenSchema.extend({
  startIso: z.string().datetime(),
});

/** Guard shared by cancel/reschedule: resolve + enforce the cutoff. */
async function requireManageable(businessSlug: string, manageToken: string) {
  const r = await resolve(businessSlug, manageToken);
  if (!r) throw new Error("Booking not found");
  if (!(MANAGEABLE_STATUSES as readonly string[]).includes(r.appt.status)) {
    throw new Error("This booking can no longer be changed");
  }
  if (isWithinCancelCutoff(r.appt.startsAt, r.business.cancelCutoffHours)) {
    throw new Error(
      `Changes are only allowed more than ${r.business.cancelCutoffHours} hours before your appointment. Please contact the business directly.`,
    );
  }
  return r;
}

export async function cancelByToken(input: unknown): Promise<{ ok: true; status: "CANCELLED" }> {
  const { businessSlug, manageToken } = manageTokenSchema.parse(input);
  const r = await requireManageable(businessSlug, manageToken);
  const db = tenantDb(publicCtx(r.business.id));

  await db.appointment.update({
    where: { id: r.appt.id },
    data: { status: "CANCELLED", cancelledAt: new Date(), cancelledBy: "customer" },
  });

  await notifyCustomerCancelled(r);
  return { ok: true, status: "CANCELLED" };
}

export async function rescheduleByToken(
  input: unknown,
): Promise<{ ok: true; status: string; startIso: string }> {
  const { businessSlug, manageToken, startIso } = rescheduleSchema.parse(input);
  const r = await requireManageable(businessSlug, manageToken);
  const db = tenantDb(publicCtx(r.business.id));

  // Re-validate the requested new slot against live availability (excluding
  // this appointment's own current slot).
  const grid = await getSlotGrid(
    r.business.id,
    r.appt.locationId,
    r.appt.userId,
    r.appt.serviceId,
    r.appt.id,
  );
  if (!grid) throw new Error("No availability");
  const target = new Date(startIso).toISOString();
  const match = grid.flatMap((d) => d.cells).find((c) => c.startIso === target);
  if (!match || match.taken) throw new Error("That time is no longer available");

  const startsAt = new Date(match.startIso);
  const endsAt = new Date(match.endIso);

  // Mutate the existing row in place (does NOT create a new appointment); the
  // old slot is freed implicitly because it's the same row.
  await db.appointment.update({
    where: { id: r.appt.id },
    data: { startsAt, endsAt, reminderSentAt: null },
  });

  const tz = (r.location?.timezone as string) ?? "UTC";
  const when = formatInTimeZone(startsAt, tz, "EEE, MMM d 'at' h:mm a");
  const customer = await db.customer.findFirst({ where: { id: r.appt.customerId } });
  if (customer) {
    const manageLink = absoluteUrl(`/b/${businessSlug}/manage/${manageToken}`);
    const body = `Hi ${customer.firstName}, your ${r.service?.name ?? "appointment"} is now rescheduled to ${when}. Manage or cancel: ${manageLink}`;
    await sendSms(r.business.id, customer.phone, body, "booking_rescheduled_customer");
    if (customer.email) {
      await sendEmail(r.business.id, customer.email, "Your booking was rescheduled", body, "booking_rescheduled_customer");
    }
  }

  return { ok: true, status: r.appt.status, startIso: startsAt.toISOString() };
}

/** Notify the customer their booking was cancelled. */
async function notifyCustomerCancelled(r: ResolvedAppointment): Promise<void> {
  const db = tenantDb(publicCtx(r.business.id));
  const customer = await db.customer.findFirst({ where: { id: r.appt.customerId } });
  if (!customer) return;
  const tz = (r.location?.timezone as string) ?? "UTC";
  const when = formatInTimeZone(r.appt.startsAt, tz, "EEE, MMM d 'at' h:mm a");
  const body = `Hi ${customer.firstName}, your ${r.service?.name ?? "appointment"} on ${when} has been cancelled.`;
  await sendSms(r.business.id, customer.phone, body, "booking_cancelled_customer");
  if (customer.email) {
    await sendEmail(r.business.id, customer.email, "Your booking was cancelled", body, "booking_cancelled_customer");
  }
}
