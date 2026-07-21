import Link from "next/link";
import { notFound } from "next/navigation";
import { getBookingBusiness, getStaffServices } from "@/lib/booking";
import { resolveBranding } from "@/lib/branding";
import { BrandingProvider } from "@/components/BrandingProvider";

// Step 3: pick a service. Staff-specific page → staff user's branding
// (falls through to location/business when the user has none).
export default async function ServicePicker({
  params,
}: {
  params: Promise<{ businessSlug: string; locationId: string; userId: string }>;
}) {
  const { businessSlug, locationId, userId } = await params;
  const business = await getBookingBusiness(businessSlug);
  if (!business) notFound();

  const result = await getStaffServices(business.id, userId);
  if (!result) notFound();
  const { user, services } = result;
  const branding = await resolveBranding(business.id, { userId, locationId });

  return (
    <BrandingProvider branding={branding} showBanner>
    <section>
      <Link
        href={`/b/${businessSlug}/${locationId}`}
        className="text-sm text-gray-500 hover:underline"
      >
        ← Staff
      </Link>
      <h1 className="text-2xl font-semibold mt-2 mb-1">{user.name}</h1>
      <p className="text-gray-500 mb-6">Choose a service to see available times.</p>

      {services.length === 0 ? (
        <p className="text-gray-500">This staff member has no bookable services yet.</p>
      ) : (
        <ul className="space-y-3" data-testid="service-list">
          {services.map((s) => (
            <li key={s.id}>
              <Link
                href={`/b/${businessSlug}/${locationId}/${userId}/${s.id}`}
                className="flex items-center justify-between rounded-lg bg-white p-4 shadow hover:ring-2 hover:ring-offset-1"
                data-testid="service-item"
              >
                <span>
                  <span className="font-medium">{s.name}</span>
                  <span className="block text-sm text-gray-500">{s.durationMin} min</span>
                </span>
                <span className="font-semibold" data-testid="service-price">
                  {s.priceLabel}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
    </BrandingProvider>
  );
}
