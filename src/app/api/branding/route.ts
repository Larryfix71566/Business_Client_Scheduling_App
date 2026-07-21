import { NextResponse } from "next/server";
import { z } from "zod";
import { getSessionContext } from "@/lib/auth";
import { saveBranding } from "@/lib/branding";

/**
 * PUT /api/branding — persist branding for a target (`user` | `business` |
 * `location`). `saveBranding` enforces that a USER may only set their own
 * (`target: "user"`); ADMIN may set any. Validated by the discriminated-union
 * Zod schema in branding.ts.
 */
export async function PUT(req: Request) {
  const ctx = await getSessionContext();
  if (!ctx) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  try {
    const res = await saveBranding(ctx, await req.json());
    return NextResponse.json({ ok: true, ...res });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json({ ok: false, errors: err.flatten() }, { status: 400 });
    }
    return NextResponse.json({ ok: false, error: (err as Error).message }, { status: 400 });
  }
}
