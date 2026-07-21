import { NextResponse } from "next/server";
import { z } from "zod";
import { getBookingBusiness, getSlotGrid } from "@/lib/booking";

// Public (no auth): the customer calendar fetches the slot grid for a chosen
// staff + service. Query is Zod-validated before any DB access.
const querySchema = z.object({
  businessSlug: z.string().min(1),
  locationId: z.string().min(1),
  userId: z.string().min(1),
  serviceId: z.string().min(1),
});

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const parsed = querySchema.parse({
      businessSlug: url.searchParams.get("businessSlug"),
      locationId: url.searchParams.get("locationId"),
      userId: url.searchParams.get("userId"),
      serviceId: url.searchParams.get("serviceId"),
    });

    const business = await getBookingBusiness(parsed.businessSlug);
    if (!business) return NextResponse.json({ ok: false, error: "Unknown business" }, { status: 404 });

    const grid = await getSlotGrid(business.id, parsed.locationId, parsed.userId, parsed.serviceId);
    if (!grid) return NextResponse.json({ ok: false, error: "No availability" }, { status: 404 });

    return NextResponse.json({ ok: true, grid });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json({ ok: false, errors: err.flatten() }, { status: 400 });
    }
    return NextResponse.json({ ok: false, error: (err as Error).message }, { status: 400 });
  }
}
