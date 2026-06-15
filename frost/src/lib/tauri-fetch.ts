import { fetch as tauriFetch } from "@tauri-apps/plugin-http";
import type { OneShotFetch } from "@frost/agent/browser";

/**
 * 1Shot REST calls must run from the Rust backend, NOT the webview. The 1Shot API
 * (`api.1shotapi.com`) returns `Access-Control-Allow-Origin: *` together with
 * `Access-Control-Allow-Credentials: true` — a combination Chromium/WebView2 rejects, so a
 * webview `fetch` throws "Failed to fetch" (the executor's live failure). The Tauri HTTP
 * plugin performs the request in Rust (no CORS) and keeps the 1Shot secret off the page.
 *
 * A drop-in {@link OneShotFetch} for the agent's 1Shot REST clients (`OneShotRestMethods`,
 * `OneShotRestWallets`). The plugin `fetch` returns a standard `Response`, which structurally
 * satisfies the `{ ok, status, statusText, json(), text() }` the clients consume.
 */
export const oneShotTauriFetch: OneShotFetch = (url, init) =>
  tauriFetch(url, {
    method: init.method,
    headers: init.headers,
    ...(init.body !== undefined ? { body: init.body } : {}),
  });
