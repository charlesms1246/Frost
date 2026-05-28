import { test, expect } from "@playwright/test";

// /connect/commit/ — pre-MetaMask paths only. Tests parseInputs(); the
// EIP-712 signing path is covered by FLASK_SMOKE_CHECKLIST.md.

const HEX_32 = "0x" + "ab".repeat(32); // 64 hex chars

test.describe("/connect/commit", () => {
  test("missing all params shows the sessionId 32-byte hex error first", async ({ page }) => {
    await page.goto("/connect/commit");
    await expect(
      page.getByText(/sessionId must be a 0x-prefixed 32-byte hex string/i, {
        exact: false,
      }),
    ).toBeVisible();
  });

  test("short sessionId fails the 32-byte hex check", async ({ page }) => {
    await page.goto("/connect/commit?sessionId=0x1234");
    await expect(
      page.getByText(/sessionId must be a 0x-prefixed 32-byte hex string/i, {
        exact: false,
      }),
    ).toBeVisible();
  });

  test("valid sessionId but missing auditRoot surfaces auditRoot error", async ({ page }) => {
    await page.goto(`/connect/commit?sessionId=${HEX_32}`);
    await expect(
      page.getByText(/auditRoot must be a 0x-prefixed 32-byte hex string/i, {
        exact: false,
      }),
    ).toBeVisible();
  });

  test("negative sessionEnd is rejected as non-positive", async ({ page }) => {
    await page.goto(
      `/connect/commit?sessionId=${HEX_32}&auditRoot=${HEX_32}&sessionEnd=-1`,
    );
    await expect(
      page.getByText(/sessionEnd must be a positive unix-seconds integer/i, {
        exact: false,
      }),
    ).toBeVisible();
  });

  test("non-numeric sessionEnd is rejected", async ({ page }) => {
    await page.goto(
      `/connect/commit?sessionId=${HEX_32}&auditRoot=${HEX_32}&sessionEnd=banana`,
    );
    await expect(
      page.getByText(/sessionEnd must be a positive unix-seconds integer/i, {
        exact: false,
      }),
    ).toBeVisible();
  });
});
