import { getSessionContext } from "@/lib/auth";
import { getBrandingEditorData } from "@/lib/branding";
import { BrandingEditor } from "@/components/BrandingEditor";

// Admin edits the BUSINESS branding and EACH LOCATION's branding. (Staff edit
// their own user branding on /dashboard/branding.) Business branding is the
// final fallback; location branding overrides it for that location's pages.
export default async function AdminBrandingPage() {
  const ctx = await getSessionContext();
  if (!ctx) return null;

  const data = await getBrandingEditorData(ctx);

  return (
    <section className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold mb-1">Branding</h1>
        <p className="text-gray-500">
          Business and per-location branding. Pages render the most specific
          branding available: staff user → location → business.
        </p>
      </div>

      <BrandingEditor
        target={{ kind: "business" }}
        heading="Business branding"
        description="The default look across the business, used when no location or user branding applies."
        initial={{
          primaryColor: data.business.primaryColor,
          accentColor: data.business.accentColor,
          logoPath: data.business.logoPath,
          logoUrl: data.business.logoUrl,
          bannerPath: data.business.bannerPath,
          bannerUrl: data.business.bannerUrl,
        }}
      />

      <div className="space-y-6">
        <h2 className="text-xl font-semibold">Locations</h2>
        {data.locations.map((loc) => (
          <BrandingEditor
            key={loc.id}
            target={{ kind: "location", locationId: loc.id }}
            heading={loc.name}
            description="Overrides business branding for this location's booking pages."
            initial={{
              primaryColor: loc.branding.primaryColor,
              accentColor: loc.branding.accentColor,
              logoPath: loc.branding.logoPath,
              logoUrl: loc.branding.logoUrl,
              bannerPath: loc.branding.bannerPath,
              bannerUrl: loc.branding.bannerUrl,
            }}
          />
        ))}
      </div>
    </section>
  );
}
