import { test, expect, type Page } from "@playwright/test";

// Phase 6 flow (SQUARE_DRIVER=fake), run under both desktop (1280px) and mobile
// (375px). Correlate-only reconciliation — no card entry anywhere.
//
// Alex Stylist's "Blowout" service consumes 1 "Premium Serum" (seeded
// ServiceProduct link), and Alex does NOT require approval, so a public booking
// is CONFIRMED immediately. Each scenario books a FRESH appointment (unique
// customer per project/scenario) so the two sequential project runs never
// collide on already-completed/paid appointments.
//
//  A) book → complete → record SQUARE payment (UNMATCHED) → reconcile view
//     suggests a fake Square payment → confirm match → PAID + serum −1
//  B) book → complete → record CASH payment → mark paid directly → PAID + serum −1

const STAFF_EMAIL = "alex@acme.test";
const STAFF_NAME = "Alex Stylist";
const LOCATION_NAME = "Acme Downtown";
const SERVICE_NAME = "Blowout";
const SERUM = "Premium Serum";
const PASSWORD = "password123";

async function login(page: Page) {
  await page.goto("/login");
  await page.locator("#email").fill(STAFF_EMAIL);
  await page.locator("#password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL("**/dashboard");
}

// Walk the public funnel and book Alex's Blowout for a uniquely-named customer.
async function bookBlowout(page: Page, lastName: string, phone: string) {
  await page.context().clearCookies();
  await page.goto("/b/acme-styling");
  await page.getByTestId("location-item").filter({ hasText: LOCATION_NAME }).click();
  await page.getByTestId("staff-item").filter({ hasText: STAFF_NAME }).click();
  await page.getByTestId("service-item").filter({ hasText: SERVICE_NAME }).click();

  await page.waitForSelector('[data-testid="slot-grid"]');
  const openSlot = page.locator('button[data-taken="false"]').first();
  await expect(openSlot).toBeVisible();
  await openSlot.click();

  await page.getByTestId("booking-form").waitFor();
  await page.locator("#firstName").fill("Pay");
  await page.locator("#lastName").fill(lastName);
  await page.locator("#phone").fill(phone);
  await page.getByTestId("confirm-booking").click();

  // Alex auto-confirms (no approval).
  await expect(page.getByTestId("booking-confirmation")).toContainText("Booking confirmed");
}

// Read the current Premium Serum on-hand quantity from Alex's stock report.
async function serumQty(page: Page): Promise<number> {
  await page.goto("/dashboard/stock");
  const item = page.getByTestId("stock-item").filter({ hasText: SERUM });
  await expect(item.getByTestId("stock-qty")).toBeVisible();
  return Number((await item.getByTestId("stock-qty").innerText()).trim());
}

// From the calendar, find the booked appointment by customer name and complete
// it, returning the calendar <li> locator.
async function completeAppointment(page: Page, lastName: string) {
  await page.goto("/dashboard/calendar");
  const item = page.getByTestId("calendar-item").filter({ hasText: lastName });
  await expect(item).toBeVisible();
  await item.getByTestId("complete-btn").click();
  await expect(item).toContainText("COMPLETED");
  return item;
}

test("Square: book → complete → record → confirm-match → PAID + inventory −1", async ({ page }, testInfo) => {
  const tag = testInfo.project.name;
  const lastName = `SqPay${tag}`;
  const phone = tag === "mobile" ? "+15550101010" : "+15550202020";

  await bookBlowout(page, lastName, phone);
  await login(page);

  const item = await completeAppointment(page, lastName);

  // Record a SQUARE payment → UNMATCHED, no stock movement yet.
  await item.getByTestId("record-payment").waitFor();
  await item.getByTestId("payment-method").selectOption("SQUARE");
  await item.getByTestId("record-payment-btn").click();
  await expect(item.getByTestId("payment-status")).toHaveText("UNMATCHED");

  const qtyBefore = await serumQty(page);

  // Reconcile: our row appears with a suggested Square candidate; confirm it.
  await page.goto("/dashboard/reconcile");
  const row = page.getByTestId("reconcile-row").filter({ hasText: lastName });
  await expect(row).toBeVisible();
  await row.getByTestId("confirm-match-btn").first().click();

  // Row leaves the unmatched list once matched.
  await expect(page.getByTestId("reconcile-row").filter({ hasText: lastName })).toHaveCount(0);

  // Calendar now shows PAID, and the serum decremented by exactly 1.
  await page.goto("/dashboard/calendar");
  const paid = page.getByTestId("calendar-item").filter({ hasText: lastName });
  await expect(paid.getByTestId("payment-status")).toHaveText("PAID");

  const qtyAfter = await serumQty(page);
  expect(qtyAfter).toBe(qtyBefore - 1);
});

test("Cash: book → complete → record → mark-paid → PAID + inventory −1", async ({ page }, testInfo) => {
  const tag = testInfo.project.name;
  const lastName = `CashPay${tag}`;
  const phone = tag === "mobile" ? "+15550303030" : "+15550404040";

  await bookBlowout(page, lastName, phone);
  await login(page);

  const item = await completeAppointment(page, lastName);

  // Record a CASH payment → UNMATCHED, no stock movement yet.
  await item.getByTestId("record-payment").waitFor();
  await item.getByTestId("payment-method").selectOption("CASH");
  await item.getByTestId("record-payment-btn").click();
  await expect(item.getByTestId("payment-status")).toHaveText("UNMATCHED");

  const qtyBefore = await serumQty(page);

  // Mark paid directly (no Square linking) → PAID + serum −1.
  await page.goto("/dashboard/calendar");
  const rec = page.getByTestId("calendar-item").filter({ hasText: lastName });
  await rec.getByTestId("mark-paid-btn").click();
  await expect(rec.getByTestId("payment-status")).toHaveText("PAID");

  const qtyAfter = await serumQty(page);
  expect(qtyAfter).toBe(qtyBefore - 1);
});
