import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomBytes } from "node:crypto";
import { prisma } from "@/lib/db";
import { tenantDb, type TenantContext } from "@/lib/tenant";

// Cross-tenant read isolation: a Business-A session must never see or mutate
// Business-B rows through the tenant helpers. Uses dedicated throwaway
// businesses so it never touches seed data.

const suffix = randomBytes(4).toString("hex");
let bizA: { id: string };
let bizB: { id: string };
let custB: { id: string };
let svcB: { id: string };
let ctxA: TenantContext;

beforeAll(async () => {
  bizA = await prisma.business.create({ data: { slug: `iso-a-${suffix}`, name: "Iso A" } });
  bizB = await prisma.business.create({ data: { slug: `iso-b-${suffix}`, name: "Iso B" } });

  const userA = await prisma.user.create({
    data: { businessId: bizA.id, role: "ADMIN", email: `a-${suffix}@t.test`, name: "A", passwordHash: "x" },
  });
  const userB = await prisma.user.create({
    data: { businessId: bizB.id, role: "ADMIN", email: `b-${suffix}@t.test`, name: "B", passwordHash: "x" },
  });

  await prisma.customer.create({
    data: { businessId: bizA.id, firstName: "Alpha", lastName: "A", phone: `+1${suffix}0001` },
  });
  custB = await prisma.customer.create({
    data: { businessId: bizB.id, firstName: "Beta", lastName: "B", phone: `+1${suffix}0002` },
  });

  await prisma.service.create({
    data: { businessId: bizA.id, userId: userA.id, name: "A Service", durationMin: 30, priceCents: 1000 },
  });
  svcB = await prisma.service.create({
    data: { businessId: bizB.id, userId: userB.id, name: "B Service", durationMin: 30, priceCents: 2000 },
  });

  ctxA = { businessId: bizA.id, userId: userA.id, role: "ADMIN" };
});

afterAll(async () => {
  await prisma.service.deleteMany({ where: { businessId: { in: [bizA.id, bizB.id] } } });
  await prisma.customer.deleteMany({ where: { businessId: { in: [bizA.id, bizB.id] } } });
  await prisma.user.deleteMany({ where: { businessId: { in: [bizA.id, bizB.id] } } });
  await prisma.business.deleteMany({ where: { id: { in: [bizA.id, bizB.id] } } });
  await prisma.$disconnect();
});

describe("cross-tenant isolation via tenantDb", () => {
  it("customer.findMany returns only the session's business", async () => {
    const rows = await tenantDb(ctxA).customer.findMany();
    expect(rows.length).toBe(1);
    expect(rows.every((c: { businessId: string }) => c.businessId === bizA.id)).toBe(true);
  });

  it("cannot read a Business-B customer by id", async () => {
    const found = await tenantDb(ctxA).customer.findUnique({ where: { id: custB.id } });
    expect(found).toBeNull();
  });

  it("cannot read a Business-B service by id", async () => {
    const found = await tenantDb(ctxA).service.findUnique({ where: { id: svcB.id } });
    expect(found).toBeNull();
  });

  it("service.findMany returns only the session's business", async () => {
    const rows = await tenantDb(ctxA).service.findMany();
    expect(rows.length).toBe(1);
    expect(rows[0].businessId).toBe(bizA.id);
  });

  it("cannot update a Business-B customer through the helper", async () => {
    const res = await tenantDb(ctxA).customer.update({
      where: { id: custB.id },
      data: { firstName: "HACKED" },
    });
    // updateMany-based scoping matches zero rows across the tenant boundary.
    expect(res.count).toBe(0);
    const still = await prisma.customer.findUnique({ where: { id: custB.id } });
    expect(still?.firstName).toBe("Beta");
  });
});
