import { defineConfig } from "vitest/config";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import { resolve } from "node:path";

/**
 * Vitest config for the frost webview's embedding tests. Maps the `$lib` alias the
 * SvelteKit app uses so the embedding modules import the same way as in the app.
 * These tests run in Node with every external boundary (OpenRouter / Venice /
 * Discord `fetch`, Tauri `invoke`) mocked — no GUI, no network.
 *
 * The svelte plugin compiles `.svelte.ts` rune modules (e.g. the dashboard store) so
 * `$state` resolves; `conditions: ["browser"]` makes the runes use the client runtime.
 */
export default defineConfig({
  plugins: [svelte()],
  resolve: {
    alias: {
      $lib: resolve(__dirname, "src/lib"),
      // SvelteKit virtual modules aren't provided under plain vitest — stub the
      // ones our store modules touch (theme/profile import `browser`; flags.ts
      // reads PUBLIC_* env).
      "$app/environment": resolve(__dirname, "src/lib/test/app-environment-stub.ts"),
      "$env/dynamic/public": resolve(__dirname, "src/lib/test/env-dynamic-public-stub.ts"),
    },
    conditions: ["browser"],
  },
  test: {
    include: ["src/**/*.{test,e2e.test}.ts"],
  },
});
