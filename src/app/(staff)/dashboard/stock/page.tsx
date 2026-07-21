import { getSessionContext } from "@/lib/auth";
import { getStockReport } from "@/lib/inventory";

const REASON_LABEL: Record<string, string> = {
  RECEIVED: "Received",
  SOLD: "Sold",
  DAMAGED: "Damaged",
  MANUAL: "Manual",
};

function fmtWhen(iso: string): string {
  return new Date(iso).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export default async function StockReportPage() {
  const ctx = await getSessionContext();
  if (!ctx) return null;

  const { role, groups } = await getStockReport(ctx);

  return (
    <section>
      <h1 className="text-2xl font-semibold mb-1">Stock report</h1>
      <p className="text-gray-500 mb-6">
        {role === "ADMIN"
          ? "Per-location shared stock and per-staff owned stock across the business."
          : "Your own items plus shared stock at your assigned locations, with current levels and recent activity."}
      </p>

      {groups.length === 0 ? (
        <p className="text-gray-500" data-testid="stock-empty">
          No stock to report yet.
        </p>
      ) : (
        <div className="space-y-8" data-testid="stock-report">
          {groups.map((g) => (
            <div key={g.key} data-testid="stock-group" data-group-key={g.key}>
              <h2 className="text-lg font-semibold mb-3">{g.label}</h2>
              <ul className="space-y-3">
                {g.items.map((it) => (
                  <li
                    key={it.id}
                    className="rounded-lg bg-white p-4 shadow"
                    data-testid="stock-item"
                    data-item-name={it.name}
                  >
                    <div className="flex items-center justify-between gap-3 flex-wrap">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-medium">{it.name}</span>
                        {it.lowStock && (
                          <span
                            className="rounded bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700"
                            data-testid="low-stock-badge"
                          >
                            Low stock
                          </span>
                        )}
                      </div>
                      <div className="text-right">
                        <span
                          className="text-2xl font-semibold"
                          data-testid="stock-qty"
                        >
                          {it.qtyOnHand}
                        </span>
                        <span className="text-xs text-gray-500 ml-1">
                          on hand (low ≤ {it.lowStockAt})
                        </span>
                      </div>
                    </div>

                    {it.recent.length > 0 && (
                      <ul className="mt-3 divide-y rounded border text-sm" data-testid="stock-recent">
                        {it.recent.map((r, i) => (
                          <li key={i} className="flex justify-between px-3 py-1.5">
                            <span>
                              {REASON_LABEL[r.reason] ?? r.reason}{" "}
                              <span className={r.delta < 0 ? "text-red-600" : "text-green-700"}>
                                {r.delta > 0 ? `+${r.delta}` : r.delta}
                              </span>
                            </span>
                            <span className="text-gray-400">{fmtWhen(r.when)}</span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
