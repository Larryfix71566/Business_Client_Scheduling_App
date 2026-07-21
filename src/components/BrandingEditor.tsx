"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { isLowContrastOnWhite } from "@/lib/branding-contrast";

/**
 * BrandingEditor — edit the primary/accent colors, logo, and banner for one
 * target (a user's own branding, the business, or a specific location). Reuses
 * the Phase 5 photo-upload pattern (POST to /api/branding/photo → photoPath,
 * then persist via PUT /api/branding). Live preview + a WCAG contrast warning.
 */

type Target =
  | { kind: "user" }
  | { kind: "business" }
  | { kind: "location"; locationId: string };

type Initial = {
  primaryColor: string;
  accentColor: string;
  logoPath: string | null;
  logoUrl: string | null;
  bannerPath: string | null;
  bannerUrl: string | null;
};

const inputCls = "rounded border border-gray-300 px-2 py-1 text-sm";
const btnPrimary =
  "rounded px-4 py-2 text-sm font-medium text-white disabled:opacity-60";

export function BrandingEditor({
  target,
  initial,
  heading,
  description,
}: {
  target: Target;
  initial: Initial;
  heading: string;
  description?: string;
}) {
  const router = useRouter();
  const [primaryColor, setPrimaryColor] = useState(initial.primaryColor);
  const [accentColor, setAccentColor] = useState(initial.accentColor);
  const [logoPath, setLogoPath] = useState<string | null>(initial.logoPath);
  const [logoUrl, setLogoUrl] = useState<string | null>(initial.logoUrl);
  const [bannerPath, setBannerPath] = useState<string | null>(initial.bannerPath);
  const [bannerUrl, setBannerUrl] = useState<string | null>(initial.bannerUrl);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const lowContrast = isLowContrastOnWhite(primaryColor);
  const idBase = target.kind === "location" ? `loc-${target.locationId}` : target.kind;

  async function uploadImage(file: File, which: "logo" | "banner") {
    const fd = new FormData();
    fd.append("file", file);
    const res = await fetch("/api/branding/photo", { method: "POST", body: fd });
    const data = await res.json();
    if (res.ok && data.ok) {
      if (which === "logo") {
        setLogoPath(data.photoPath);
        setLogoUrl(data.url);
      } else {
        setBannerPath(data.photoPath);
        setBannerUrl(data.url);
      }
      setMsg(null);
    } else {
      setMsg(data.error ?? "Image upload failed");
    }
  }

  async function save() {
    setBusy(true);
    setMsg(null);
    const body: Record<string, unknown> = {
      target: target.kind,
      primaryColor,
      accentColor,
      logoPath: logoPath ?? undefined,
      bannerPath: bannerPath ?? undefined,
    };
    if (target.kind === "location") body.locationId = target.locationId;

    const res = await fetch("/api/branding", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    setBusy(false);
    if (res.ok && data.ok) {
      setMsg("Branding saved");
      router.refresh();
    } else {
      setMsg(data.error ?? "Could not save branding");
    }
  }

  return (
    <section
      className="rounded-lg bg-white p-6 shadow"
      data-testid="branding-editor"
      data-branding-target={target.kind}
    >
      <h2 className="text-lg font-semibold mb-1">{heading}</h2>
      {description && <p className="text-sm text-gray-500 mb-4">{description}</p>}

      <div className="grid gap-5 md:grid-cols-2">
        <label className="text-sm" htmlFor={`${idBase}-primary`}>
          <span className="block mb-1 font-medium">Primary color</span>
          <span className="flex items-center gap-2">
            <input
              id={`${idBase}-primary`}
              type="color"
              className="h-9 w-14 rounded border border-gray-300"
              value={primaryColor}
              onChange={(e) => setPrimaryColor(e.target.value)}
              data-testid="branding-primary"
            />
            <input
              className={`${inputCls} w-28`}
              value={primaryColor}
              onChange={(e) => setPrimaryColor(e.target.value)}
              aria-label="Primary color hex"
            />
          </span>
        </label>

        <label className="text-sm" htmlFor={`${idBase}-accent`}>
          <span className="block mb-1 font-medium">Accent color</span>
          <span className="flex items-center gap-2">
            <input
              id={`${idBase}-accent`}
              type="color"
              className="h-9 w-14 rounded border border-gray-300"
              value={accentColor}
              onChange={(e) => setAccentColor(e.target.value)}
              data-testid="branding-accent"
            />
            <input
              className={`${inputCls} w-28`}
              value={accentColor}
              onChange={(e) => setAccentColor(e.target.value)}
              aria-label="Accent color hex"
            />
          </span>
        </label>

        <label className="text-sm" htmlFor={`${idBase}-logo`}>
          <span className="block mb-1 font-medium">Logo</span>
          <input
            id={`${idBase}-logo`}
            type="file"
            accept="image/*"
            capture="environment"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) uploadImage(f, "logo");
            }}
            data-testid="branding-logo-input"
          />
          {logoUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={logoUrl} alt="Logo preview" className="mt-2 h-16 w-16 rounded object-cover" />
          )}
        </label>

        <label className="text-sm" htmlFor={`${idBase}-banner`}>
          <span className="block mb-1 font-medium">Banner</span>
          <input
            id={`${idBase}-banner`}
            type="file"
            accept="image/*"
            capture="environment"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) uploadImage(f, "banner");
            }}
            data-testid="branding-banner-input"
          />
          {bannerUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={bannerUrl} alt="Banner preview" className="mt-2 h-16 w-full rounded object-cover" />
          )}
        </label>
      </div>

      {lowContrast && (
        <p
          className="mt-4 rounded border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800"
          data-testid="branding-contrast-warning"
          role="status"
        >
          Low contrast: white text may be hard to read on this primary color
          (below WCAG AA). Consider a darker shade.
        </p>
      )}

      {/* Live preview using the CSS variables this branding will set. */}
      <div
        className="mt-5 rounded-lg p-4"
        style={
          {
            ["--brand-primary" as string]: primaryColor,
            ["--brand-accent" as string]: accentColor,
          } as React.CSSProperties
        }
        data-testid="branding-preview"
      >
        <div
          className="rounded p-3 text-white"
          style={{ background: "var(--brand-primary)" }}
        >
          Header preview
          <button
            type="button"
            className="ml-3 rounded px-3 py-1 text-sm font-medium text-black"
            style={{ background: "var(--brand-accent)" }}
          >
            Accent button
          </button>
        </div>
      </div>

      <div className="mt-5 flex items-center gap-3">
        <button
          type="button"
          onClick={save}
          disabled={busy}
          className={btnPrimary}
          style={{ background: "var(--brand-primary)" }}
          data-testid="branding-save"
        >
          {busy ? "Saving..." : "Save branding"}
        </button>
        {msg && (
          <span className="text-sm text-gray-600" data-testid="branding-msg">
            {msg}
          </span>
        )}
      </div>
    </section>
  );
}
