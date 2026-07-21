import { test, expect, type Page } from "@playwright/test";

// Phase 7 reporting, run under both desktop (1280px) and mobile (375px).
//
// Seed facts this leans on (fresh seed): Alex Stylist (USER, no approval) has
// exactly one NO_SHOW appointment; Bella Barber is a separate USER whose data a
// USER-scoped report must never surface. The window is the current year so the
// seed's ~week-of-now appointments are all in range regardless of month edges.
//
//  1) USER (alex) sees own operational numbers (NO_SHOW = 1), no per-staff table,
//     and no trace of colleague Bella.
//  2) ADMIN sees both grouping dimensions: by-staff AND by-location tables.
//  3) CSV export via an authenticated request: 200, text/csv, header + data row.

const YEAR = new Date().getFullYear(); // same clock as the seed
const PASSWORD = "password123";

async function login(page: Page, email: string) {
  await page.context().clearCookies();
  await page.goto("/login");
  await page.locator("#email").fill(email);
  await page.locator("#password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  // ADMIN lands on /admin, USER on /dashboard — just wait until we leave login.
  await page.waitForURL(/\/(dashboard|admin)/);
}

test("USER sees only their own report numbers (no colleague, no per-staff table)", async ({ page }) => {
  await login(page, "alex@acme.test");
  await page.goto(`/dashboard/reports?period=year&year=${YEAR}`);

  await expect(page.getByTestId("operational-report")).toBeVisible();

  // Specific seed-derived figure: Alex has exactly one NO_SHOW appointment.
  const noShowRow = page.getByTestId("volume-NO_SHOW");
  await expect(noShowRow.getByTestId("volume-count")).toHaveText("1");

  // A USER never gets the per-staff breakdown …
  await expect(page.getByTestId("financial-by-user")).toHaveCount(0);
  // … but does get their own by-location view.
  await expect(page.getByTestId("financial-by-location")).toBeVisible();

  // Another staff member's data is not identifiable on a USER report.
  await expect(page.getByText("Bella Barber")).toHaveCount(0);
});

test("ADMIN sees both grouping dimensions (by-staff and by-location tables)", async ({ page }) => {
  await login(page, "admin@acme.test");
  await page.goto(`/dashboard/reports?period=year&year=${YEAR}`);

  await expect(page.getByTestId("financial-report")).toBeVisible();
  await expect(page.getByTestId("financial-by-user")).toBeVisible();
  await expect(page.getByTestId("financial-by-location")).toBeVisible();
  await expect(page.getByTestId("operational-report")).toBeVisible();
});

test("CSV export returns text/csv with a header row and at least one data row", async ({ page }) => {
  await login(page, "alex@acme.test");

  for (const kind of ["financial", "operational"]) {
    const res = await page.request.get(`/api/reports/${kind}?period=year&year=${YEAR}`);
    expect(res.status()).toBe(200);
    expect(res.headers()["content-type"]).toContain("text/csv");
    expect(res.headers()["content-disposition"]).toContain("attachment");

    const body = await res.text();
    const rows = body.trim().split("\r\n");
    expect(rows.length).toBeGreaterThanOrEqual(2); // header + >=1 data row
    // Header row is a comma-separated list of column names.
    expect(rows[0]).toContain(",");
  }
});
