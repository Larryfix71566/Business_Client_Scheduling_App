import { PrismaClient, type Role, type ApptStatus } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

const WEEKLY = {
  mon: [["09:00", "17:00"]],
  tue: [["09:00", "17:00"]],
  wed: [["09:00", "17:00"]],
  thu: [["09:00", "17:00"]],
  fri: [["09:00", "17:00"]],
  sat: [] as string[][],
  sun: [] as string[][],
};

// Every seeded account uses this password for easy local sign-in.
const PASSWORD = "password123";

type UserSpec = {
  email: string;
  name: string;
  role: Role;
  requiresApproval?: boolean;
  depositEnabled?: boolean;
  depositCents?: number;
  services: { name: string; durationMin: number; priceCents: number }[];
};

type BusinessSpec = {
  slug: string;
  name: string;
  taxRateBps: number;
  // Phase 8 seed branding colors (business-level fallback + staff[0]'s own).
  brandPrimary: string;
  brandAccent: string;
  staffPrimary: string;
  staffAccent: string;
  locations: { name: string; address: string; timezone: string }[];
  users: UserSpec[];
  customers: { firstName: string; lastName: string; phone: string; email?: string }[];
};

const BUSINESSES: BusinessSpec[] = [
  {
    slug: "acme-styling",
    name: "Acme Styling",
    taxRateBps: 825,
    brandPrimary: "#2b2d42",
    brandAccent: "#ef476f",
    staffPrimary: "#0f766e",
    staffAccent: "#f4a261",
    locations: [
      { name: "Acme Downtown", address: "100 Main St", timezone: "America/New_York" },
      { name: "Acme Uptown", address: "200 High St", timezone: "America/New_York" },
    ],
    users: [
      {
        email: "admin@acme.test",
        name: "Ada Admin",
        role: "ADMIN",
        services: [
          { name: "Consultation", durationMin: 30, priceCents: 5000 },
          { name: "Full Styling", durationMin: 90, priceCents: 18000 },
          { name: "Touch Up", durationMin: 45, priceCents: 9000 },
        ],
      },
      {
        email: "alex@acme.test",
        name: "Alex Stylist",
        role: "USER",
        depositEnabled: true,
        depositCents: 2500,
        services: [
          { name: "Cut", durationMin: 45, priceCents: 6000 },
          { name: "Color", durationMin: 120, priceCents: 22000 },
          { name: "Blowout", durationMin: 30, priceCents: 4500 },
        ],
      },
      {
        email: "bella@acme.test",
        name: "Bella Barber",
        role: "USER",
        requiresApproval: true,
        services: [
          { name: "Beard Trim", durationMin: 20, priceCents: 2500 },
          { name: "Shave", durationMin: 30, priceCents: 3500 },
          { name: "Fade", durationMin: 40, priceCents: 5000 },
        ],
      },
    ],
    customers: [
      { firstName: "Carol", lastName: "Client", phone: "+15551110001", email: "carol@example.com" },
      { firstName: "Dan", lastName: "Doe", phone: "+15551110002" },
      { firstName: "Eve", lastName: "Evans", phone: "+15551110003", email: "eve@example.com" },
      { firstName: "Frank", lastName: "Fox", phone: "+15551110004" },
      { firstName: "Gina", lastName: "Gray", phone: "+15551110005" },
    ],
  },
  {
    slug: "beta-wellness",
    name: "Beta Wellness",
    taxRateBps: 700,
    brandPrimary: "#4a1d96",
    brandAccent: "#22d3ee",
    staffPrimary: "#b45309",
    staffAccent: "#84cc16",
    locations: [
      { name: "Beta Central", address: "10 Wellness Way", timezone: "America/Chicago" },
      { name: "Beta North", address: "22 Calm Ave", timezone: "America/Chicago" },
    ],
    users: [
      {
        email: "admin@beta.test",
        name: "Ben Admin",
        role: "ADMIN",
        services: [
          { name: "Intake", durationMin: 30, priceCents: 4000 },
          { name: "Deep Tissue", durationMin: 60, priceCents: 12000 },
          { name: "Assessment", durationMin: 45, priceCents: 8000 },
        ],
      },
      {
        email: "carlos@beta.test",
        name: "Carlos Coach",
        role: "USER",
        depositEnabled: true,
        depositCents: 3000,
        services: [
          { name: "Personal Training", durationMin: 60, priceCents: 9000 },
          { name: "Nutrition Plan", durationMin: 45, priceCents: 7000 },
          { name: "Mobility", durationMin: 30, priceCents: 5000 },
        ],
      },
      {
        email: "dana@beta.test",
        name: "Dana Therapist",
        role: "USER",
        requiresApproval: true,
        services: [
          { name: "Swedish Massage", durationMin: 60, priceCents: 11000 },
          { name: "Hot Stone", durationMin: 90, priceCents: 16000 },
          { name: "Stretch Session", durationMin: 30, priceCents: 4500 },
        ],
      },
    ],
    customers: [
      { firstName: "Hank", lastName: "Hill", phone: "+15552220001", email: "hank@example.com" },
      { firstName: "Iris", lastName: "Ito", phone: "+15552220002" },
      { firstName: "Jack", lastName: "Jones", phone: "+15552220003", email: "jack@example.com" },
      { firstName: "Kira", lastName: "Kim", phone: "+15552220004" },
      { firstName: "Leo", lastName: "Lopez", phone: "+15552220005" },
    ],
  },
];

async function reset() {
  // Order respects FK dependencies (children first).
  await prisma.paymentLine.deleteMany();
  await prisma.payment.deleteMany();
  await prisma.appointment.deleteMany();
  await prisma.stockAdjustment.deleteMany();
  await prisma.inventoryItem.deleteMany();
  await prisma.serviceProduct.deleteMany();
  await prisma.service.deleteMany();
  await prisma.scheduleOverride.deleteMany();
  await prisma.schedule.deleteMany();
  await prisma.dateClosure.deleteMany();
  await prisma.userLocation.deleteMany();
  await prisma.customer.deleteMany();
  await prisma.notificationLog.deleteMany();
  await prisma.user.deleteMany();
  await prisma.location.deleteMany();
  await prisma.business.deleteMany();
  // Branding has no FK relation to Business, so it is not cascade-deleted.
  await prisma.branding.deleteMany();
}

async function seedBusiness(spec: BusinessSpec) {
  const passwordHash = await bcrypt.hash(PASSWORD, 10);

  const business = await prisma.business.create({
    data: { slug: spec.slug, name: spec.name, taxRateBps: spec.taxRateBps },
  });

  const locations = [];
  for (const loc of spec.locations) {
    locations.push(
      await prisma.location.create({
        data: {
          businessId: business.id,
          name: loc.name,
          address: loc.address,
          timezone: loc.timezone,
          weeklyHours: WEEKLY,
        },
      }),
    );
  }

  for (const u of spec.users) {
    const user = await prisma.user.create({
      data: {
        businessId: business.id,
        role: u.role,
        email: u.email,
        name: u.name,
        passwordHash,
        requiresApproval: u.requiresApproval ?? false,
        depositEnabled: u.depositEnabled ?? false,
        depositCents: u.depositCents ?? 0,
      },
    });
    // Assign each user to the first location.
    await prisma.userLocation.create({
      data: { businessId: business.id, userId: user.id, locationId: locations[0].id },
    });
    // A weekly schedule template at that location (Phase 2 slot engine input).
    await prisma.schedule.create({
      data: {
        businessId: business.id,
        userId: user.id,
        locationId: locations[0].id,
        weekly: WEEKLY,
      },
    });
    for (const s of u.services) {
      await prisma.service.create({
        data: {
          businessId: business.id,
          userId: user.id,
          name: s.name,
          durationMin: s.durationMin,
          priceCents: s.priceCents,
        },
      });
    }
  }

  // Fetch the two USER-role staff for user-owned inventory.
  const staff = await prisma.user.findMany({
    where: { businessId: business.id, role: "USER" },
    orderBy: { email: "asc" },
  });

  // Phase 8 seed branding so the feature is visible on a fresh seed and the
  // user → location → business fallback is demonstrable:
  //  - a distinctive BUSINESS-level branding (the fallback), and
  //  - a distinctive USER-level branding on staff[0] (their booking pages use
  //    it; staff[1] has none, so their pages fall back to business branding).
  const bizBranding = await prisma.branding.create({
    data: { businessId: business.id, primaryColor: spec.brandPrimary, accentColor: spec.brandAccent },
  });
  await prisma.business.update({
    where: { id: business.id },
    data: { brandingId: bizBranding.id },
  });
  const userBranding = await prisma.branding.create({
    data: { businessId: business.id, primaryColor: spec.staffPrimary, accentColor: spec.staffAccent },
  });
  await prisma.user.update({
    where: { id: staff[0].id },
    data: { brandingId: userBranding.id },
  });

  // 6 inventory items: mixed owner (3 shared at locations, 3 user-owned).
  const items = [
    { name: "Shampoo (retail)", ownerLoc: 0, cost: 400, price: 1200, qty: 24, low: 5 },
    { name: "Conditioner (retail)", ownerLoc: 1, cost: 450, price: 1300, qty: 18, low: 5 },
    { name: "Towels", ownerLoc: 0, cost: 200, price: 0, qty: 40, low: 10 },
    { name: "Premium Serum", ownerUser: 0, cost: 900, price: 3500, qty: 8, low: 3 },
    { name: "Styling Wax", ownerUser: 0, cost: 300, price: 1500, qty: 12, low: 4 },
    { name: "Massage Oil", ownerUser: 1, cost: 600, price: 2000, qty: 6, low: 2 },
  ];
  const createdItems = [];
  for (const it of items) {
    createdItems.push(
      await prisma.inventoryItem.create({
        data: {
          businessId: business.id,
          locationId: it.ownerLoc !== undefined ? locations[it.ownerLoc].id : null,
          userId: it.ownerUser !== undefined ? staff[it.ownerUser].id : null,
          name: it.name,
          costCents: it.cost,
          priceCents: it.price,
          qtyOnHand: it.qty,
          lowStockAt: it.low,
        },
      }),
    );
  }

  // A sample service→product consumption link (Phase 5): staff[0]'s first
  // service consumes 1 unit of their own "Premium Serum". Phase 6 checkout uses
  // these links to decrement stock.
  const firstStaffService = await prisma.service.findFirst({
    where: { businessId: business.id, userId: staff[0].id },
    orderBy: { name: "asc" },
  });
  const serum = createdItems.find((i) => i.name === "Premium Serum");
  if (firstStaffService && serum) {
    await prisma.serviceProduct.create({
      data: {
        businessId: business.id,
        serviceId: firstStaffService.id,
        itemId: serum.id,
        qty: 1,
      },
    });
  }

  const customers = [];
  for (const c of spec.customers) {
    customers.push(
      await prisma.customer.create({
        data: {
          businessId: business.id,
          firstName: c.firstName,
          lastName: c.lastName,
          phone: c.phone,
          email: c.email ?? null,
          smsOptIn: true,
        },
      }),
    );
  }

  // A week of appointments in mixed statuses (Phase 3 seed data). Past ones are
  // history; future CONFIRMED/REQUESTED show on staff calendars / approval queues.
  // staff[0] = deposits on (no approval); staff[1] = requires approval.
  const DAY = 86_400_000;
  const now = Date.now();
  const apptPlan: { staffIdx: number; offsetDays: number; status: ApptStatus }[] = [
    { staffIdx: 0, offsetDays: -3, status: "COMPLETED" },
    { staffIdx: 0, offsetDays: -2, status: "NO_SHOW" },
    { staffIdx: 0, offsetDays: 2, status: "CONFIRMED" },
    { staffIdx: 1, offsetDays: -1, status: "CANCELLED" },
    { staffIdx: 1, offsetDays: 3, status: "REQUESTED" },
    { staffIdx: 1, offsetDays: 4, status: "CONFIRMED" },
  ];
  for (let i = 0; i < apptPlan.length; i++) {
    const p = apptPlan[i];
    const provider = staff[p.staffIdx];
    const service = await prisma.service.findFirst({
      where: { businessId: business.id, userId: provider.id },
      orderBy: { name: "asc" },
    });
    if (!service) continue;
    const startsAt = new Date(now + p.offsetDays * DAY);
    const endsAt = new Date(startsAt.getTime() + service.durationMin * 60_000);
    const appt = await prisma.appointment.create({
      data: {
        businessId: business.id,
        locationId: locations[0].id,
        userId: provider.id,
        customerId: customers[i % customers.length].id,
        serviceId: service.id,
        startsAt,
        endsAt,
        status: p.status,
        cancelledAt: p.status === "CANCELLED" ? new Date(now - DAY) : null,
      },
    });

    // Phase 6 seed: give the COMPLETED appointment an UNMATCHED SQUARE payment so
    // the reconcile view has something to show on a fresh seed (a SERVICE line
    // only — no product consumption entangled with the seeded quantities). Tax
    // comes from the business rate; tip 0. Correlate-only: not marked PAID.
    if (p.status === "COMPLETED") {
      const subtotalCents = service.priceCents;
      const taxCents = Math.round((subtotalCents * spec.taxRateBps) / 10000);
      await prisma.payment.create({
        data: {
          businessId: business.id,
          appointmentId: appt.id,
          customerId: appt.customerId,
          userId: provider.id,
          locationId: locations[0].id,
          subtotalCents,
          taxCents,
          tipCents: 0,
          method: "SQUARE",
          status: "UNMATCHED",
          lines: { create: [{ kind: "SERVICE", refId: service.id, qty: 1, unitCents: subtotalCents }] },
        },
      });
    }
  }

  return business;
}

async function main() {
  await reset();
  for (const spec of BUSINESSES) {
    const b = await seedBusiness(spec);
    console.log(`Seeded ${b.name} (${b.slug})`);
  }
  console.log(`\nAll accounts use password: ${PASSWORD}`);
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
