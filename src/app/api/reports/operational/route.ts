import { NextResponse } from "next/server";
import { z } from "zod";
import { getSessionContext } from "@/lib/auth";
import {
  operationalQuerySchema,
  getOperationalReport,
  queryToPeriod,
  periodRange,
  dayRange,
  operationalReportToCsv,
} from "@/lib/reports";

// Staff (auth): operational report CSV export (appointment volume, no-show
// rate, top services). The window is the period (month/quarter/year) unless an
// explicit inclusive start/end date range is supplied. USER sees only their own
// appointments; ADMIN the whole business (optional userId/locationId filters).
export async function GET(req: Request) {
  const ctx = await getSessionContext();
  if (!ctx) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });

  try {
    const url = new URL(req.url);
    const q = operationalQuerySchema.parse(Object.fromEntries(url.searchParams));
    const range = q.start && q.end ? dayRange(q.start, q.end) : periodRange(queryToPeriod(q));
    const report = await getOperationalReport(ctx, {
      range,
      userId: q.userId,
      locationId: q.locationId,
    });
    const csv = operationalReportToCsv(report);
    const tag = q.start && q.end ? `${q.start}_${q.end}` : `${q.period}-${q.year}`;
    return new NextResponse(csv, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="operational-${tag}.csv"`,
      },
    });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json({ ok: false, errors: err.flatten() }, { status: 400 });
    }
    return NextResponse.json({ ok: false, error: (err as Error).message }, { status: 400 });
  }
}
