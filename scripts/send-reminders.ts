/**
 * scripts/send-reminders.ts — Phase 4 reminder sweep.
 *
 * Run manually in dev (`npm run remind`) or via cron in production. Finds every
 * CONFIRMED appointment starting in ~24 hours that hasn't been reminded yet,
 * sends an SMS (+email) via notify.ts, then stamps `reminderSentAt` so a second
 * run the same day never double-sends (dedup — see src/lib/reminders.ts).
 *
 * DOCUMENTED EXCEPTION to the no-direct-prisma guard: this is a cross-tenant
 * maintenance sweep, not a per-session request. `scripts/**` is outside
 * `src/app/**`, so the guard (which only scans src/app) does not apply. Going
 * business-by-business through tenantDb would need us to first enumerate
 * businesses on the raw client anyway; a single `reminderSentAt = null` +
 * time-window read across tenants is the clean, common shape here. Every
 * notification still records a tenant-scoped NotificationLog row via notify.ts.
 */
import "dotenv/config";
import { formatInTimeZone } from "date-fns-tz";
import { prisma } from "../src/lib/db";
import { sendSms, sendEmail } from "../src/lib/notify";
import { reminderWindow, buildReminderMessage } from "../src/lib/reminders";

async function main() {
  const now = new Date();
  const { gte, lte } = reminderWindow(now);

  const due = await prisma.appointment.findMany({
    where: { status: "CONFIRMED", reminderSentAt: null, startsAt: { gte, lte } },
    orderBy: { startsAt: "asc" },
  });

  console.log(
    `[remind] ${now.toISOString()} — ${due.length} appointment(s) due ` +
      `(window ${gte.toISOString()} … ${lte.toISOString()})`,
  );

  let sent = 0;
  for (const appt of due) {
    const [customer, service, location] = await Promise.all([
      prisma.customer.findUnique({ where: { id: appt.customerId } }),
      prisma.service.findUnique({ where: { id: appt.serviceId } }),
      prisma.location.findUnique({ where: { id: appt.locationId } }),
    ]);
    if (!customer || !service) continue;

    const tz = location?.timezone ?? "UTC";
    const when = formatInTimeZone(appt.startsAt, tz, "EEE, MMM d 'at' h:mm a");
    const body = buildReminderMessage(customer.firstName, service.name, when);

    await sendSms(appt.businessId, customer.phone, body, "appointment_reminder");
    if (customer.email) {
      await sendEmail(appt.businessId, customer.email, "Appointment reminder", body, "appointment_reminder");
    }

    // Stamp AFTER a successful send so a failure leaves it re-tryable next run.
    await prisma.appointment.update({
      where: { id: appt.id },
      data: { reminderSentAt: new Date() },
    });
    sent++;
  }

  console.log(`[remind] sent ${sent} reminder(s).`);
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
