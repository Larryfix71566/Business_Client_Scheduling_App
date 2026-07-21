import { z } from "zod";
import type { Role } from "@prisma/client";
import { prisma } from "./db";
import { tenantDb, type TenantContext } from "./tenant";
import { getImageUrl } from "./storage";

/**
 * branding.ts — Phase 8 branding resolution + persistence.
 *
 * Businesses, locations, and individual staff users can each carry a `Branding`
 * row (logo, banner, primary/accent colors). Pages render the MOST SPECIFIC
 * branding available: user → location → business. A level with no branding (no
 * `brandingId`, or a dangling one) falls through to the next; if nothing is set
 * anywhere, the shipped defaults are used.
 *
 * All tenant data access goes through `tenantDb`, so a Branding row belonging to
 * business B can never resolve for a business-A request (the scoped delegate
 * forces `where: { businessId }`). Public booking pages use the same
 * synthetic-public-context pattern booking.ts established.
 *
 * Permissions (plan): each user administers THEIR OWN branding; ADMIN
 * administers business and location branding.
 */

// ---------------------------------------------------------------------------
// Defaults — must match the shipped default look (globals.css :root vars).
// ---------------------------------------------------------------------------

export const DEFAULT_PRIMARY = "#1a1a2e";
export const DEFAULT_ACCENT = "#00ff66";

export type EffectiveBranding = {
  logoPath: string | null;
  bannerPath: string | null;
  primaryColor: string;
  accentColor: string;
  /** Convenience URLs (null when no image). Served by the uploads route. */
  logoUrl: string | null;
  bannerUrl: string | null;
};

export const DEFAULT_BRANDING: EffectiveBranding = {
  logoPath: null,
  bannerPath: null,
  primaryColor: DEFAULT_PRIMARY,
  accentColor: DEFAULT_ACCENT,
  logoUrl: null,
  bannerUrl: null,
};

type BrandingRow = {
  logoPath: string | null;
  bannerPath: string | null;
  primaryColor: string;
  accentColor: string;
};

function toEffective(row: BrandingRow): EffectiveBranding {
  return {
    logoPath: row.logoPath,
    bannerPath: row.bannerPath,
    primaryColor: row.primaryColor,
    accentColor: row.accentColor,
    logoUrl: row.logoPath ? getImageUrl(row.logoPath) : null,
    bannerUrl: row.bannerPath ? getImageUrl(row.bannerPath) : null,
  };
}

/**
 * Synthetic tenant context for branding reads that have no session (public
 * booking pages). `tenantDb` scopes purely on `businessId`; userId/role are
 * inert because every branding query filters by explicit ids, never via
 * `ownershipWhere`. Kept local to avoid importing booking.ts (which pulls in
 * notify/money) into every page that needs colors.
 */
function brandingCtx(businessId: string): TenantContext {
  return { businessId, userId: "__branding__", role: "ADMIN" as Role };
}

// ---------------------------------------------------------------------------
// Resolution (user → location → business → defaults)
// ---------------------------------------------------------------------------

/**
 * Resolve the effective branding for a page. Pass `userId` and/or `locationId`
 * to consider those levels; the most specific level that actually has a Branding
 * row wins. `businessId` is always the final fallback before defaults.
 */
export async function resolveBranding(
  businessId: string,
  opts: { userId?: string; locationId?: string } = {},
): Promise<EffectiveBranding> {
  const db = tenantDb(brandingCtx(businessId));

  // Collect candidate brandingIds most-specific first.
  const candidateIds: (string | null | undefined)[] = [];

  if (opts.userId) {
    const user = await db.user.findFirst({
      where: { id: opts.userId },
      select: { brandingId: true },
    });
    candidateIds.push(user?.brandingId);
  }
  if (opts.locationId) {
    const location = await db.location.findFirst({
      where: { id: opts.locationId },
      select: { brandingId: true },
    });
    candidateIds.push(location?.brandingId);
  }
  // Business is the tenant root (not a tenant model) — read it directly.
  const business = await prisma.business.findUnique({
    where: { id: businessId },
    select: { brandingId: true },
  });
  candidateIds.push(business?.brandingId);

  for (const id of candidateIds) {
    if (!id) continue;
    // tenant-scoped: a branding id from another business matches zero rows.
    const row = await db.branding.findFirst({ where: { id } });
    if (row) return toEffective(row as BrandingRow);
  }

  return DEFAULT_BRANDING;
}

// ---------------------------------------------------------------------------
// Contrast check (pure, unit-tested) — implemented in a dependency-free module
// so client components can import it; re-exported here for server + tests.
// ---------------------------------------------------------------------------

export {
  parseHexColor,
  relativeLuminance,
  contrastRatio,
  isLowContrastOnWhite,
  AA_NORMAL_TEXT,
} from "./branding-contrast";

// ---------------------------------------------------------------------------
// Persistence (authenticated editor)
// ---------------------------------------------------------------------------

const HEX = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

export const brandingInputSchema = z.discriminatedUnion("target", [
  z.object({
    target: z.literal("user"),
    primaryColor: z.string().regex(HEX, "Enter a hex color like #1a1a2e"),
    accentColor: z.string().regex(HEX, "Enter a hex color like #00ff66"),
    logoPath: z.string().max(300).optional().or(z.literal("")).transform((v) => v || undefined),
    bannerPath: z.string().max(300).optional().or(z.literal("")).transform((v) => v || undefined),
  }),
  z.object({
    target: z.literal("business"),
    primaryColor: z.string().regex(HEX),
    accentColor: z.string().regex(HEX),
    logoPath: z.string().max(300).optional().or(z.literal("")).transform((v) => v || undefined),
    bannerPath: z.string().max(300).optional().or(z.literal("")).transform((v) => v || undefined),
  }),
  z.object({
    target: z.literal("location"),
    locationId: z.string().min(1),
    primaryColor: z.string().regex(HEX),
    accentColor: z.string().regex(HEX),
    logoPath: z.string().max(300).optional().or(z.literal("")).transform((v) => v || undefined),
    bannerPath: z.string().max(300).optional().or(z.literal("")).transform((v) => v || undefined),
  }),
]);

export type BrandingInput = z.infer<typeof brandingInputSchema>;

type ScopedBranding = ReturnType<typeof tenantDb>["branding"];

/**
 * Create-or-update a Branding row. `existingId` is the entity's current
 * `brandingId`; if it points at a live tenant row we update in place, otherwise
 * we create a fresh row. Returns the row id to stamp back onto the entity.
 */
async function upsertBrandingRow(
  db: ReturnType<typeof tenantDb>,
  existingId: string | null | undefined,
  data: { primaryColor: string; accentColor: string; logoPath?: string; bannerPath?: string },
): Promise<string> {
  const patch = {
    primaryColor: data.primaryColor,
    accentColor: data.accentColor,
    // Only overwrite an image when a new path is supplied (keeps the old one).
    ...(data.logoPath !== undefined ? { logoPath: data.logoPath } : {}),
    ...(data.bannerPath !== undefined ? { bannerPath: data.bannerPath } : {}),
  };
  if (existingId) {
    const existing = await (db.branding as ScopedBranding).findFirst({ where: { id: existingId } });
    if (existing) {
      await (db.branding as ScopedBranding).update({ where: { id: existingId }, data: patch });
      return existingId;
    }
  }
  const created = await (db.branding as ScopedBranding).create({ data: patch });
  return (created as { id: string }).id;
}

/**
 * Persist branding for the given target, enforcing permissions:
 * a USER may only set `target: "user"` (their own); ADMIN may set any target.
 * Returns the effective branding after the write.
 */
export async function saveBranding(
  ctx: TenantContext,
  input: unknown,
): Promise<{ target: string; branding: EffectiveBranding }> {
  const data = brandingInputSchema.parse(input);
  const db = tenantDb(ctx);

  if (data.target !== "user" && ctx.role !== "ADMIN") {
    throw new Error("Only an admin can edit business or location branding");
  }

  const payload = {
    primaryColor: data.primaryColor,
    accentColor: data.accentColor,
    logoPath: data.logoPath,
    bannerPath: data.bannerPath,
  };

  if (data.target === "user") {
    const user = await db.user.findFirst({ where: { id: ctx.userId } });
    if (!user) throw new Error("User not found");
    const id = await upsertBrandingRow(db, user.brandingId, payload);
    await db.user.update({ where: { id: ctx.userId }, data: { brandingId: id } });
    return { target: "user", branding: await resolveBranding(ctx.businessId, { userId: ctx.userId }) };
  }

  if (data.target === "location") {
    const loc = await db.location.findFirst({ where: { id: data.locationId } });
    if (!loc) throw new Error("Location not found");
    const id = await upsertBrandingRow(db, loc.brandingId, payload);
    await db.location.update({ where: { id: data.locationId }, data: { brandingId: id } });
    return {
      target: "location",
      branding: await resolveBranding(ctx.businessId, { locationId: data.locationId }),
    };
  }

  // business (tenant root)
  const biz = await prisma.business.findUnique({ where: { id: ctx.businessId } });
  if (!biz) throw new Error("Business not found");
  const id = await upsertBrandingRow(db, biz.brandingId, payload);
  await prisma.business.update({ where: { id: ctx.businessId }, data: { brandingId: id } });
  return { target: "business", branding: await resolveBranding(ctx.businessId) };
}

// ---------------------------------------------------------------------------
// Editor page data
// ---------------------------------------------------------------------------

export type BrandingEditorData = {
  user: EffectiveBranding & { hasOwn: boolean };
  business: EffectiveBranding & { hasOwn: boolean };
  locations: { id: string; name: string; branding: EffectiveBranding; hasOwn: boolean }[];
};

/** Load the current branding at each level the caller may edit. */
export async function getBrandingEditorData(ctx: TenantContext): Promise<BrandingEditorData> {
  const db = tenantDb(ctx);

  const user = await db.user.findFirst({ where: { id: ctx.userId } });
  const userBranding = user?.brandingId
    ? await db.branding.findFirst({ where: { id: user.brandingId } })
    : null;

  const biz = await prisma.business.findUnique({ where: { id: ctx.businessId } });
  const bizBranding = biz?.brandingId
    ? await db.branding.findFirst({ where: { id: biz.brandingId } })
    : null;

  const locs = await db.location.findMany({ orderBy: { name: "asc" } });
  const locations = await Promise.all(
    locs.map(async (l: { id: string; name: string; brandingId: string | null }) => {
      const b = l.brandingId ? await db.branding.findFirst({ where: { id: l.brandingId } }) : null;
      return {
        id: l.id,
        name: l.name,
        branding: b ? toEffective(b as BrandingRow) : DEFAULT_BRANDING,
        hasOwn: !!b,
      };
    }),
  );

  return {
    user: { ...(userBranding ? toEffective(userBranding as BrandingRow) : DEFAULT_BRANDING), hasOwn: !!userBranding },
    business: { ...(bizBranding ? toEffective(bizBranding as BrandingRow) : DEFAULT_BRANDING), hasOwn: !!bizBranding },
    locations,
  };
}
