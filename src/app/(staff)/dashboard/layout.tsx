import { redirect } from "next/navigation";
import { getSessionContext } from "@/lib/auth";
import { getShellData } from "@/lib/shell";
import { resolveBranding } from "@/lib/branding";
import { AppShell } from "@/components/AppShell";
import { BrandingProvider } from "@/components/BrandingProvider";

export default async function StaffLayout({ children }: { children: React.ReactNode }) {
  const ctx = await getSessionContext();
  if (!ctx) redirect("/login");

  const shell = await getShellData();
  // Staff dashboard uses the logged-in user's own resolved branding.
  const branding = await resolveBranding(ctx.businessId, { userId: ctx.userId });
  return (
    <BrandingProvider branding={branding} className="min-h-screen">
      <AppShell
        brand={shell?.businessName ?? "Business"}
        userName={shell?.userName ?? ""}
        role={ctx.role === "ADMIN" ? "Admin" : "Staff"}
        links={[
          { href: "/dashboard", label: "Dashboard" },
          { href: "/dashboard/calendar", label: "Calendar" },
          { href: "/dashboard/approvals", label: "Approvals" },
          { href: "/dashboard/schedule", label: "Schedule" },
          { href: "/dashboard/inventory", label: "Inventory" },
          { href: "/dashboard/stock", label: "Stock" },
          { href: "/dashboard/reconcile", label: "Reconcile" },
          { href: "/dashboard/reports", label: "Reports" },
          { href: "/dashboard/branding", label: "Branding" },
        ]}
      >
        {children}
      </AppShell>
    </BrandingProvider>
  );
}
