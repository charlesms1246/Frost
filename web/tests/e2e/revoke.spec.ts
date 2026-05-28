import { test, expect } from "@playwright/test";

// /connect/revoke/ — pre-MetaMask paths only. Tests the permissionContext
// parser; happy-path (real on-chain submit) is covered by the manual Flask
// checklist.

test.describe("/connect/revoke", () => {
  test("missing ?permissionContext= shows parse error", async ({ page }) => {
    await page.goto("/connect/revoke");
    // An empty string is not 0x-prefixed → first guard fires.
    await expect(
      page.getByText(/0x-prefixed hex/i, { exact: false }),
    ).toBeVisible();
  });

  test("non-hex value shows the 0x-prefix error", async ({ page }) => {
    await page.goto("/connect/revoke?permissionContext=notHex");
    await expect(
      page.getByText(/0x-prefixed hex/i, { exact: false }),
    ).toBeVisible();
  });

  test("?params= fallback also triggers the same parser", async ({ page }) => {
    // revoke/page.tsx accepts permissionContext OR params as the input name.
    await page.goto("/connect/revoke?params=alsoNotHex");
    await expect(
      page.getByText(/0x-prefixed hex/i, { exact: false }),
    ).toBeVisible();
  });
});
