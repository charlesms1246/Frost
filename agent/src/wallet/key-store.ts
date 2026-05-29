/**
 * Secret storage abstraction for sub-agent EOA private keys.
 *
 * Mirrors the Tauri Rust `key_store_set` / `key_store_get` / `key_store_has` /
 * `key_store_delete` commands (DPAPI / macOS Keychain / Secret Service). In the
 * desktop app the real implementation bridges to those commands via `invoke`;
 * the agent package depends only on this interface so the planning/provisioning
 * logic is testable with {@link InMemoryKeyStore}.
 */
export interface KeyStore {
  set(keyId: string, secret: string): Promise<void>;
  get(keyId: string): Promise<string | null>;
  has(keyId: string): Promise<boolean>;
  delete(keyId: string): Promise<void>;
}

/** In-memory KeyStore for tests and non-persistent runs. NOT for production keys. */
export class InMemoryKeyStore implements KeyStore {
  private readonly m = new Map<string, string>();

  async set(keyId: string, secret: string): Promise<void> {
    this.m.set(keyId, secret);
  }
  async get(keyId: string): Promise<string | null> {
    return this.m.get(keyId) ?? null;
  }
  async has(keyId: string): Promise<boolean> {
    return this.m.has(keyId);
  }
  async delete(keyId: string): Promise<void> {
    this.m.delete(keyId);
  }
}
