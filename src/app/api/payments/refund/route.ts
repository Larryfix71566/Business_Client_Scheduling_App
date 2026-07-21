import { NextResponse } from "next/server";
import { z } from "zod";
import { getSessionContext } from "@/lib/auth";
import { recordRefund } from "@/lib/payments";

// Staff (auth): reflect a refund observed in Square onto the local record
// (status REFUNDED + refundedCents). The app never calls Square's refund API —
// refunds happen in Square; this only mirrors them.
export async function POST(req: Request) {
  const ctx = await getSessionContext();
  if (!ctx) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  try {
    const res = await recordRefund(ctx, await req.json());
    return NextResponse.json({ ok: true, ...res });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json({ ok: false, errors: err.flatten() }, { status: 400 });
    }
    return NextResponse.json({ ok: false, error: (err as Error).message }, { status: 400 });
  }
}
