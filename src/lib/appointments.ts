import { z } from "zod";
import { formatInTimeZone } from "date-fns-tz";
import { prisma } from "./db";
import { tenantDb, ownershipWhere, type TenantContext } from "./tenant";
import { notifyCustomerConfirmed, absoluteUrl } from "./booking";

/**
 * appointments.ts — staff-side appointment views + decisions (Phase 3).
 *
 * All access goes through `tenantDb` (guardrail #1) and `ownershipWhere`
 * (guardrail #2): a USER sees/acts on only their own appointments; an ADMIN sees
 * the whole business and may filter to one staff member.
 *
 * "Decline" is modeled as `status = CANCELLED` with `cancelledBy` set to the
 * deciding staff user and `cancelledAt` stamped — the ApptStatus enum has no
 * dedicated DECLINED value and adding one would mean a schema migration, which
 * the plan says to avoid. A booking never confirmed that is later CANCELLED is,
 * in effect, a decline.
 */

export type ApptRow = {
  id: string;
  status: string;
  startIso: string;
  when: string;
  serviceName: string;
  priceLabel: string;
  customerName: string;
  customerPhone: string;
  staffName: string;
  locationName: string;
};

async function decorate(
  ctx: TenantContext,
  appts: any[],
): Promise<ApptRow[]> {
  if (appts.length === 0) return [];
  const db = tenantDb(ctx);

  const [services, customers, users, locations] = await Promise.all([
    db.service.findMany({ where: { id: { in: appts.map((a) => a.serviceId) } } }),
    db.customer.findMany({ where: { id: { in: appts.map((a) => a.customerId) } } }),
    db.user.findMany({ where: { id: { in: appts.map((a) => a.userId) } } }),
    db.location.findMany({ where: { id: { in: appts.map((a) => a.locationId) } } }),
  ]);
  const svc = new Map<string, any>(services.map((s: any) => [s.id, s]));
  const cus = new Map<string, any>(customers.map((c: any) => [c.id, c]));
  const usr = new Map<string, any>(users.map((u: any) => [u.id, u]));
  const loc = new Map<string, any>(locations.map((l: any) => [l.id, l]));

  return appts.map((a) => {
    const service = svc.get(a.serviceId);
    const customer = cus.get(a.customerId);
    const location = loc.get(a.locationId);
    const tz = (location?.timezone as string) ?? "UTC";
    return {
      id: a.id,
      status: a.status,
      startIso: a.startsAt.toISOString(),
      when: formatInTimeZone(a.startsAt, tz, "EEE, MMM d 'at' h:mm a"),
      serviceName: service?.name ?? "Service",
      priceLabel: service ? `$${(service.priceCents / 100).toFixed(2)}` : "",
      customerName: customer ? `${customer.firstName} ${customer.lastName}` : "Customer",
      customerPhone: customer?.phone ?? "",
      staffName: usr.get(a.userId)?.name ?? "",
      locationName: location?.name ?? "",
    };
  });
}

/**
 * The logged-in user's upcoming appointments with full detail. A USER sees only
 * their own; an ADMIN sees the whole business and may narrow with `staffUserId`.
 */
export async function getMyCalendar(
  ctx: TenantContext,
  staffUserId?: string,
): Promise<{ appts: ApptRow[]; staff: { id: string; name: string }[]; isAdmin: boolean }> {
  const db = tenantDb(ctx);

  const where: Record<string, unknown> = {
    ...ownershipWhere(ctx),
    status: { in: ["REQUESTED", "CONFIRMED", "COMPLETED", "NO_SHOW"] },
  };
  if (ctx.role === "ADMIN" && staffUserId) where.userId = staffUserId;

  const appts = await db.appointment.findMany({ where, orderBy: { startsAt: "asc" } });

  // Admins get a staff filter list; staff don't need one.
  let staff: { id: string; name: string }[] = [];
  if (ctx.role === "ADMIN") {
    const users = await db.user.findMany({ orderBy: { name: "asc" } });
    staff = users.map((u: any) => ({ id: u.id, name: u.name }));
  }

  return { appts: await decorate(ctx, appts), staff, isAdmin: ctx.role === "ADMIN" };
}

/** The current user's pending (REQUESTED) approval queue. */
export async function getApprovalQueue(ctx: TenantContext): Promise<ApptRow[]> {
  const db = tenantDb(ctx);
  const appts = await db.appointment.findMany({
    where: { ...ownershipWhere(ctx), status: "REQUESTED" },
    orderBy: { startsAt: "asc" },
  });
  return decorate(ctx, appts);
}

// ---------------------------------------------------------------------------
// Approve / decline
// ---------------------------------------------------------------------------

export const decisionSchema = z.object({
  appointmentId: z.string().min(1),
  action: z.enum(["approve", "decline"]),
});

/**
 * Approve (→ CONFIRMED, notify customer) or decline (→ CANCELLED) a REQUESTED
 * appointment. Ownership-scoped: a USER can only decide their own; ADMIN any.
 */
export async function decideAppointment(ctx: TenantContext, input: unknown) {
  const { appointmentId, action } = decisionSchema.parse(input);
  const db = tenantDb(ctx);

  const appt = await db.appointment.findFirst({
    where: { id: appointmentId, ...ownershipWhere(ctx) },
  });
  if (!appt) throw new Error("Unknown appointment");
  if (appt.status !== "REQUESTED") throw new Error("Appointment is not pending approval");

  if (action === "decline") {
    await db.appointment.update({
      where: { id: appointmentId },
      data: { status: "CANCELLED", cancelledAt: new Date(), cancelledBy: ctx.userId },
    });
    return { ok: true, status: "CANCELLED" as const };
  }

  await db.appointment.update({
    where: { id: appointmentId },
    data: { status: "CONFIRMED" },
  });

  // Confirm to the customer, including their self-serve manage link (Phase 4).
  const [customer, service, location, business] = await Promise.all([
    db.customer.findFirst({ where: { id: appt.customerId } }),
    db.service.findFirst({ where: { id: appt.serviceId } }),
    db.location.findFirst({ where: { id: appt.locationId } }),
    prisma.business.findUnique({ where: { id: ctx.businessId } }),
  ]);
  if (customer && service) {
    const tz = (location?.timezone as string) ?? "UTC";
    const when = formatInTimeZone(appt.startsAt, tz, "EEE, MMM d 'at' h:mm a");
    const manageLink = business
      ? absoluteUrl(`/b/${business.slug}/manage/${appt.manageToken}`)
      : undefined;
    await notifyCustomerConfirmed(ctx.businessId, customer, service.name, when, manageLink);
  }

  return { ok: true, status: "CONFIRMED" as const };
}

// ---------------------------------------------------------------------------
// Staff cancel / no-show (Phase 4)
// ---------------------------------------------------------------------------

export const staffStatusSchema = z.object({
  appointmentId: z.string().min(1),
  action: z.enum(["cancel", "no_show", "complete"]),
});

/**
 * Staff cancel, mark-no-show, or mark-complete an appointment. Unlike the
 * customer magic link, this is ALWAYS available (no cutoff) — staff may act at
 * any time. Ownership scoped: a USER can only act on their own appointments;
 * ADMIN on any. `cancel` → CANCELLED (+ cancelledAt/cancelledBy); `no_show` →
 * NO_SHOW; `complete` → COMPLETED (the Phase 6 entry point for recording a
 * payment — a payment can only be recorded against a COMPLETED appointment).
 */
export async function staffUpdateStatus(ctx: TenantContext, input: unknown) {
  const { appointmentId, action } = staffStatusSchema.parse(input);
  const db = tenantDb(ctx);

  const appt = await db.appointment.findFirst({
    where: { id: appointmentId, ...ownershipWhere(ctx) },
  });
  if (!appt) throw new Error("Unknown appointment");
  if (appt.status === "CANCELLED") throw new Error("Appointment is already cancelled");

  if (action === "cancel") {
    await db.appointment.update({
      where: { id: appointmentId },
      data: { status: "CANCELLED", cancelledAt: new Date(), cancelledBy: ctx.userId },
    });
    return { ok: true, status: "CANCELLED" as const };
  }

  if (action === "complete") {
    await db.appointment.update({
      where: { id: appointmentId },
      data: { status: "COMPLETED" },
    });
    return { ok: true, status: "COMPLETED" as const };
  }

  await db.appointment.update({
    where: { id: appointmentId },
    data: { status: "NO_SHOW" },
  });
  return { ok: true, status: "NO_SHOW" as const };
}
