import Link from "next/link";
import { getSessionContext } from "@/lib/auth";
import { getShellData } from "@/lib/shell";
import { tenantDb, ownershipWhere } from "@/lib/tenant";

export default async function StaffDashboard() {
  const ctx = await getSessionContext();
  if (!ctx) return null;
  const db = tenantDb(ctx);
  const shell = await getShellData();

  // Staff see only their own; admins viewing this page see across the business.
  const [myServices, pending, upcoming] = await Promise.all([
    db.service.count({ where: ownershipWhere(ctx) }),
    db.appointment.count({ where: { ...ownershipWhere(ctx), status: "REQUESTED" } }),
    db.appointment.count({ where: { ...ownershipWhere(ctx), status: "CONFIRMED" } }),
  ]);

  const bookingPath = shell?.businessSlug ? `/b/${shell.businessSlug}` : null;

  return (
    <section>
      <h1 className="text-2xl font-semibold mb-1">Your dashboard</h1>
      <p className="text-gray-500 mb-6">Manage your services, schedule, and appointments.</p>

      <div className="grid grid-cols-2 gap-4 md:grid-cols-3 mb-6">
        <Card label="Your services" value={myServices} />
        <Card label="Pending requests" value={pending} href="/dashboard/approvals" />
        <Card label="Confirmed upcoming" value={upcoming} href="/dashboard/calendar" />
      </div>

      {bookingPath && (
        <div className="rounded-lg bg-white p-5 shadow">
          <div className="text-sm font-medium mb-1">Your public booking page</div>
          <Link href={bookingPath} className="text-blue-600 hover:underline break-all" data-testid="booking-link">
            {bookingPath}
          </Link>
        </div>
      )}
    </section>
  );
}

function Card({ label, value, href }: { label: string; value: number; href?: string }) {
  const inner = (
    <div className="rounded-lg bg-white p-5 shadow">
      <div className="text-3xl font-semibold">{value}</div>
      <div className="text-sm text-gray-500">{label}</div>
    </div>
  );
  return href ? <Link href={href}>{inner}</Link> : inner;
}
