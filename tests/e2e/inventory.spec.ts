import { test, expect } from "@playwright/test";

// Phase 5 flow, run under both the desktop (1280px) and mobile (375px) projects:
//   1. staff (alex) logs in and creates an inventory item (manual barcode entry;
//      the camera scanner is present but unused — headless has no camera)
//   2. adjust stock: receive +10, then sell -8  →  qty 2
//   3. the per-user Stock report shows qty 2 with a low-stock badge (low ≤ 5)
//
// Each project uses a distinct item name so the two sequential runs don't collide.

const STAFF_EMAIL = "alex@acme.test";
const PASSWORD = "password123";

async function login(page: import("@playwright/test").Page) {
  await page.goto("/login");
  await page.locator("#email").fill(STAFF_EMAIL);
  await page.locator("#password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL("**/dashboard");
}

test("create item → adjust stock → low-stock badge in the stock report", async ({ page }, testInfo) => {
  const tag = testInfo.project.name; // "desktop" | "mobile"
  // Unique per run so re-running against a non-reseeded dev DB never collides.
  const itemName = `E2E Widget ${tag} ${Date.now()}`;

  await login(page);
  await page.goto("/dashboard/inventory");

  // --- 1. Create an item (manual barcode entry) ---------------------------
  await page.getByTestId("create-item-form").waitFor();
  // The camera scanner mounts without crashing the form.
  await expect(page.getByTestId("scan-btn")).toBeVisible();

  await page.getByTestId("item-name").fill(itemName);
  await page.getByTestId("item-barcode").fill("012345678905"); // manual entry works
  await page.getByTestId("item-cost").fill("200");
  await page.getByTestId("item-price").fill("900");
  await page.getByTestId("item-lowstock").fill("5");
  await page.getByTestId("create-item-btn").click();

  const card = page.getByTestId("inventory-item").filter({ hasText: itemName });
  await expect(card).toBeVisible();
  await expect(card).toContainText("012345678905"); // barcode persisted
  await expect(card.getByTestId("item-qty-value")).toHaveText("0");

  // --- 2. Receive +10 -----------------------------------------------------
  await card.getByTestId("adjust-reason").selectOption("RECEIVED");
  await card.getByTestId("adjust-delta").fill("10");
  await card.getByTestId("adjust-apply").click();

  const card10 = page.getByTestId("inventory-item").filter({ hasText: itemName });
  await expect(card10.getByTestId("item-qty-value")).toHaveText("10");
  // Not low at 10 (threshold 5).
  await expect(card10.getByTestId("low-stock-badge")).toHaveCount(0);

  // --- 2b. Sell -8  →  qty 2 (now low) ------------------------------------
  await card10.getByTestId("adjust-reason").selectOption("SOLD");
  await card10.getByTestId("adjust-delta").fill("8");
  await card10.getByTestId("adjust-apply").click();

  const card2 = page.getByTestId("inventory-item").filter({ hasText: itemName });
  await expect(card2.getByTestId("item-qty-value")).toHaveText("2");
  await expect(card2.getByTestId("low-stock-badge")).toBeVisible();

  // --- 3. Stock report shows the item under "My items" with qty 2 + badge --
  await page.goto("/dashboard/stock");
  const stockItem = page.getByTestId("stock-item").filter({ hasText: itemName });
  await expect(stockItem).toBeVisible();
  await expect(stockItem.getByTestId("stock-qty")).toHaveText("2");
  await expect(stockItem.getByTestId("low-stock-badge")).toBeVisible();
  // Recent adjustments are shown (RECEIVED +10, SOLD -8).
  await expect(stockItem.getByTestId("stock-recent")).toContainText("Sold");
  await expect(stockItem.getByTestId("stock-recent")).toContainText("Received");
});
