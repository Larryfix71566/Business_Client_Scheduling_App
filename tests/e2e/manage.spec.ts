import "dotenv/config";
import { test, expect, type Page, type Locator } from "@playwright/test";
import { PrismaClient } from "@prisma/client";

// Phase 4 e2e: customer self-serve manage (cancel/reschedule) via the magic link.
//   Scenario A — reschedule an auto-confirmed booking to a new slot, then verify
//               the old slot is open again and the new slot is X-ed out.
//   Scenario B — an appointment INSIDE the cutoff window shows "contact the
//               business" and offers no cancel/reschedule action.
//
// Booking uses alex@acme.test (requiresApproval = false → CONFIRMED immediately),
// so the confirmation page exposes the manage link directly (realistic UX). For
// Scenario B we seed a within-cutoff appointment straight through Prisma (the
// plan's sanctioned test-setup shortcut), since a real booking that soon isn't
// reliably available.

const SLUG = "acme-styling";
const STAFF_EMAIL = "alex@acme.test";
const STAFF_NAME = "Alex Stylist";
const LOCATION_NAME = "Acme Downtown";
const MIN_OUT_MS = 26 * 3_600_000; // comfortably outside the 24h cutoff

/**
 * Pick the first open slot whose start is more than `minMs` out. When
 * `excludeDate` (a UTC calendar date "YYYY-MM-DD") is given, only considers
 * slots on a *different* date — service durations exceed the 15-min slot
 * granularity, so a same-day slot near the original booking can still
 * overlap its occupied window and would never show as "freed" after a
 * reschedule. Requiring a different date sidesteps that regardless of the
 * service's duration/buffer.
 */
async function pickOpenSlot(
  page: Page,
  minMs: number,
  excludeDate?: string,
): Promise<{ handle: Locator; iso: string; time: string }> {
  const handles = await page.locator('button[data-taken="false"]').all();
  const cutoff = Date.now() + minMs;
  for (const h of handles) {
    const iso = await h.getAttribute("data-slot");
    if (!iso) continue;
    if (excludeDate && iso.slice(0, 10) === excludeDate) continue;
    if (new Date(iso).getTime() > cutoff) {
      return { handle: h, iso, time: (await h.innerText()).trim() };
    }
  }
  throw new Error("no open slot far enough in the future");
}

/**
 * Click `reschedule-btn` and wait for the grid to actually have slot data.
 * The `reschedule-grid` container renders synchronously on mode change, before
 * its `/api/public/manage/slots` fetch resolves — so waiting only for the
 * container (rather than for a `[data-slot]` cell inside it) races the
 * "Loading available times…" state and yields zero pickable slots. The click
 * itself can also occasionally be lost to a hydration race (the page just
 * client-navigated here via the manage link, and in dev mode the client
 * component's chunk can still be compiling when the first click lands) — the
 * button is only present in "idle" mode, so a retry re-clicks it exactly when
 * it's still there.
 */
async function openRescheduleGrid(page: Page): Promise<void> {
  const btn = page.getByTestId("reschedule-btn");
  const grid = page.getByTestId("reschedule-grid");
  await btn.click();
  try {
    await grid.waitFor({ timeout: 5_000 });
  } catch {
    if (await btn.isVisible()) await btn.click();
    await grid.waitFor({ timeout: 15_000 });
  }
  await page.waitForSelector('[data-testid="reschedule-grid"] [data-slot]', { timeout: 15_000 });
}

async function walkToCalendar(page: Page) {
  await page.goto(`/b/${SLUG}`);
  await page.getByTestId("location-item").filter({ hasText: LOCATION_NAME }).click();
  await page.getByTestId("staff-item").filter({ hasText: STAFF_NAME }).click();
  await page.getByTestId("service-item").first().click();
  await page.waitForSelector('[data-testid="slot-grid"]');
}

test("customer reschedules via magic link; old slot frees, new slot fills", async ({ page }, info) => {
  const tag = info.project.name; // desktop | mobile
  const lastName = `Resched${tag}`;
  const phone = tag === "mobile" ? "+15550009111" : "+15550009222";

  // 1. Book an auto-confirmed appointment, choosing a slot well outside cutoff.
  await walkToCalendar(page);
  const original = await pickOpenSlot(page, MIN_OUT_MS);
  await original.handle.click();

  await page.getByTestId("booking-form").waitFor();
  await page.locator("#firstName").fill("Rex");
  await page.locator("#lastName").fill(lastName);
  await page.locator("#phone").fill(phone);
  await page.getByTestId("confirm-booking").click();

  await expect(page.getByTestId("booking-confirmation")).toContainText("Booking confirmed");

  // 2. Follow the manage link exposed on the confirmation.
  const manageLink = page.getByTestId("manage-link");
  await expect(manageLink).toBeVisible();
  await manageLink.click();

  await expect(page.getByTestId("manage-page")).toBeVisible();
  await expect(page.getByTestId("manage-status")).toContainText("CONFIRMED");

  // 3. Reschedule to a different open slot (far enough from the original that
  // the two service windows can't overlap, so the old slot genuinely frees up).
  await openRescheduleGrid(page);
  const target = await pickOpenSlot(page, MIN_OUT_MS, original.iso.slice(0, 10));
  await target.handle.click();
  await expect(page.getByTestId("manage-done")).toContainText("Booking rescheduled");

  // 4. On the public calendar the OLD slot is open again, the NEW slot is taken.
  await page.context().clearCookies();
  await walkToCalendar(page);

  const oldCell = page.locator(`[data-slot="${original.iso}"]`);
  await expect(oldCell).toBeVisible();
  await expect(oldCell).toHaveAttribute("data-taken", "false");

  const newCell = page.locator(`[data-slot="${target.iso}"]`);
  await expect(newCell).toBeVisible();
  await expect(newCell).toHaveAttribute("data-taken", "true");
});

test("inside the cutoff window: contact-business message, no self-serve action", async ({ page }, info) => {
  const tag = info.project.name;
  const phone = tag === "mobile" ? "+15550008111" : "+15550008222";

  // Seed a CONFIRMED appointment starting in 3h (inside the 24h cutoff).
  const prisma = new PrismaClient();
  let manageToken = "";
  try {
    const business = await prisma.business.findUniqueOrThrow({ where: { slug: SLUG } });
    const location = await prisma.location.findFirstOrThrow({
      where: { businessId: business.id, name: LOCATION_NAME },
    });
    const staff = await prisma.user.findFirstOrThrow({
      where: { businessId: business.id, email: STAFF_EMAIL },
    });
    const service = await prisma.service.findFirstOrThrow({
      where: { businessId: business.id, userId: staff.id },
      orderBy: { name: "asc" },
    });
    const customer = await prisma.customer.upsert({
      where: { businessId_phone: { businessId: business.id, phone } },
      update: {},
      create: {
        businessId: business.id,
        firstName: "Soon",
        lastName: `Cutoff${tag}`,
        phone,
      },
    });
    const startsAt = new Date(Date.now() + 3 * 3_600_000);
    const appt = await prisma.appointment.create({
      data: {
        businessId: business.id,
        locationId: location.id,
        userId: staff.id,
        customerId: customer.id,
        serviceId: service.id,
        startsAt,
        endsAt: new Date(startsAt.getTime() + service.durationMin * 60_000),
        status: "CONFIRMED",
      },
    });
    manageToken = appt.manageToken;
  } finally {
    await prisma.$disconnect();
  }

  await page.goto(`/b/${SLUG}/manage/${manageToken}`);
  await expect(page.getByTestId("manage-page")).toBeVisible();
  // The cutoff notice is shown; no cancel/reschedule controls exist.
  await expect(page.getByTestId("manage-cutoff")).toBeVisible();
  await expect(page.getByTestId("manage-cutoff")).toContainText("contact the business");
  await expect(page.getByTestId("cancel-btn")).toHaveCount(0);
  await expect(page.getByTestId("reschedule-btn")).toHaveCount(0);
});
