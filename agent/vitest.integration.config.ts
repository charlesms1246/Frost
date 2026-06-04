import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // On-chain integration suite — forks Base Sepolia via anvil (global-setup),
    // exercises the real Planner → translatePlan → issueSubMandate path against
    // the deployed contracts. Requires foundry's anvil on PATH and network access.
    include: ["test/**/*.integration.test.ts"],
    globalSetup: ["./test/global-setup.ts"],
    pool: "forks",
    poolOptions: { forks: { singleFork: true } },
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
});
