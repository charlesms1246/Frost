import { test, expect } from "@playwright/test";

// /connect/grant-permissions/ — production permission-request UX.
//
// All cases here are pre-MetaMask: the page parses ?params= up front and
// surfaces a spec-error before any wallet interaction. We never click the
// "Approve in MetaMask" button — those paths are covered by the manual Flask
// checklist (FLASK_SMOKE_CHECKLIST.md).

test.describe("/connect/grant-permissions", () => {
  test("missing ?params= shows spec-error", async ({ page }) => {
    await page.goto("/connect/grant-permissions");
    await expect(
      page.getByText(/missing \?params=/i, { exact: false }),
    ).toBeVisible();
  });

  test("malformed JSON in ?params= shows parse error", async ({ page }) => {
    // "not-json" is not parseable; the page wraps the JSON.parse error
    // message with "?params= is not valid JSON: ...".
    await page.goto(`/connect/grant-permissions?params=${encodeURIComponent("not-json")}`);
    await expect(
      page.getByText(/not valid JSON/i, { exact: false }),
    ).toBeVisible();
  });

  test("empty array fails the non-empty check", async ({ page }) => {
    await page.goto(`/connect/grant-permissions?params=${encodeURIComponent("[]")}`);
    await expect(
      page.getByText(/non-empty array of permission requests/i, { exact: false }),
    ).toBeVisible();
  });

  test("non-array (object) fails the non-empty-array check", async ({ page }) => {
    await page.goto(`/connect/grant-permissions?params=${encodeURIComponent("{}")}`);
    await expect(
      page.getByText(/non-empty array of permission requests/i, { exact: false }),
    ).toBeVisible();
  });

  test("missing chainId on first entry produces a field-specific error", async ({ page }) => {
    const bad = JSON.stringify([{ to: "0x0", permission: { type: "x" }, rules: [] }]);
    await page.goto(`/connect/grant-permissions?params=${encodeURIComponent(bad)}`);
    await expect(
      page.getByText(/spec\[0\]\.chainId missing/i, { exact: false }),
    ).toBeVisible();
  });
});
