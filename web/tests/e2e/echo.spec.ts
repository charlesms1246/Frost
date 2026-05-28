import { test, expect } from "@playwright/test";

// /connect/echo/ — round-trip smoke page. Without challenge+port query params
// the page should immediately surface the missing-param error and never try
// to fetch.

test.describe("/connect/echo", () => {
  test("missing challenge + port shows err status with explanatory detail", async ({ page }) => {
    await page.goto("/connect/echo");

    // Status field is rendered as a <dd> next to a "status" <dt>; assert on
    // visible text instead of fishing for a testid (CLAUDE.md "Surgical
    // Changes" — don't touch the page if a visible-text selector works).
    await expect(page.getByText("missing challenge or port query param", { exact: false })).toBeVisible();

    // The status label appears in the dl. Its value should be "err".
    // Locate the <dd> immediately after the <dt> whose text is exactly "status".
    const statusValue = page
      .locator("dt")
      .filter({ hasText: /^status$/ })
      .locator("xpath=following-sibling::dd[1]");
    await expect(statusValue).toHaveText("err");
  });

  test("missing only port also errors out", async ({ page }) => {
    await page.goto("/connect/echo?challenge=abc");
    await expect(page.getByText("missing challenge or port query param", { exact: false })).toBeVisible();
  });
});
