import { NextResponse } from "next/server";
import { z } from "zod";
import { registerBusiness } from "@/lib/onboarding";

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { business, user } = await registerBusiness(body);
    return NextResponse.json({ ok: true, businessSlug: business.slug, email: user.email });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json({ ok: false, errors: err.flatten() }, { status: 400 });
    }
    return NextResponse.json({ ok: false, error: (err as Error).message }, { status: 400 });
  }
}
