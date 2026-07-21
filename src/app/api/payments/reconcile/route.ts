import { NextResponse } from "next/server";
import { getSessionContext } from "@/lib/auth";
import { getReconcileData } from "@/lib/payments";

// Staff (auth): reconcile view data — UNMATCHED Square payments with ranked
// Square candidates + refund alerts. Read-only.
export async function GET() {
  const ctx = await getSessionContext();
  if (!ctx) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  try {
    const res = await getReconcileData(ctx);
    return NextResponse.json({ ok: true, ...res });
  } catch (err) {
    return NextResponse.json({ ok: false, error: (err as Error).message }, { status: 400 });
  }
}
