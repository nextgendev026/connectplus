import { test, expect } from "@playwright/test";

test("public pages render without crashing", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("body")).not.toBeEmpty();

  await page.goto("/about");
  // The separator is not the assertion. This pinned a `|` from before the root
  // template moved to `·`, so a test about whether the page renders was failing
  // over a piece of typography. What matters is that the brand is in the title
  // and the page's own name comes first.
  await expect(page).toHaveTitle(/^About\s*[·|—-]\s*connectPlus/);
});

test("sign-in page loads the credentials form", async ({ page }) => {
  await page.goto("/signin");
  await expect(page.locator("input[type='email']")).toBeVisible();
  await expect(page.locator("input[type='password']")).toBeVisible();
});