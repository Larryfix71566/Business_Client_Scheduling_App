import Link from "next/link";
import { notFound } from "next/navigation";
import { getBookingBusiness, getStaffServices } from "@/lib/booking";
import { resolveBranding } from "@/lib/branding";
import { BrandingProvider } from "@/components/BrandingProvider";
import { BookingCalendar } from "@/components/BookingCalendar";

// Step 4: pick an open slot and book. Staff-specific page → staff user's branding.
export default async function CalendarBookingPage({
  params,
}: {
  params: Promise<{ businessSlug: string; locationId: string; userId: string; serviceId: string }>;
}) {
  const { businessSlug, locationId, userId, serviceId } = await params;
  const business = await getBookingBusiness(businessSlug);
  if (!business) notFound();

  const result = await getStaffServices(business.id, userId);
  if (!result) notFound();
  const service = result.services.find((s) => s.id === serviceId);
  if (!service) notFound();
  const branding = await resolveBranding(business.id, { userId, locationId });

  return (
    <BrandingProvider branding={branding} showBanner>
    <section>
      <Link
        href={`/b/${businessSlug}/${locationId}/${userId}`}
        className="text-sm text-gray-500 hover:underline"
      >
        ← Services
      </Link>
      <h1 className="text-2xl font-semibold mt-2 mb-1">{service.name}</h1>
      <p className="text-gray-500 mb-6">
        {result.user.name} · {service.durationMin} min · {service.priceLabel}
      </p>

      <BookingCalendar
        businessSlug={businessSlug}
        locationId={locationId}
        userId={userId}
        serviceId={serviceId}
        serviceName={service.name}
      />
    </section>
    </BrandingProvider>
  );
}
