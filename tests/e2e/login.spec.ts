import { test, expect } from "@playwright/test";

// Login flow runs under both the desktop (1280px) and mobile (375px) projects
// defined in playwright.config.ts.

test("admin can sign in and reach the dashboard", async ({ page }) => {
  await page.goto("/login");

  await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();

  await page.getByLabel("Email").fill("admin@acme.test");
  await page.getByLabel("Password").fill("password123");
  await page.getByRole("button", { name: "Sign in" }).click();

  await page.waitForURL("**/admin");
  await expect(page.getByRole("heading", { name: "Admin dashboard" })).toBeVisible();
});

test("invalid credentials show an error", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("Email").fill("admin@acme.test");
  await page.getByLabel("Password").fill("wrong-password");
  await page.getByRole("button", { name: "Sign in" }).click();

  await expect(page.getByText("Invalid email or password.")).toBeVisible();
});

test("nav is responsive to viewport", async ({ page }, testInfo) => {
  await page.goto("/login");
  await page.getByLabel("Email").fill("admin@acme.test");
  await page.getByLabel("Password").fill("password123");
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL("**/admin");

  const toggle = page.getByTestId("nav-toggle");
  if (testInfo.project.name === "mobile") {
    // Hamburger visible on phone; menu opens on tap.
    await expect(toggle).toBeVisible();
    await toggle.click();
    await expect(page.getByTestId("mobile-menu")).toBeVisible();
  } else {
    // Hamburger hidden on desktop; inline nav present.
    await expect(toggle).toBeHidden();
    await expect(page.getByRole("navigation", { name: "Primary" })).toBeVisible();
  }
});
