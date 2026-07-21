import { NextResponse } from "next/server";
import { getSessionContext } from "@/lib/auth";
import { saveImage, getImageUrl, MAX_IMAGE_BYTES } from "@/lib/storage";

/**
 * Upload a branding logo/banner image. Auth-gated but touches no tenant DB model
 * — it only writes to disk via `storage.ts` (into the "branding" subdir) and
 * returns the opaque `photoPath`, which the caller persists via `PUT /api/branding`.
 * Mirrors the Phase 5 `/api/inventory/photo` pattern.
 */
export async function POST(req: Request) {
  const ctx = await getSessionContext();
  if (!ctx) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });

  try {
    const form = await req.formData();
    const file = form.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json({ ok: false, error: "No file provided" }, { status: 400 });
    }
    if (file.size > MAX_IMAGE_BYTES) {
      return NextResponse.json({ ok: false, error: "File too large" }, { status: 400 });
    }
    const data = new Uint8Array(await file.arrayBuffer());
    const photoPath = await saveImage({ data, contentType: file.type }, { subdir: "branding" });
    return NextResponse.json({ ok: true, photoPath, url: getImageUrl(photoPath) });
  } catch (err) {
    return NextResponse.json({ ok: false, error: (err as Error).message }, { status: 400 });
  }
}
