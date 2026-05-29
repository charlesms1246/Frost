import { type Account, type Address, type Hex } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import type { SpawnDecision } from "../types.js";
import type { HolderProvisioner } from "../translate/translate.js";
import type { KeyStore } from "./key-store.js";

/**
 * Provisions the wallet that will hold each spawned sub-mandate.
 *
 * Routing follows the locked sub-agent wallet model (HANDOFF): the executor gets
 * a 1Shot server wallet (private-mempool submission + gas sponsorship); every
 * other role gets a fresh in-process EOA whose private key is stored in the OS
 * keychain via the injected {@link KeyStore}. The holder address must be known
 * BEFORE issuance (it's an argument to `issueSubMandate`), so each call mints a
 * brand-new wallet — there is no reuse across spawns.
 *
 * It records a {@link WalletHandle} per provisioned address so the caller can,
 * after issuance, recover the signing account (EOA) or the server wallet id and
 * bind it to the resulting mandateId.
 */

export type WalletKind = "eoa" | "server";

export interface WalletHandle {
  address: Address;
  kind: WalletKind;
  /**
   * EOA: the KeyStore id holding the private key.
   * Server: the backend's wallet id.
   */
  ref: string;
  role: string;
}

/** A 1Shot-style server-wallet backend. Injected; the real client lands later. */
export interface ServerWalletProvider {
  createServerWallet(label: string): Promise<{ address: Address; walletId: string }>;
}

export interface WalletProvisionerOptions {
  keyStore: KeyStore;
  /** Server-wallet backend (1Shot). Required only if a role routes to one. */
  serverWallets?: ServerWalletProvider;
  /** Whether a decision's role needs a server wallet. Default: role starts with "executor". */
  useServerWallet?: (decision: SpawnDecision) => boolean;
  /** Namespace prefix for KeyStore ids. Default "subagent". */
  keyPrefix?: string;
  /** Session id mixed into key ids / server-wallet labels for traceability. */
  sessionId?: string;
}

export class WalletProvisioner {
  private readonly opts: WalletProvisionerOptions;
  private readonly handles = new Map<string, WalletHandle>();
  private counter = 0;

  constructor(opts: WalletProvisionerOptions) {
    this.opts = opts;
  }

  /** The {@link HolderProvisioner} to pass into `translatePlan`. */
  readonly provisionHolder: HolderProvisioner = async (decision) => {
    const routeToServer = (this.opts.useServerWallet ?? defaultUseServerWallet)(
      decision,
    );
    const handle = routeToServer
      ? await this.provisionServerWallet(decision)
      : await this.provisionEoa(decision);
    this.handles.set(handle.address.toLowerCase(), handle);
    return handle.address;
  };

  /** The handle recorded for a previously-provisioned address, if any. */
  handleFor(address: Address): WalletHandle | undefined {
    return this.handles.get(address.toLowerCase());
  }

  /** Every handle provisioned so far, in insertion order. */
  allHandles(): WalletHandle[] {
    return [...this.handles.values()];
  }

  /** Recover the signing account for a provisioned EOA holder. */
  async signerFor(address: Address): Promise<Account> {
    const handle = this.handleFor(address);
    if (!handle) throw new Error(`no provisioned wallet for ${address}`);
    if (handle.kind !== "eoa") {
      throw new Error(
        `${address} is a ${handle.kind} wallet; sign via the server-wallet backend`,
      );
    }
    const pk = await this.opts.keyStore.get(handle.ref);
    if (!pk) {
      throw new Error(`private key for ${address} not found in key store`);
    }
    return privateKeyToAccount(pk as Hex);
  }

  private async provisionEoa(decision: SpawnDecision): Promise<WalletHandle> {
    const pk = generatePrivateKey();
    const account = privateKeyToAccount(pk);
    const keyId = this.nextKeyId(decision.role);
    await this.opts.keyStore.set(keyId, pk);
    return { address: account.address, kind: "eoa", ref: keyId, role: decision.role };
  }

  private async provisionServerWallet(
    decision: SpawnDecision,
  ): Promise<WalletHandle> {
    if (!this.opts.serverWallets) {
      throw new Error(
        `role "${decision.role}" needs a server wallet but no ServerWalletProvider was configured`,
      );
    }
    const { address, walletId } = await this.opts.serverWallets.createServerWallet(
      this.label(decision.role),
    );
    return { address, kind: "server", ref: walletId, role: decision.role };
  }

  private nextKeyId(role: string): string {
    const prefix = this.opts.keyPrefix ?? "subagent";
    const session = this.opts.sessionId ?? "nosession";
    return `${prefix}:${session}:${role}:${this.counter++}`;
  }

  private label(role: string): string {
    const session = this.opts.sessionId ?? "nosession";
    return `frost:${session}:${role}`;
  }
}

function defaultUseServerWallet(decision: SpawnDecision): boolean {
  return decision.role.startsWith("executor");
}
