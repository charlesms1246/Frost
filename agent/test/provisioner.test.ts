import type { Address, Hex } from "viem";
import { describe, expect, it } from "vitest";
import type { PlanResult, SpawnDecision } from "../src/types.js";
import { InMemoryKeyStore } from "../src/wallet/key-store.js";
import {
  WalletProvisioner,
  type ServerWalletProvider,
} from "../src/wallet/provisioner.js";
import {
  nonceCounter,
  translatePlan,
  type SubMandateIssuer,
} from "../src/translate/translate.js";

function decision(role: string): SpawnDecision {
  return {
    role,
    proposedCaveats: { capabilities: ["CAP_RPC_READ"], spendCapTotal: 1_000_000n },
    estimatedTokenCost: 0n,
    reasoning: "",
    decision: "spawned",
  };
}

const HEX_ADDR = /^0x[0-9a-fA-F]{40}$/;

describe("WalletProvisioner — EOA path", () => {
  it("mints a fresh EOA, stores its key, and recovers a matching signer", async () => {
    const keyStore = new InMemoryKeyStore();
    const p = new WalletProvisioner({ keyStore, sessionId: "s1" });

    const addr = await p.provisionHolder(decision("pricer-uniswap"));

    expect(addr).toMatch(HEX_ADDR);
    const handle = p.handleFor(addr);
    expect(handle?.kind).toBe("eoa");
    expect(await keyStore.has(handle!.ref)).toBe(true);

    const signer = await p.signerFor(addr);
    expect(signer.address.toLowerCase()).toBe(addr.toLowerCase());
  });

  it("mints a distinct wallet + key id per spawn", async () => {
    const keyStore = new InMemoryKeyStore();
    const p = new WalletProvisioner({ keyStore });

    const a = await p.provisionHolder(decision("pricer-a"));
    const b = await p.provisionHolder(decision("pricer-b"));

    expect(a).not.toBe(b);
    expect(p.handleFor(a)!.ref).not.toBe(p.handleFor(b)!.ref);
    expect(p.allHandles()).toHaveLength(2);
  });

  it("namespaces key ids with prefix, session, and role", async () => {
    const keyStore = new InMemoryKeyStore();
    const p = new WalletProvisioner({ keyStore, keyPrefix: "sa", sessionId: "abc" });
    const addr = await p.provisionHolder(decision("comms"));
    expect(p.handleFor(addr)!.ref).toBe("sa:abc:comms:0");
  });
});

describe("WalletProvisioner — server-wallet routing", () => {
  function fakeServerWallets(): ServerWalletProvider & { calls: string[] } {
    const calls: string[] = [];
    return {
      calls,
      async createServerWallet(label) {
        calls.push(label);
        return {
          address: ("0x" + "ee".repeat(20)) as Address,
          walletId: "1shot-wallet-1",
        };
      },
    };
  }

  it("routes the executor role to the server-wallet backend", async () => {
    const serverWallets = fakeServerWallets();
    const p = new WalletProvisioner({
      keyStore: new InMemoryKeyStore(),
      serverWallets,
      sessionId: "s1",
    });

    const addr = await p.provisionHolder(decision("executor"));

    expect(addr).toBe(("0x" + "ee".repeat(20)) as Address);
    const handle = p.handleFor(addr);
    expect(handle?.kind).toBe("server");
    expect(handle?.ref).toBe("1shot-wallet-1");
    expect(serverWallets.calls).toEqual(["frost:s1:executor"]);
  });

  it("signerFor refuses a server wallet", async () => {
    const p = new WalletProvisioner({
      keyStore: new InMemoryKeyStore(),
      serverWallets: fakeServerWallets(),
    });
    const addr = await p.provisionHolder(decision("executor"));
    await expect(p.signerFor(addr)).rejects.toThrow(/server-wallet backend/);
  });

  it("throws when a server-wallet role has no backend configured", async () => {
    const p = new WalletProvisioner({ keyStore: new InMemoryKeyStore() });
    await expect(p.provisionHolder(decision("executor"))).rejects.toThrow(
      /no ServerWalletProvider/,
    );
  });

  it("honours a custom useServerWallet predicate", async () => {
    const serverWallets = fakeServerWallets();
    const p = new WalletProvisioner({
      keyStore: new InMemoryKeyStore(),
      serverWallets,
      useServerWallet: (d) => d.role === "monitor",
    });

    const monitor = await p.provisionHolder(decision("monitor"));
    const executor = await p.provisionHolder(decision("executor"));

    expect(p.handleFor(monitor)?.kind).toBe("server");
    expect(p.handleFor(executor)?.kind).toBe("eoa"); // not matched by predicate
  });
});

describe("WalletProvisioner — composed through translatePlan", () => {
  it("provisions each approved holder and lets handles be recovered post-issuance", async () => {
    const captured: Address[] = [];
    const issue: SubMandateIssuer = async (params) => {
      captured.push(params.holder);
      return {
        mandateId: ("0x" + params.nonce.toString(16).padStart(64, "0")) as Hex,
        txHash: ("0x" + "ab".repeat(32)) as Hex,
      };
    };
    const p = new WalletProvisioner({ keyStore: new InMemoryKeyStore(), sessionId: "s1" });

    const approved = [decision("pricer-uniswap"), decision("comms")];
    const plan: PlanResult = {
      approved,
      escalateToHITL: false,
      entry: {
        timestamp: 1,
        sessionId: ("0x" + "00".repeat(32)) as Hex,
        parentMandateId: ("0x" + "33".repeat(32)) as Hex,
        triggerEvent: { kind: "t" },
        candidatesConsidered: approved,
        spawnedSubMandateIds: [],
        promptTemplate: "v",
        modelUsed: "m",
        inferenceCallId: "i",
      },
    };

    const result = await translatePlan(plan, {
      issue,
      encodeCaveats: () => [],
      provisionHolder: p.provisionHolder,
      nextNonce: nonceCounter(0n),
    });

    // Every holder fed to issuance is one the provisioner minted and can recover.
    expect(captured).toHaveLength(2);
    for (const outcome of result.outcomes) {
      expect(outcome.status).toBe("issued");
      const signer = await p.signerFor(outcome.holder!);
      expect(signer.address.toLowerCase()).toBe(outcome.holder!.toLowerCase());
    }
  });
});
