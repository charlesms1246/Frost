import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Pure unit tests — no anvil, no network. The inference transport is
    // injected as a mock in every test, so the planning loop is deterministic.
    // The on-chain integration suite runs under vitest.integration.config.ts.
    testTimeout: 10_000,
    exclude: [
      ...configDefaults.exclude,
      "**/*.integration.test.ts",
      "**/*.live.test.ts",
    ],
  },
});
