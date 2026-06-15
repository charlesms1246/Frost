import { describe, expect, it } from "vitest";
import { requestMetaMaskGrant, type InvokeFn } from "./metamask-issuer";

interface Call {
  cmd: string;
  args?: Record<string, unknown>;
}

function fakeInvoke(responses: Record<string, unknown>): InvokeFn & { calls: Call[] } {
  const calls: Call[] = [];
  const fn = (async (cmd: string, args?: Record<string, unknown>) => {
    calls.push({ cmd, args });
    if (cmd in responses) return responses[cmd];
    throw new Error(`unexpected invoke ${cmd}`);
  }) as InvokeFn & { calls: Call[] };
  fn.calls = calls;
  return fn;
}

const opts = {
  sessionAccount: ("0x" + "11".repeat(20)) as `0x${string}`,
  tokenAddress: "0x036CbD53842c5426634e7929541eC2318f3dCF7e" as `0x${string}`,
  periodAmountHex: "0x989680", // 10 USDC
  periodDurationSecs: 86_400, // 1 day
  expirySecs: 604_800,
  justification: "Frost session",
};

describe("requestMetaMaskGrant", () => {
  it("builds the ERC-7715 periodic spec in Rust, then drives the bridge, returning the grant", async () => {
    const spec = [{ chainId: "0x14a34", to: opts.sessionAccount }];
    const invoke = fakeInvoke({
      build_erc20_token_periodic_permission: spec,
      wallet_bridge_perform: { challenge: "c", body: { challenge: "c", granted: { permission: "0xdead" } } },
    });

    const res = await requestMetaMaskGrant(opts, invoke);

    expect(res.granted).toEqual({ permission: "0xdead" });
    // Step 1: periodic spec built via the Rust builder with snake_case args.
    expect(invoke.calls[0]!.cmd).toBe("build_erc20_token_periodic_permission");
    expect(invoke.calls[0]!.args).toEqual({
      args: {
        session_account: opts.sessionAccount,
        token_address: opts.tokenAddress,
        period_amount_hex: "0x989680",
        period_duration_secs: 86_400,
        expiry_secs: 604_800,
        justification: "Frost session",
      },
    });
    // Step 2: bridge driven with the grant_permissions op + the built spec.
    expect(invoke.calls[1]!.cmd).toBe("wallet_bridge_perform");
    expect(invoke.calls[1]!.args).toEqual({
      args: { operation: "grant_permissions", params: spec, timeout_secs: 300 },
    });
  });

  it("threads an optional chain id override into the Rust builder", async () => {
    const invoke = fakeInvoke({
      build_erc20_token_periodic_permission: [],
      wallet_bridge_perform: { challenge: "c", body: { challenge: "c", granted: {} } },
    });
    await requestMetaMaskGrant({ ...opts, chainIdHex: "0x2105" }, invoke);
    expect((invoke.calls[0]!.args!.args as Record<string, unknown>).chain_id_hex).toBe("0x2105");
  });

  it("throws when the user rejected / the bridge reported an error", async () => {
    const invoke = fakeInvoke({
      build_erc20_token_periodic_permission: [],
      wallet_bridge_perform: { challenge: "c", body: { challenge: "c", error: "user rejected" } },
    });
    await expect(requestMetaMaskGrant(opts, invoke)).rejects.toThrow(/MetaMask grant failed: user rejected/);
  });

  it("throws when no permission came back", async () => {
    const invoke = fakeInvoke({
      build_erc20_token_periodic_permission: [],
      wallet_bridge_perform: { challenge: "c", body: { challenge: "c" } },
    });
    await expect(requestMetaMaskGrant(opts, invoke)).rejects.toThrow(/no permission/);
  });
});
