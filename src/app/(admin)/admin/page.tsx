import { getSessionContext } from "@/lib/auth";
import { tenantDb } from "@/lib/tenant";

function Card({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg bg-white p-5 shadow">
      <div className="text-3xl font-semibold">{value}</div>
      <div className="text-sm text-gray-500">{label}</div>
    </div>
  );
}

export default async function AdminDashboard() {
  const ctx = await getSessionContext();
  // Layout guarantees a session; narrow for TypeScript.
  if (!ctx) return null;
  const db = tenantDb(ctx);
  const [staff, customers, services, locations] = await Promise.all([
    db.user.count(),
    db.customer.count(),
    db.service.count(),
    db.location.count(),
  ]);

  return (
    <section>
      <h1 className="text-2xl font-semibold mb-1">Admin dashboard</h1>
      <p className="text-gray-500 mb-6">Business-wide overview across all staff and locations.</p>
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <Card label="Staff" value={staff} />
        <Card label="Locations" value={locations} />
        <Card label="Services" value={services} />
        <Card label="Customers" value={customers} />
      </div>
    </section>
  );
}
