// Test stub for SvelteKit's `$app/environment` virtual module. Under plain vitest
// (no SvelteKit plugin) this module isn't provided, so the vitest config aliases
// `$app/environment` here. Tests run in Node, so `browser` is false — store
// modules then skip localStorage and DOM access.
export const browser = false;
export const building = false;
export const dev = true;
export const version = "test";
