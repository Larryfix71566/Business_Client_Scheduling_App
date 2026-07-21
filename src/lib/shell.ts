import { auth } from "./auth";
import { prisma } from "./db";

// Display data for the app shell header. Business is the tenant root (not a
// tenant-scoped model), so it is fetched by its own id here in lib.
export async function getShellData() {
  const session = await auth();
  if (!session?.user?.businessId) return null;
  const business = await prisma.business.findUnique({
    where: { id: session.user.businessId },
  });
  return {
    businessName: business?.name ?? "Business",
    businessSlug: business?.slug ?? "",
    userName: session.user.name ?? session.user.email ?? "",
    role: session.user.role,
  };
}
