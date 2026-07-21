import Link from "next/link";
import { notFound } from "next/navigation";
import { getBookingBusiness, getLocationStaff } from "@/lib/booking";
import { resolveBranding } from "@/lib/branding";
import { BrandingProvider } from "@/components/BrandingProvider";

// Step 2: pick a staff member at the chosen location. Location → business branding.
export default async function StaffPicker({
  params,
}: {
  params: Promise<{ businessSlug: string; locationId: string }>;
}) {
  const { businessSlug, locationId } = await params;
  const business = await getBookingBusiness(businessSlug);
  if (!business) notFound();

  const result = await getLocationStaff(business.id, locationId);
  if (!result) notFound();
  const { location, staff } = result;
  const branding = await resolveBranding(business.id, { locationId });

  return (
    <BrandingProvider branding={branding} showBanner>
    <section>
      <Link href={`/b/${businessSlug}`} className="text-sm text-gray-500 hover:underline">
        ← Locations
      </Link>
      <h1 className="text-2xl font-semibold mt-2 mb-1">{location.name}</h1>
      <p className="text-gray-500 mb-6">Choose who you would like to book with.</p>

      {staff.length === 0 ? (
        <p className="text-gray-500">No staff are available at this location yet.</p>
      ) : (
        <ul className="space-y-3" data-testid="staff-list">
          {staff.map((s) => (
            <li key={s.id}>
              <Link
                href={`/b/${businessSlug}/${locationId}/${s.id}`}
                className="block rounded-lg bg-white p-4 shadow hover:ring-2 hover:ring-offset-1"
                data-testid="staff-item"
              >
                <div className="font-medium">{s.name}</div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
    </BrandingProvider>
  );
}
