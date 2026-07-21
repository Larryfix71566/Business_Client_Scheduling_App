import { NextResponse } from "next/server";
import { z } from "zod";
import { rescheduleByToken } from "@/lib/cancellation";

// Public (token-authenticated): customer reschedules via their magic link.
export async function POST(req: Request) {
  try {
    const body = await req.json();
    const result = await rescheduleByToken(body);
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json({ ok: false, errors: err.flatten() }, { status: 400 });
    }
    return NextResponse.json({ ok: false, error: (err as Error).message }, { status: 400 });
  }
}
