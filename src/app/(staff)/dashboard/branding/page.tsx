import { getSessionContext } from "@/lib/auth";
import { getBrandingEditorData } from "@/lib/branding";
import { BrandingEditor } from "@/components/BrandingEditor";

// Staff edit their OWN branding. It renders on their public booking pages
// (service picker, calendar, manage) ahead of location/business branding.
export default async function StaffBrandingPage() {
  const ctx = await getSessionContext();
  if (!ctx) return null;

  const data = await getBrandingEditorData(ctx);

  return (
    <section>
      <h1 className="text-2xl font-semibold mb-1">My branding</h1>
      <p className="text-gray-500 mb-6">
        Colors, logo, and banner customers see when they book with you. Your
        branding takes priority over the location and business defaults.
      </p>

      <BrandingEditor
        target={{ kind: "user" }}
        heading="Your branding"
        description="Applied to your public booking pages."
        initial={{
          primaryColor: data.user.primaryColor,
          accentColor: data.user.accentColor,
          logoPath: data.user.logoPath,
          logoUrl: data.user.logoUrl,
          bannerPath: data.user.bannerPath,
          bannerUrl: data.user.bannerUrl,
        }}
      />
    </section>
  );
}
