import type { CSSProperties } from "react";
import type { EffectiveBranding } from "@/lib/branding";

/**
 * BrandingProvider — sets the `--brand-primary` / `--brand-accent` CSS variables
 * on a wrapper div so every descendant (buttons, headers) picks up the resolved
 * branding, and optionally renders the logo/banner. Server component: it takes
 * already-resolved branding (see `resolveBranding`) and holds no state.
 *
 * The wrapper exposes `data-brand-primary` / `data-brand-accent` for e2e
 * assertions and so tests can confirm which level's branding a page rendered.
 */
export function BrandingProvider({
  branding,
  children,
  showBanner = false,
  className,
}: {
  branding: EffectiveBranding;
  children: React.ReactNode;
  showBanner?: boolean;
  className?: string;
}) {
  const style = {
    "--brand-primary": branding.primaryColor,
    "--brand-accent": branding.accentColor,
  } as CSSProperties;

  return (
    <div
      style={style}
      className={className}
      data-branding-root=""
      data-brand-primary={branding.primaryColor}
      data-brand-accent={branding.accentColor}
    >
      {showBanner && (branding.bannerUrl || branding.logoUrl) && (
        <div
          className="mb-6 flex items-center gap-3 rounded-lg p-4 text-white shadow"
          style={{ background: "var(--brand-primary)" }}
          data-testid="branding-banner"
        >
          {branding.logoUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={branding.logoUrl}
              alt="Business logo"
              className="h-10 w-10 rounded object-cover bg-white/10"
            />
          )}
          {branding.bannerUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={branding.bannerUrl}
              alt=""
              className="h-10 flex-1 rounded object-cover"
            />
          )}
        </div>
      )}
      {children}
    </div>
  );
}
