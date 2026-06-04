/**
 * Default (Node) barrel for `@frost/agent`: the full browser-safe surface
 * (`./browser.js`) PLUS the two Node-only 1Shot-backed modules. Node consumers
 * (tests, a future sidecar) import from here; the webview embedding imports
 * `@frost/agent/browser` to keep `@1shotapi/client-sdk` out of the bundle.
 */
export * from "./browser.js";

// --- Node-only: 1Shot SDK-backed implementations (the live-write path) ---------
// (OneShotTransactionSubmitter + OneShotRestMethods are browser-safe — exported
// from ./browser.js — since they hit the 1Shot REST API directly, not via the SDK.)
export {
  OneShotServerWalletProvider,
  oneShotProviderFromEnv,
  type OneShotConfig,
  type OneShotLike,
  type OneShotWalletsApi,
} from "./wallet/oneshot.js";
