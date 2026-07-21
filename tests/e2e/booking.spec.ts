import { test, expect } from "@playwright/test";

// Full Phase 3 flow, run under both the desktop (1280px) and mobile (375px)
// projects from playwright.config.ts:
//   1. anonymous customer books an appointment through the public pages
//   2. staff (bella, who requires approval) logs in and approves it
//   3. a second anonymous customer sees that slot X-ed out in red, no details
//
// The two projects run sequentially (workers:1); each dynamically picks the
// FIRST open slot, so the second project simply books a different one.

const STAFF_EMAIL = "bella@acme.test";
const STAFF_NAME = "Bella Barber";
const LOCATION_NAME = "Acme Downtown";
const PASSWORD = "password123";

test("book → approve → slot is X-ed out to the next customer", async ({ page }, testInfo) => {
  const tag = testInfo.project.name; // "desktop" | "mobile"
  const lastName = `Ztest${tag}`;
  const phone = tag === "mobile" ? "+15550001111" : "+15550002222";

  // --- 1. Anonymous customer walks the public booking funnel ---------------
  await page.goto("/b/acme-styling");
  await page.getByTestId("location-item").filter({ hasText: LOCATION_NAME }).click();

  await page.getByTestId("staff-item").filter({ hasText: STAFF_NAME }).click();

  // Prices must be visible on the service picker.
  await expect(page.getByTestId("service-price").first()).toContainText("$");
  await page.getByTestId("service-item").first().click();

  // Calendar loads; grab the first open slot.
  await page.waitForSelector('[data-testid="slot-grid"]');
  const openSlot = page.locator('button[data-taken="false"]').first();
  await expect(openSlot).toBeVisible();
  const bookedIso = await openSlot.getAttribute("data-slot");
  const bookedTime = (await openSlot.innerText()).trim();
  expect(bookedIso).toBeTruthy();
  await openSlot.click();

  // Booking form.
  await page.getByTestId("booking-form").waitFor();
  await page.locator("#firstName").fill("Cust");
  await page.locator("#lastName").fill(lastName);
  await page.locator("#phone").fill(phone);
  await page.getByTestId("confirm-booking").click();

  // bella requires approval → REQUESTED.
  await expect(page.getByTestId("booking-confirmation")).toContainText("Request submitted");

  // --- 2. Staff logs in and approves the request --------------------------
  await page.goto("/login");
  await page.getByLabel("Email").fill(STAFF_EMAIL);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL("**/dashboard");

  await page.goto("/dashboard/approvals");
  const myRequest = page.getByTestId("approval-item").filter({ hasText: lastName });
  await expect(myRequest).toBeVisible();
  await myRequest.getByTestId("approve-btn").click();
  // Item leaves the queue once approved.
  await expect(page.getByTestId("approval-item").filter({ hasText: lastName })).toHaveCount(0);

  // It now shows on the staff calendar as CONFIRMED with full detail.
  await page.goto("/dashboard/calendar");
  const calItem = page.getByTestId("calendar-item").filter({ hasText: lastName });
  await expect(calItem).toBeVisible();
  await expect(calItem).toContainText("CONFIRMED");

  // Drop the session so the next visit is a fresh anonymous customer.
  await page.context().clearCookies();

  // --- 3. A second anonymous customer sees the slot X-ed out, no details ---
  await page.goto("/b/acme-styling");
  await page.getByTestId("location-item").filter({ hasText: LOCATION_NAME }).click();
  await page.getByTestId("staff-item").filter({ hasText: STAFF_NAME }).click();
  await page.getByTestId("service-item").first().click();
  await page.waitForSelector('[data-testid="slot-grid"]');

  const takenCell = page.locator(`[data-slot="${bookedIso}"]`);
  await expect(takenCell).toBeVisible();
  await expect(takenCell).toHaveAttribute("data-taken", "true");
  // Rendered X-ed out in red with line-through.
  await expect(takenCell).toHaveCSS("text-decoration-line", "line-through");
  const [r, g, b] = await takenCell.evaluate((el) => {
    const m = getComputedStyle(el).color.match(/\d+/g)!.map(Number);
    return [m[0], m[1], m[2]];
  });
  expect(r).toBeGreaterThan(150);
  expect(r).toBeGreaterThan(g + 60); // red clearly dominant
  expect(r).toBeGreaterThan(b + 60);
  // No details leak: only an X + time, never the customer's name.
  await expect(takenCell).toContainText(bookedTime.replace("✕ ", ""));
  await expect(takenCell).not.toContainText(lastName);
  await expect(page.getByTestId("slot-grid")).not.toContainText(lastName);
});
