import type { MetadataRoute } from "next";

/**
 * PWA manifest (Phase 8). Served at /manifest.webmanifest with content-type
 * application/manifest+json; Next.js auto-injects the <link rel="manifest">.
 *
 * The icon is a generic BizMan placeholder (a solid rounded square with "B").
 * A business's own uploaded logo is deliberately NOT used as the install icon
 * in v1 — the manifest is app-wide and served before any tenant is resolved,
 * so there is no single business to brand it with.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "BizMan — Business Management",
    short_name: "BizMan",
    description: "Multi-tenant business management: scheduling, inventory, payments.",
    start_url: "/",
    display: "standalone",
    background_color: "#f7f7fb",
    theme_color: "#1a1a2e",
    icons: [
      {
        src: "/icon.svg",
        sizes: "any",
        type: "image/svg+xml",
        purpose: "any",
      },
      {
        src: "/icon.svg",
        sizes: "any",
        type: "image/svg+xml",
        purpose: "maskable",
      },
    ],
  };
}
