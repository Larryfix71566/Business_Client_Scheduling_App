import { getSessionContext } from "@/lib/auth";
import { formatCents } from "@/lib/money";
import {
  getFinancialReport,
  getOperationalReport,
  getReportFilters,
  periodRange,
  type Period,
  type FinancialRow,
} from "@/lib/reports";

// Phase 7 reporting page. A USER sees only their own numbers (ownershipWhere);
// an ADMIN sees business-wide totals with BOTH grouping dimensions (by-user and
// by-location) plus optional user/location filters. One period picker
// (month/quarter/year) drives the financial and operational sections. Money is
// shown via formatCents; CSV export links carry the current filters.

const STATUS_LABEL: Record<string, string> = {
  REQUESTED: "Requested",
  CONFIRMED: "Confirmed",
  COMPLETED: "Completed",
  CANCELLED: "Cancelled",
  NO_SHOW: "No-show",
};

type SP = {
  period?: string;
  year?: string;
  month?: string;
  quarter?: string;
  userId?: string;
  locationId?: string;
};

function resolvePeriod(sp: SP): Period {
  const now = new Date();
  const year = clampInt(sp.year, 2000, 2100, now.getUTCFullYear());
  const kind = sp.period === "quarter" || sp.period === "year" ? sp.period : "month";
  if (kind === "month") {
    return { kind, year, month: clampInt(sp.month, 1, 12, now.getUTCMonth() + 1) };
  }
  if (kind === "quarter") {
    return { kind, year, quarter: clampInt(sp.quarter, 1, 4, Math.floor(now.getUTCMonth() / 3) + 1) };
  }
  return { kind, year };
}

function clampInt(v: string | undefined, min: number, max: number, dflt: number): number {
  const n = v == null ? NaN : Number(v);
  if (!Number.isInteger(n) || n < min || n > max) return dflt;
  return n;
}

function qs(params: Record<string, string | undefined>): string {
  const u = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v) u.set(k, v);
  return u.toString();
}

export default async function ReportsPage({ searchParams }: { searchParams: Promise<SP> }) {
  const ctx = await getSessionContext();
  if (!ctx) return null;
  const sp = await searchParams;
  const isAdmin = ctx.role === "ADMIN";

  const period = resolvePeriod(sp);
  const userId = isAdmin ? sp.userId || undefined : undefined;
  const locationId = isAdmin ? sp.locationId || undefined : undefined;

  const [financial, operational, filters] = await Promise.all([
    getFinancialReport(ctx, { period, userId, locationId }),
    getOperationalReport(ctx, { range: periodRange(period), userId, locationId }),
    isAdmin ? getReportFilters(ctx) : Promise.resolve({ users: [], locations: [] }),
  ]);

  // Shared query for CSV export links + the filter form's hidden coherence.
  const baseQuery: Record<string, string | undefined> = {
    period: period.kind,
    year: String(period.year),
    month: period.kind === "month" ? String(period.month) : undefined,
    quarter: period.kind === "quarter" ? String(period.quarter) : undefined,
    userId,
    locationId,
  };
  const financialCsv = `/api/reports/financial?${qs(baseQuery)}`;
  const operationalCsv = `/api/reports/operational?${qs(baseQuery)}`;

  const noShowPct = `${(operational.noShow.rate * 100).toFixed(1)}%`;

  return (
    <section>
      <h1 className="text-2xl font-semibold mb-1">Reports</h1>
      <p className="text-gray-500 mb-6">
        {isAdmin
          ? "Business-wide financial and operational reports, grouped by staff and by location."
          : "Your own financial and operational numbers for the selected period."}
      </p>

      {/* Period + (admin) filters — a plain GET form. */}
      <form method="get" className="mb-8 flex flex-wrap items-end gap-3 text-sm" data-testid="report-filters">
        <label className="flex flex-col gap-1">
          <span className="font-medium">Period</span>
          <select name="period" defaultValue={period.kind} className="rounded border border-gray-300 px-2 py-1">
            <option value="month">Monthly</option>
            <option value="quarter">Quarterly</option>
            <option value="year">Yearly</option>
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="font-medium">Year</span>
          <input
            name="year"
            type="number"
            defaultValue={period.year}
            className="w-24 rounded border border-gray-300 px-2 py-1"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="font-medium">Month</span>
          <input
            name="month"
            type="number"
            min={1}
            max={12}
            defaultValue={period.kind === "month" ? period.month : 1}
            className="w-20 rounded border border-gray-300 px-2 py-1"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="font-medium">Quarter</span>
          <input
            name="quarter"
            type="number"
            min={1}
            max={4}
            defaultValue={period.kind === "quarter" ? period.quarter : 1}
            className="w-20 rounded border border-gray-300 px-2 py-1"
          />
        </label>
        {isAdmin && (
          <>
            <label className="flex flex-col gap-1">
              <span className="font-medium">Staff</span>
              <select name="userId" defaultValue={userId ?? ""} className="rounded border border-gray-300 px-2 py-1">
                <option value="">All staff</option>
                {filters.users.map((u) => (
                  <option key={u.id} value={u.id}>{u.name}</option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1">
              <span className="font-medium">Location</span>
              <select name="locationId" defaultValue={locationId ?? ""} className="rounded border border-gray-300 px-2 py-1">
                <option value="">All locations</option>
                {filters.locations.map((l) => (
                  <option key={l.id} value={l.id}>{l.name}</option>
                ))}
              </select>
            </label>
          </>
        )}
        <button type="submit" className="rounded bg-gray-800 px-3 py-1.5 text-white hover:bg-gray-700">
          Apply
        </button>
      </form>

      {/* ---------------- Financial ---------------- */}
      <div className="mb-10" data-testid="financial-report">
        <div className="flex items-center justify-between flex-wrap gap-2 mb-3">
          <h2 className="text-lg font-semibold">Financial · {financial.period.label}</h2>
          <a
            href={financialCsv}
            className="rounded bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700"
            data-testid="financial-csv-link"
          >
            Download CSV
          </a>
        </div>

        <div className="grid gap-3 sm:grid-cols-3 mb-5" data-testid="financial-total">
          <StatCard label="Net revenue" value={formatCents(financial.totals.netRevenueCents)} testId="net-revenue" />
          <StatCard label="Tax collected" value={formatCents(financial.totals.taxCents)} testId="tax-total" />
          <StatCard label="Tips" value={formatCents(financial.totals.tipCents)} testId="tip-total" />
          <StatCard label="Refunds" value={formatCents(financial.totals.refundsCents)} />
          <StatCard label="Gross revenue" value={formatCents(financial.totals.grossRevenueCents)} />
          <StatCard label="Payments" value={String(financial.totals.paymentCount)} />
        </div>

        {isAdmin && (
          <FinancialTable
            title="By staff"
            rows={financial.byUser}
            testId="financial-by-user"
          />
        )}
        <FinancialTable
          title="By location"
          rows={financial.byLocation}
          testId="financial-by-location"
        />
      </div>

      {/* ---------------- Operational ---------------- */}
      <div data-testid="operational-report">
        <div className="flex items-center justify-between flex-wrap gap-2 mb-3">
          <h2 className="text-lg font-semibold">Operational · {financial.period.label}</h2>
          <a
            href={operationalCsv}
            className="rounded bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700"
            data-testid="operational-csv-link"
          >
            Download CSV
          </a>
        </div>

        <div className="grid gap-3 sm:grid-cols-3 mb-5">
          <StatCard
            label="Appointments"
            value={String(operational.totalAppointments)}
            testId="total-appointments"
          />
          <StatCard label="No-show rate" value={noShowPct} testId="noshow-rate" />
          <StatCard
            label="Completed / No-show"
            value={`${operational.noShow.completed} / ${operational.noShow.noShow}`}
          />
        </div>

        <div className="mb-6 overflow-x-auto rounded-lg bg-white shadow" data-testid="volume-table">
          <table className="w-full text-sm">
            <thead className="text-left text-gray-500">
              <tr>
                <th className="px-4 py-2">Status</th>
                <th className="px-4 py-2 text-right">Count</th>
              </tr>
            </thead>
            <tbody>
              {operational.volume.map((v) => (
                <tr key={v.status} className="border-t" data-testid={`volume-${v.status}`}>
                  <td className="px-4 py-2">{STATUS_LABEL[v.status] ?? v.status}</td>
                  <td className="px-4 py-2 text-right" data-testid="volume-count">{v.count}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="grid gap-6 md:grid-cols-2">
          <TopServices
            title="Top services by completed appointments"
            testId="top-services-count"
            rows={operational.topServicesByCount.map((s) => ({ name: s.name, value: String(s.count) }))}
          />
          <TopServices
            title="Top services by revenue"
            testId="top-services-revenue"
            rows={operational.topServicesByRevenue.map((s) => ({
              name: s.name,
              value: formatCents(s.revenueCents),
            }))}
          />
        </div>
      </div>
    </section>
  );
}

function StatCard({ label, value, testId }: { label: string; value: string; testId?: string }) {
  return (
    <div className="rounded-lg bg-white p-4 shadow">
      <div className="text-xs uppercase tracking-wide text-gray-400">{label}</div>
      <div className="mt-1 text-xl font-semibold" data-testid={testId}>{value}</div>
    </div>
  );
}

function FinancialTable({
  title,
  rows,
  testId,
}: {
  title: string;
  rows: FinancialRow[];
  testId: string;
}) {
  return (
    <div className="mb-6">
      <h3 className="text-sm font-semibold text-gray-600 mb-2">{title}</h3>
      <div className="overflow-x-auto rounded-lg bg-white shadow" data-testid={testId}>
        <table className="w-full min-w-[560px] text-sm">
          <thead className="text-left text-gray-500">
            <tr>
              <th className="px-4 py-2">{title.replace("By ", "")}</th>
              <th className="px-4 py-2 text-right">Net</th>
              <th className="px-4 py-2 text-right">Gross</th>
              <th className="px-4 py-2 text-right">Tax</th>
              <th className="px-4 py-2 text-right">Tips</th>
              <th className="px-4 py-2 text-right">Refunds</th>
              <th className="px-4 py-2 text-right">Payments</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td className="px-4 py-3 text-gray-400" colSpan={7} data-testid="report-empty">
                  No payments in this period.
                </td>
              </tr>
            ) : (
              rows.map((r) => (
                <tr key={r.key} className="border-t" data-testid="financial-row" data-row-key={r.key}>
                  <td className="px-4 py-2 font-medium">{r.label}</td>
                  <td className="px-4 py-2 text-right">{formatCents(r.netRevenueCents)}</td>
                  <td className="px-4 py-2 text-right">{formatCents(r.grossRevenueCents)}</td>
                  <td className="px-4 py-2 text-right">{formatCents(r.taxCents)}</td>
                  <td className="px-4 py-2 text-right">{formatCents(r.tipCents)}</td>
                  <td className="px-4 py-2 text-right">{formatCents(r.refundsCents)}</td>
                  <td className="px-4 py-2 text-right">{r.paymentCount}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function TopServices({
  title,
  rows,
  testId,
}: {
  title: string;
  rows: { name: string; value: string }[];
  testId: string;
}) {
  return (
    <div className="rounded-lg bg-white p-4 shadow" data-testid={testId}>
      <h3 className="text-sm font-semibold text-gray-600 mb-2">{title}</h3>
      {rows.length === 0 ? (
        <p className="text-sm text-gray-400">No data in this period.</p>
      ) : (
        <ol className="space-y-1 text-sm">
          {rows.map((r, i) => (
            <li key={i} className="flex justify-between" data-testid="top-service-row">
              <span className="text-gray-700">{i + 1}. {r.name}</span>
              <span className="font-medium">{r.value}</span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
