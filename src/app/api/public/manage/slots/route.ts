import { NextResponse } from "next/server";
import { z } from "zod";
import { getManageSlots } from "@/lib/cancellation";

// Public (token-authenticated): the reschedule slot grid for an appointment.
const querySchema = z.object({
  businessSlug: z.string().min(1),
  manageToken: z.string().min(1),
});

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const parsed = querySchema.parse({
      businessSlug: url.searchParams.get("businessSlug"),
      manageToken: url.searchParams.get("manageToken"),
    });

    const grid = await getManageSlots(parsed.businessSlug, parsed.manageToken);
    if (!grid) return NextResponse.json({ ok: false, error: "No availability" }, { status: 404 });

    return NextResponse.json({ ok: true, grid });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json({ ok: false, errors: err.flatten() }, { status: 400 });
    }
    return NextResponse.json({ ok: false, error: (err as Error).message }, { status: 400 });
  }
}
