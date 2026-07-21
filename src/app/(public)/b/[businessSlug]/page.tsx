import Link from "next/link";
import { notFound } from "next/navigation";
import { getBookingBusiness, getBookingLocations } from "@/lib/booking";
import { resolveBranding } from "@/lib/branding";
import { BrandingProvider } from "@/components/BrandingProvider";

// Step 1: pick a location. Business landing → business-level branding.
export default async function LocationPicker({
  params,
}: {
  params: Promise<{ businessSlug: string }>;
}) {
  const { businessSlug } = await params;
  const business = await getBookingBusiness(businessSlug);
  if (!business) notFound();

  const locations = await getBookingLocations(business.id);
  const branding = await resolveBranding(business.id);

  return (
    <BrandingProvider branding={branding} showBanner>
    <section>
      <h1 className="text-2xl font-semibold mb-1">{business.name}</h1>
      <p className="text-gray-500 mb-6">Choose a location to get started.</p>

      {locations.length === 0 ? (
        <p className="text-gray-500">No locations are available for booking yet.</p>
      ) : (
        <ul className="space-y-3" data-testid="location-list">
          {locations.map((l) => (
            <li key={l.id}>
              <Link
                href={`/b/${businessSlug}/${l.id}`}
                className="block rounded-lg bg-white p-4 shadow hover:ring-2 hover:ring-offset-1"
                data-testid="location-item"
              >
                <div className="font-medium">{l.name}</div>
                <div className="text-sm text-gray-500">{l.address}</div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
    </BrandingProvider>
  );
}
