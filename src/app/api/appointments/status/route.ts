import { NextResponse } from "next/server";
import { z } from "zod";
import { getSessionContext } from "@/lib/auth";
import { staffUpdateStatus } from "@/lib/appointments";

// Staff (auth required): cancel or mark-no-show one of their appointments.
// Always available (no cutoff); ownership-scoped inside staffUpdateStatus.
export async function POST(req: Request) {
  const ctx = await getSessionContext();
  if (!ctx) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  try {
    const body = await req.json();
    const result = await staffUpdateStatus(ctx, body);
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json({ ok: false, errors: err.flatten() }, { status: 400 });
    }
    return NextResponse.json({ ok: false, error: (err as Error).message }, { status: 400 });
  }
}
