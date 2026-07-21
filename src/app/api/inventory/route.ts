import { NextResponse } from "next/server";
import { z } from "zod";
import { getSessionContext } from "@/lib/auth";
import { createItem, updateItem, deleteItem } from "@/lib/inventory";

function fail(err: unknown) {
  if (err instanceof z.ZodError) {
    return NextResponse.json({ ok: false, errors: err.flatten() }, { status: 400 });
  }
  return NextResponse.json({ ok: false, error: (err as Error).message }, { status: 400 });
}

export async function POST(req: Request) {
  const ctx = await getSessionContext();
  if (!ctx) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  try {
    const res = await createItem(ctx, await req.json());
    return NextResponse.json({ ok: true, ...res });
  } catch (err) {
    return fail(err);
  }
}

export async function PUT(req: Request) {
  const ctx = await getSessionContext();
  if (!ctx) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  try {
    const res = await updateItem(ctx, await req.json());
    return NextResponse.json({ ok: true, ...res });
  } catch (err) {
    return fail(err);
  }
}

export async function DELETE(req: Request) {
  const ctx = await getSessionContext();
  if (!ctx) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  try {
    const res = await deleteItem(ctx, await req.json());
    return NextResponse.json({ ok: true, ...res });
  } catch (err) {
    return fail(err);
  }
}
