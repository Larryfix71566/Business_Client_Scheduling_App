import type { Role } from "@prisma/client";
import { tenantDb, type TenantContext } from "./tenant";

/**
 * notify.ts — outbound SMS/email (Phase 3).
 *
 * Every send writes a `NotificationLog` row through `tenantDb` (guardrail #1) so
 * the audit trail is tenant-scoped. In development the console driver
 * (`NOTIFY_DRIVER=console`, the dev default in `.env`) prints the message instead
 * of hitting a real provider. Real Twilio (SMS) / Resend (email) credentials plug
 * in at the marked branch in a later pass — the shape here does not change.
 *
 * These take a `businessId` rather than a full `TenantContext` because the public
 * booking flow has no authenticated user; only the business is known. The log row
 * only needs `businessId`, and `tenantDb` scopes purely on it.
 */

/** Minimal tenant context for logging: `tenantDb` scopes on businessId alone. */
function logCtx(businessId: string): TenantContext {
  return { businessId, userId: "__system__", role: "USER" as Role };
}

async function writeLog(
  businessId: string,
  channel: "sms" | "email",
  to: string,
  template: string,
  status: string,
): Promise<void> {
  await tenantDb(logCtx(businessId)).notificationLog.create({
    data: { channel, to, template, status },
  });
}

/**
 * Send an SMS. Logs to NotificationLog, then either console-logs (dev) or would
 * dispatch via the real provider (later pass). `template` labels the message kind
 * for the audit log (e.g. "booking_request_staff", "booking_confirmed_customer").
 */
export async function sendSms(
  businessId: string,
  to: string,
  body: string,
  template = "sms",
): Promise<void> {
  if (process.env.NOTIFY_DRIVER === "console") {
    // eslint-disable-next-line no-console
    console.log(`[SMS -> ${to}] ${body}`);
    await writeLog(businessId, "sms", to, template, "console");
    return;
  }
  // Real provider (Twilio) is wired in a later pass; credentials come from env.
  // Until then, treat non-console drivers as unconfigured and record the attempt.
  await writeLog(businessId, "sms", to, template, "skipped_no_provider");
}

/**
 * Send an email. Logs to NotificationLog, then either console-logs (dev) or would
 * dispatch via the real provider (later pass).
 */
export async function sendEmail(
  businessId: string,
  to: string,
  subject: string,
  body: string,
  template = "email",
): Promise<void> {
  if (process.env.NOTIFY_DRIVER === "console") {
    // eslint-disable-next-line no-console
    console.log(`[EMAIL -> ${to}] ${subject}\n${body}`);
    await writeLog(businessId, "email", to, template, "console");
    return;
  }
  // Real provider (Resend) is wired in a later pass; credentials come from env.
  await writeLog(businessId, "email", to, template, "skipped_no_provider");
}
