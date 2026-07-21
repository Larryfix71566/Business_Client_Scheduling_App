import { notFound } from "next/navigation";
import { getManageView } from "@/lib/cancellation";
import { resolveBranding } from "@/lib/branding";
import { BrandingProvider } from "@/components/BrandingProvider";
import { ManageBooking } from "@/components/ManageBooking";

// Public, login-less: a customer manages (cancel/reschedule) their booking via
// the opaque manageToken in their confirmation message. Self-serve actions are
// offered ONLY outside the business's cancelCutoffHours window; inside it, we
// show a "contact the business" message and no actions.
export default async function ManagePage({
  params,
}: {
  params: Promise<{ businessSlug: string; manageToken: string }>;
}) {
  const { businessSlug, manageToken } = await params;
  const view = await getManageView(businessSlug, manageToken);
  if (!view) notFound();

  // Manage page is staff-specific → resolve the booked staff user's branding.
  const branding = await resolveBranding(view.businessId, {
    userId: view.userId,
    locationId: view.locationId,
  });

  return (
    <BrandingProvider branding={branding} showBanner>
    <section data-testid="manage-page">
      <h1 className="text-2xl font-semibold mb-1">Your booking</h1>
      <p className="text-gray-500 mb-6">{view.businessName}</p>

      <div className="rounded-lg bg-white p-6 shadow mb-6">
        <dl className="space-y-2 text-sm">
          <div className="flex justify-between">
            <dt className="text-gray-500">When</dt>
            <dd className="font-medium" data-testid="manage-when">{view.when}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-gray-500">Service</dt>
            <dd className="font-medium">{view.serviceName}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-gray-500">With</dt>
            <dd className="font-medium">{view.staffName}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-gray-500">Location</dt>
            <dd className="font-medium">{view.locationName}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-gray-500">Status</dt>
            <dd className="font-medium" data-testid="manage-status">{view.status}</dd>
          </div>
        </dl>
      </div>

      {view.canManage ? (
        <ManageBooking
          businessSlug={view.businessSlug}
          manageToken={view.manageToken}
          serviceName={view.serviceName}
        />
      ) : view.reason === "cutoff" ? (
        <div
          className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-800"
          data-testid="manage-cutoff"
        >
          Changes to this booking are only available more than {view.cutoffHours} hours
          before your appointment. To cancel or reschedule now, please contact the
          business directly.
        </div>
      ) : (
        <div
          className="rounded-lg border border-gray-300 bg-gray-50 p-4 text-sm text-gray-600"
          data-testid="manage-inactive"
        >
          This booking is {view.status.toLowerCase()} and can no longer be changed online.
        </div>
      )}
    </section>
    </BrandingProvider>
  );
}
