import { invoke } from "@tauri-apps/api/core";

/**
 * Tauri `invoke`-backed secret storage for sub-agent EOA private keys.
 *
 * This is the desktop-app implementation of the `KeyStore` interface defined in
 * the `@frost/agent` package (`agent/src/wallet/key-store.ts`). The agent runtime
 * depends only on that interface and uses an in-memory store for tests; when the
 * runtime is embedded in this webview, `TauriKeyStore` is the implementation it is
 * given, bridging to the Rust `key_store_*` commands (DPAPI / macOS Keychain /
 * Secret Service) in `src-tauri/src/key_store.rs`.
 *
 * The interface is mirrored here rather than imported because `frost/` does not
 * (yet) depend on `@frost/agent` — the embedding decision (sidecar vs webview) is
 * still open. Keep this shape identical to the agent's `KeyStore`.
 */
export interface KeyStore {
  set(keyId: string, secret: string): Promise<void>;
  get(keyId: string): Promise<string | null>;
  has(keyId: string): Promise<boolean>;
  delete(keyId: string): Promise<void>;
}

/** Shape the Rust `KeyStoreError` serializes to (`#[serde(tag="kind", content="message")]`). */
interface KeyStoreError {
  kind: "NotFound" | "Backend";
  message: string;
}

function isKeyStoreError(e: unknown): e is KeyStoreError {
  return (
    typeof e === "object" &&
    e !== null &&
    typeof (e as Record<string, unknown>).kind === "string"
  );
}

function isNotFound(e: unknown): boolean {
  return isKeyStoreError(e) && e.kind === "NotFound";
}

function asError(e: unknown): Error {
  if (isKeyStoreError(e)) return new Error(`key_store ${e.kind}: ${e.message}`);
  if (e instanceof Error) return e;
  return new Error(typeof e === "string" ? e : JSON.stringify(e));
}

export class TauriKeyStore implements KeyStore {
  async set(keyId: string, secret: string): Promise<void> {
    try {
      // `key_store_set` takes a `StoreArgs` struct → snake_case inner fields
      // (serde), wrapped under the `args` command parameter.
      await invoke("key_store_set", {
        args: { agent_id: keyId, private_key_hex: secret },
      });
    } catch (e) {
      throw asError(e);
    }
  }

  async get(keyId: string): Promise<string | null> {
    try {
      // Bare scalar arg → Tauri maps camelCase `agentId` to Rust `agent_id`.
      return await invoke<string>("key_store_get", { agentId: keyId });
    } catch (e) {
      // A missing key is `null`, not an error — matches the KeyStore contract.
      if (isNotFound(e)) return null;
      throw asError(e);
    }
  }

  async has(keyId: string): Promise<boolean> {
    try {
      return await invoke<boolean>("key_store_has", { agentId: keyId });
    } catch (e) {
      throw asError(e);
    }
  }

  async delete(keyId: string): Promise<void> {
    try {
      await invoke("key_store_delete", { agentId: keyId });
    } catch (e) {
      // Deleting an absent key is a no-op (idempotent), matching InMemoryKeyStore.
      if (isNotFound(e)) return;
      throw asError(e);
    }
  }
}
