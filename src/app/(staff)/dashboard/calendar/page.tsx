import Link from "next/link";
import { getSessionContext } from "@/lib/auth";
import { getMyCalendar } from "@/lib/appointments";
import { getPaymentsByAppointment } from "@/lib/payments";
import { AppointmentActions } from "@/components/AppointmentActions";
import { PaymentPanel } from "@/components/PaymentPanel";

// Statuses where staff can still cancel or mark no-show.
const ACTIONABLE = new Set(["REQUESTED", "CONFIRMED"]);

// Staff calendar: the logged-in user's own appointments with full detail.
// USER sees only their own (ownershipWhere); ADMIN sees all and may filter.
export default async function CalendarPage({
  searchParams,
}: {
  searchParams: Promise<{ staff?: string }>;
}) {
  const ctx = await getSessionContext();
  if (!ctx) return null;
  const { staff: staffUserId } = await searchParams;

  const { appts, staff, isAdmin } = await getMyCalendar(ctx, staffUserId);
  // Phase 6: payment records for the COMPLETED appointments shown here.
  const payments = await getPaymentsByAppointment(
    ctx,
    appts.filter((a) => a.status === "COMPLETED").map((a) => a.id),
  );

  return (
    <section>
      <h1 className="text-2xl font-semibold mb-1">Calendar</h1>
      <p className="text-gray-500 mb-6">Your upcoming appointments.</p>

      {isAdmin && staff.length > 0 && (
        <form className="mb-5 flex items-center gap-2 text-sm" method="get">
          <label htmlFor="staff" className="font-medium">Staff</label>
          <select
            id="staff"
            name="staff"
            defaultValue={staffUserId ?? ""}
            className="rounded border border-gray-300 px-2 py-1"
          >
            <option value="">All staff</option>
            {staff.map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
          <button type="submit" className="rounded bg-gray-200 px-3 py-1 hover:bg-gray-300">
            Filter
          </button>
        </form>
      )}

      {appts.length === 0 ? (
        <p className="text-gray-500">
          No appointments yet. Share your{" "}
          <Link href="/dashboard" className="text-blue-600 hover:underline">
            booking link
          </Link>{" "}
          to start taking bookings.
        </p>
      ) : (
        <ul className="space-y-3" data-testid="calendar-list">
          {appts.map((a) => (
            <li key={a.id} className="rounded-lg bg-white p-4 shadow" data-testid="calendar-item">
              <div className="flex items-center justify-between flex-wrap gap-2">
                <div className="font-medium">{a.when}</div>
                <StatusBadge status={a.status} />
              </div>
              <div className="text-sm text-gray-700 mt-1">
                {a.serviceName} · {a.priceLabel}
              </div>
              <div className="text-sm text-gray-500">
                {a.customerName} · {a.customerPhone}
              </div>
              {isAdmin && (
                <div className="text-xs text-gray-400 mt-1">
                  {a.staffName} · {a.locationName}
                </div>
              )}
              {ACTIONABLE.has(a.status) && (
                <AppointmentActions appointmentId={a.id} showComplete={a.status === "CONFIRMED"} />
              )}
              {a.status === "COMPLETED" && (
                <PaymentPanel appointmentId={a.id} payment={payments[a.id] ?? null} />
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function StatusBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    CONFIRMED: "bg-green-100 text-green-700",
    REQUESTED: "bg-amber-100 text-amber-700",
    COMPLETED: "bg-gray-100 text-gray-600",
    NO_SHOW: "bg-red-100 text-red-700",
    CANCELLED: "bg-red-100 text-red-700",
  };
  return (
    <span className={`rounded px-2 py-0.5 text-xs font-medium ${styles[status] ?? "bg-gray-100"}`}>
      {status}
    </span>
  );
}
