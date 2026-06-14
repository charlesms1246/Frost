// Test stub for SvelteKit's `$env/dynamic/public` virtual module. Under plain
// vitest (no SvelteKit plugin) this module isn't provided, so the vitest config
// aliases `$env/dynamic/public` here. `flags.ts` reads `env.PUBLIC_*`; an empty
// object makes every flag fall back to its default in tests.
export const env: Record<string, string | undefined> = {};
