import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Live external-API smoke tests (1Shot, OpenRouter). No anvil. Each test
    // skips itself when its credentials are absent, so this config is safe to
    // run anywhere — it only does real work when the keys are present in
    // ../spikes/.env. Kept out of the default unit config and the anvil
    // integration config.
    include: ["test/**/*.live.test.ts"],
    testTimeout: 30_000,
  },
});
