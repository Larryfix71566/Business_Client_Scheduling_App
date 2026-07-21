import { NextResponse } from "next/server";
import { z } from "zod";
import { getSessionContext } from "@/lib/auth";
import {
  financialQuerySchema,
  getFinancialReport,
  queryToPeriod,
  financialReportToCsv,
  periodLabel,
} from "@/lib/reports";

// Staff (auth): financial report CSV export. Money is emitted as decimal
// dollars. USER sees only their own payments; ADMIN the whole business (with
// optional userId/locationId filters). Numbers come from the same reports.ts
// functions the /dashboard/reports page uses (single source of truth).
export async function GET(req: Request) {
  const ctx = await getSessionContext();
  if (!ctx) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });

  try {
    const url = new URL(req.url);
    const q = financialQuerySchema.parse(Object.fromEntries(url.searchParams));
    const period = queryToPeriod(q);
    const report = await getFinancialReport(ctx, {
      period,
      userId: q.userId,
      locationId: q.locationId,
    });
    const csv = financialReportToCsv(report);
    const filename = `financial-${periodLabel(period).replace(/\s+/g, "-").toLowerCase()}.csv`;
    return new NextResponse(csv, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json({ ok: false, errors: err.flatten() }, { status: 400 });
    }
    return NextResponse.json({ ok: false, error: (err as Error).message }, { status: 400 });
  }
}
