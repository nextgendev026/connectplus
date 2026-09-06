import { test, expect } from "@playwright/test";

test("public pages render without crashing", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("body")).not.toBeEmpty();

  await page.goto("/about");
  await expect(page).toHaveTitle(/About \| connectPlus/);
});

test("sign-in page loads the credentials form", async ({ page }) => {
  await page.goto("/signin");
  await expect(page.locator("input[type='email']")).toBeVisible();
  await expect(page.locator("input[type='password']")).toBeVisible();
});