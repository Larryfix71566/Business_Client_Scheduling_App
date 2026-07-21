/**
 * reminders.ts — Phase 4 pure logic for the 24h reminder sweep.
 *
 * The DB call lives in `scripts/send-reminders.ts`; the "which appointments are
 * due" decision is extracted here so it is unit-testable without a database.
 *
 * Dedup: an Appointment carries `reminderSentAt`. The window query only picks
 * appointments with `reminderSentAt = null`, and the script stamps it after
 * sending — so running the script more than once a day never double-sends. The
 * ~23–25h window (rather than exactly 24h) tolerates the cron firing at a
 * slightly different minute each day without missing appointments.
 */

/** Hours-out window either side of 24h that a reminder targets. */
export const REMINDER_MIN_HOURS = 23;
export const REMINDER_MAX_HOURS = 25;

/** The absolute UTC start-time window for "starting in ~24 hours" from `now`. */
export function reminderWindow(now: Date): { gte: Date; lte: Date } {
  return {
    gte: new Date(now.getTime() + REMINDER_MIN_HOURS * 3_600_000),
    lte: new Date(now.getTime() + REMINDER_MAX_HOURS * 3_600_000),
  };
}

export type ReminderCandidate = {
  status: string;
  startsAt: Date;
  reminderSentAt: Date | null;
};

/**
 * Is this appointment due for a 24h reminder right now? Pure predicate mirroring
 * the script's query so it can be exercised in unit tests: must be CONFIRMED,
 * not already reminded, and starting inside the ~24h window.
 */
export function isDueForReminder(appt: ReminderCandidate, now: Date): boolean {
  if (appt.status !== "CONFIRMED") return false;
  if (appt.reminderSentAt !== null) return false;
  const { gte, lte } = reminderWindow(now);
  const t = appt.startsAt.getTime();
  return t >= gte.getTime() && t <= lte.getTime();
}

/** The reminder message body. */
export function buildReminderMessage(
  customerFirstName: string,
  serviceName: string,
  when: string,
): string {
  return `Hi ${customerFirstName}, this is a reminder that your ${serviceName} is coming up ${when}.`;
}
