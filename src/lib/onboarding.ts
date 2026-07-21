import { randomBytes } from "node:crypto";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { prisma } from "./db";
import { tenantDb, type TenantContext } from "./tenant";

const BCRYPT_ROUNDS = 10;

// Default business open hours applied to the first location (Mon–Fri 9–5).
export const DEFAULT_WEEKLY_HOURS = {
  mon: [["09:00", "17:00"]],
  tue: [["09:00", "17:00"]],
  wed: [["09:00", "17:00"]],
  thu: [["09:00", "17:00"]],
  fri: [["09:00", "17:00"]],
  sat: [] as string[][],
  sun: [] as string[][],
};

export const registerSchema = z.object({
  businessName: z.string().min(2, "Business name is required"),
  locationName: z.string().min(1, "Location name is required"),
  address: z.string().min(1, "Address is required"),
  timezone: z.string().min(1).default("America/New_York"),
  adminName: z.string().min(1, "Your name is required"),
  email: z.string().email(),
  password: z.string().min(8, "Password must be at least 8 characters"),
});
export type RegisterInput = z.infer<typeof registerSchema>;

export const inviteSchema = z.object({
  name: z.string().min(1, "Name is required"),
  email: z.string().email(),
  requiresApproval: z.boolean().default(false),
  depositEnabled: z.boolean().default(false),
  depositCents: z.number().int().nonnegative().default(0),
});
export type InviteInput = z.infer<typeof inviteSchema>;

function slugify(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40) || "business";
}

async function uniqueSlug(name: string): Promise<string> {
  const base = slugify(name);
  let candidate = base;
  for (let i = 0; i < 50; i++) {
    const existing = await prisma.business.findUnique({ where: { slug: candidate } });
    if (!existing) return candidate;
    candidate = `${base}-${randomBytes(2).toString("hex")}`;
  }
  return `${base}-${randomBytes(4).toString("hex")}`;
}

function generateTempPassword(): string {
  // URL-safe, ~12 chars, always satisfies the 8-char minimum.
  return randomBytes(9).toString("base64").replace(/[+/=]/g, "").slice(0, 12);
}

/**
 * Business onboarding: create Business (with unique slug) + first Location +
 * the ADMIN user in one transaction. Not tenant-scoped — this mints the tenant.
 */
export async function registerBusiness(input: RegisterInput) {
  const data = registerSchema.parse(input);
  const slug = await uniqueSlug(data.businessName);
  const passwordHash = await bcrypt.hash(data.password, BCRYPT_ROUNDS);

  return prisma.$transaction(async (tx) => {
    const business = await tx.business.create({
      data: { slug, name: data.businessName },
    });
    await tx.location.create({
      data: {
        businessId: business.id,
        name: data.locationName,
        address: data.address,
        timezone: data.timezone,
        weeklyHours: DEFAULT_WEEKLY_HOURS,
      },
    });
    const user = await tx.user.create({
      data: {
        businessId: business.id,
        role: "ADMIN",
        email: data.email,
        passwordHash,
        name: data.adminName,
      },
    });
    return { business, user };
  });
}

/**
 * Admin staff invite: create a USER-role account with a temporary password.
 * The temp password is returned so the caller can display it exactly once.
 */
export async function inviteStaff(ctx: TenantContext, input: InviteInput) {
  if (ctx.role !== "ADMIN") {
    throw new Error("Only admins can invite staff.");
  }
  const data = inviteSchema.parse(input);
  const db = tenantDb(ctx);

  const existing = await db.user.findFirst({ where: { email: data.email } });
  if (existing) {
    throw new Error("A user with that email already exists in this business.");
  }

  const tempPassword = generateTempPassword();
  const passwordHash = await bcrypt.hash(tempPassword, BCRYPT_ROUNDS);

  const user = await db.user.create({
    data: {
      role: "USER",
      email: data.email,
      name: data.name,
      passwordHash,
      requiresApproval: data.requiresApproval,
      depositEnabled: data.depositEnabled,
      depositCents: data.depositCents,
    },
  });

  return { user, tempPassword };
}
