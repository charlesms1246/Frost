import type { FrostConfig, ConfigSyncFn } from "$lib/stores/config.svelte";

/**
 * Default transport for `config.syncToHosted`. Mirrors the config to the hosted
 * web app so it's available across devices. The real endpoint isn't wired yet,
 * so this resolves locally after a tick. Swap for a real `fetch(...)` (or a Tauri
 * command that proxies it) once the hosted config endpoint exists.
 *
 * Honest: does NOT claim to have reached a server.
 */
export const syncConfigToHosted: ConfigSyncFn = async (_config: FrostConfig) => {
	// TODO(hosted-sync): POST to the hosted config endpoint.
	await new Promise((r) => setTimeout(r, 150));
};
