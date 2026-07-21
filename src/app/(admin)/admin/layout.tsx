import { redirect } from "next/navigation";
import { getSessionContext } from "@/lib/auth";
import { getShellData } from "@/lib/shell";
import { resolveBranding } from "@/lib/branding";
import { AppShell } from "@/components/AppShell";
import { BrandingProvider } from "@/components/BrandingProvider";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const ctx = await getSessionContext();
  if (!ctx) redirect("/login");
  if (ctx.role !== "ADMIN") redirect("/dashboard");

  const shell = await getShellData();
  const branding = await resolveBranding(ctx.businessId, { userId: ctx.userId });
  return (
    <BrandingProvider branding={branding} className="min-h-screen">
      <AppShell
        brand={shell?.businessName ?? "Business"}
        userName={shell?.userName ?? ""}
        role="Admin"
        links={[
          { href: "/admin", label: "Dashboard" },
          { href: "/admin/staff", label: "Staff" },
          { href: "/admin/branding", label: "Branding" },
        ]}
      >
        {children}
      </AppShell>
    </BrandingProvider>
  );
}
