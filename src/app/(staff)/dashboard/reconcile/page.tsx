import { getSessionContext } from "@/lib/auth";
import { getReconcileData } from "@/lib/payments";
import { ReconcileView } from "@/components/ReconcileView";

// Phase 6 reconcile page (staff/admin). Correlate-only: read Square's payment
// history and let staff confirm which Square payment matches each UNMATCHED
// local Square payment. USER sees their own; ADMIN sees the whole business.
export default async function ReconcilePage() {
  const ctx = await getSessionContext();
  if (!ctx) return null;

  const { rows, refunds } = await getReconcileData(ctx);

  return (
    <section>
      <h1 className="text-2xl font-semibold mb-1">Reconcile payments</h1>
      <p className="text-gray-500 mb-6">
        Match your recorded Square payments to the real charges in Square. Nothing is charged or
        refunded here — this only correlates records.
      </p>
      <ReconcileView rows={rows} refunds={refunds} />
    </section>
  );
}
