import { NextResponse } from "next/server";
import { z } from "zod";
import { createBooking } from "@/lib/booking";

// Public (no auth): create a booking. Input is Zod-validated inside createBooking.
export async function POST(req: Request) {
  try {
    const body = await req.json();
    const result = await createBooking(body);
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json({ ok: false, errors: err.flatten() }, { status: 400 });
    }
    return NextResponse.json({ ok: false, error: (err as Error).message }, { status: 400 });
  }
}
