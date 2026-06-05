import { decodeDelegations } from "@metamask/smart-accounts-kit/utils";
import {
  RelayerClient,
  relayerUrlForChain,
  toRelayerJson,
  type RelayerExecution,
  type Send7710Params,
} from "@frost/agent/browser";
import { encodeFunctionData, erc20Abi, parseUnits } from "viem";

/**
 * Execution via the 1Shot PUBLIC RELAYER: turn the user's stored ERC-7715 grant into
 * an on-chain action the relayer redeems and pays for in USDC — no custodial wallet.
 *
 *   grant.context ──decodeDelegations──▶ permissionContext
 *   [ USDC fee → feeCollector (≥ minFee) , …work ]  ──estimate──▶ price-lock + real fee
 *                                                   ──send──────▶ taskId
 *
 * `decode` + `client` are injected seams so the orchestration is unit-testable without
 * a live relayer or a real (browser-captured) grant. The work calldata is supplied by
 * the caller already encoded (a USDC transfer for the demo; a swap FunctionCall later).
 */
const BASE_SEPOLIA = 84532;

/** Pull the ERC-7715 permissions `context` hex out of the raw `granted` blob. */
export function grantContext(granted: unknown): `0x${string}` {
  const g = granted as { context?: unknown } | Array<{ context?: unknown }> | undefined;
  const ctx = Array.isArray(g) ? g[0]?.context : g?.context;
  if (typeof ctx !== "string" || !ctx.startsWith("0x")) {
    throw new Error("grant has no 0x `context` to decode (expected MetaMask ERC-7715 granted[].context)");
  }
  return ctx as `0x${string}`;
}

/** Build a USDC `transfer` execution — the demo-simplest provable relayer work. */
export function usdcTransferWork(token: `0x${string}`, to: `0x${string}`, atoms: bigint): RelayerExecution {
  return {
    target: token,
    value: "0",
    data: encodeFunctionData({ abi: erc20Abi, functionName: "transfer", args: [to, atoms] }),
  };
}

export interface RelayerExecInput {
  /** The raw ERC-7715 granted object (parsed `config.metaMaskGrant`). */
  granted: unknown;
  /** Already-encoded work execution(s). */
  work: RelayerExecution[];
  chainId?: number;
  destinationUrl?: string;
  memo?: string;
  /** Optional in-flight EIP-7702 upgrade entry (≤1). */
  authorizationList?: unknown[];
  /** Conservative mock fee before estimate (USDC atoms). Default 0.01 USDC. */
  mockFeeAtoms?: bigint;
}

export interface RelayerExecResult {
  taskId: string;
  /** Required payment the relayer floored to (USDC atoms, decimal string). */
  feeAmount: string;
  paymentToken: `0x${string}`;
  relayerUrl: string;
}

export interface RelayerExecDeps {
  client?: RelayerClient;
  /** ERC-7715 `context` hex → decoded delegation chain. Defaults to the kit's `decodeDelegations`. */
  decode?: (context: `0x${string}`) => unknown[];
}

export async function submitViaRelayer(
  input: RelayerExecInput,
  deps: RelayerExecDeps = {},
): Promise<RelayerExecResult> {
  const chainId = input.chainId ?? BASE_SEPOLIA;
  const client = deps.client ?? new RelayerClient({ chainId });
  const decode = deps.decode ?? ((ctx) => decodeDelegations(ctx) as unknown[]);

  const caps = await client.getCapabilities([String(chainId)]);
  const chainCaps = caps[String(chainId)];
  if (!chainCaps) throw new Error(`relayer has no capabilities for chain ${chainId}`);
  const usdc =
    chainCaps.tokens.find((t) => (t.symbol ?? "").toUpperCase() === "USDC") ?? chainCaps.tokens[0];
  if (!usdc) throw new Error("relayer advertises no payment tokens");

  const permissionContext = decode(grantContext(input.granted)).map((d) => toRelayerJson(d));

  const feeTransfer = (amount: bigint): RelayerExecution => ({
    target: usdc.address,
    value: "0",
    data: encodeFunctionData({
      abi: erc20Abi,
      functionName: "transfer",
      args: [chainCaps.feeCollector, amount],
    }),
  });

  const build = (feeAmount: bigint): Send7710Params => ({
    chainId: String(chainId),
    transactions: [{ permissionContext, executions: [feeTransfer(feeAmount), ...input.work] }],
    ...(input.authorizationList ? { authorizationList: input.authorizationList } : {}),
  });

  const mockFee = input.mockFeeAtoms ?? parseUnits("0.01", Number(usdc.decimals));
  let params = build(mockFee);
  let est = await client.estimate7710Transaction(params);
  if (!est.success) throw new Error(est.error ?? "relayer estimate failed");

  // The browser grant is already signed with a fixed cap, so only the fee EXECUTION
  // amount is adjusted (no re-signing) when the relayer requires more than the mock.
  const required = BigInt(est.requiredPaymentAmount ?? mockFee.toString());
  if (required !== mockFee) {
    params = build(required);
    est = await client.estimate7710Transaction(params);
    if (!est.success) throw new Error(est.error ?? "relayer re-estimate failed");
  }

  const taskId = await client.send7710Transaction({
    ...params,
    ...(est.context ? { context: est.context } : {}),
    ...(input.destinationUrl ? { destinationUrl: input.destinationUrl } : {}),
    ...(input.memo ? { memo: input.memo } : {}),
  });

  return {
    taskId,
    feeAmount: est.requiredPaymentAmount ?? mockFee.toString(),
    paymentToken: usdc.address,
    relayerUrl: relayerUrlForChain(chainId),
  };
}
