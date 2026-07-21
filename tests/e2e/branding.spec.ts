import { test, expect, type Page } from "@playwright/test";

// Phase 8 branding, run under both desktop (1280px) and mobile (375px):
//   1. staff (Alex) sets a distinctive primary color via /dashboard/branding
//   2. Alex's public booking page renders with that color (the BrandingProvider
//      wrapper carries data-brand-primary = the chosen color)
//   3. a DIFFERENT staff member's (Bella) public page does NOT show Alex's
//      color — Bella has no user branding, so she falls back to business branding
//   4. the PWA manifest is served and its icon resolves

const PASSWORD = "password123";
const ALEX = "alex@acme.test";
// Distinctive, and deliberately different from the seeded business color (#2b2d42).
const ALEX_COLOR = "#7c3aed";

async function login(page: Page, email: string) {
  await page.goto("/login");
  await page.locator("#email").fill(email);
  await page.locator("#password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL("**/dashboard");
}

// Walk the public funnel to a given staff member's service-picker page and
// return the resolved brand-primary on that page's BrandingProvider wrapper.
async function publicBrandPrimaryFor(page: Page, staffName: string): Promise<string | null> {
  await page.goto("/b/acme-styling");
  await page.getByTestId("location-item").first().click();
  await page.getByTestId("staff-list").waitFor();
  await page.getByTestId("staff-item").filter({ hasText: staffName }).first().click();
  // Wait for the SERVICE PICKER page (staff-specific) to actually render before
  // reading the branding root — the staff-picker page also has a root (location/
  // business branding), so reading too early would catch the wrong page.
  await page.getByTestId("service-list").waitFor();
  const root = page.locator("[data-branding-root]").first();
  return root.getAttribute("data-brand-primary");
}

test("staff branding renders on their public page; a colleague falls back", async ({ page }) => {
  await login(page, ALEX);

  // --- 1. Set a distinctive primary color -------------------------------
  await page.goto("/dashboard/branding");
  const editor = page.getByTestId("branding-editor");
  await expect(editor).toBeVisible();
  await editor.getByLabel("Primary color hex").fill(ALEX_COLOR);
  await editor.getByTestId("branding-save").click();
  await expect(page.getByTestId("branding-msg")).toHaveText("Branding saved");

  // --- 2. Alex's public page shows the chosen color ---------------------
  const alexColor = await publicBrandPrimaryFor(page, "Alex");
  expect(alexColor?.toLowerCase()).toBe(ALEX_COLOR);

  // --- 3. Bella's public page does NOT (falls back to business) ----------
  const bellaColor = await publicBrandPrimaryFor(page, "Bella");
  expect(bellaColor?.toLowerCase()).not.toBe(ALEX_COLOR);
});

test("PWA manifest is served with icons that resolve", async ({ page }) => {
  const res = await page.request.get("/manifest.webmanifest");
  expect(res.status()).toBe(200);
  expect(res.headers()["content-type"]).toContain("application/manifest+json");

  const manifest = await res.json();
  expect(manifest.name).toBeTruthy();
  expect(Array.isArray(manifest.icons)).toBe(true);
  expect(manifest.icons.length).toBeGreaterThan(0);

  // Every declared icon must resolve to a 200.
  for (const icon of manifest.icons) {
    const iconRes = await page.request.get(icon.src);
    expect(iconRes.status()).toBe(200);
  }
});
