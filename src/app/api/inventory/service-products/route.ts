import { NextResponse } from "next/server";
import { z } from "zod";
import { getSessionContext } from "@/lib/auth";
import { getServiceProducts, setServiceProducts } from "@/lib/inventory";

export async function GET(req: Request) {
  const ctx = await getSessionContext();
  if (!ctx) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  const serviceId = new URL(req.url).searchParams.get("serviceId");
  if (!serviceId) return NextResponse.json({ ok: false, error: "Missing serviceId" }, { status: 400 });
  try {
    const links = await getServiceProducts(ctx, serviceId);
    return NextResponse.json({ ok: true, links });
  } catch (err) {
    return NextResponse.json({ ok: false, error: (err as Error).message }, { status: 400 });
  }
}

export async function PUT(req: Request) {
  const ctx = await getSessionContext();
  if (!ctx) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  try {
    const res = await setServiceProducts(ctx, await req.json());
    return NextResponse.json({ ok: true, ...res });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json({ ok: false, errors: err.flatten() }, { status: 400 });
    }
    return NextResponse.json({ ok: false, error: (err as Error).message }, { status: 400 });
  }
}
