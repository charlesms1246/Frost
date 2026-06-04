import type { Hex } from "viem";
import type { RpcCall, RpcResult, RpcTransport } from "../pricer/venice-rpc.js";

/**
 * The monitor sub-agent runtime (threat **T-23**, on-chain event spoofing). Its
 * job is the *multi-confirmation gate*: a watched condition may only "fire" once it
 * holds at a block that is already N confirmations deep (default 3 on Base), never
 * at the manipulable chain tip. The T-23 attack — briefly tipping a TWAP across a
 * threshold for a single block — is invisible at confirmed depth, because by the
 * time that block is N-deep a momentary tip has reverted.
 *
 * Reads go through the same batched {@link RpcTransport} the pricer uses (Venice
 * Crypto-RPC read path; §7.4 names the monitor as a user of it). The condition is
 * pluggable, exactly like the pricer's `QuoteSource`, so the gate is unit-testable
 * with a mock transport and a fake condition.
 *
 * Stateless and idempotent: `check` is one evaluation. Latching ("don't re-fire")
 * and rate-limiting are the caller's / the rate-limit caveat's concern, not this
 * gate's.
 */

/** Block an `eth_call` is pinned to: the chain tip, or a concrete block-number quantity. */
export type BlockTag = "latest" | Hex;

/**
 * A condition the monitor watches. `buildCalls` produces the reads needed to
 * evaluate it AT a given block (pin every `eth_call` to that block, not "latest");
 * `evaluate` decides whether it holds from the batched results. `evaluate` should
 * THROW on an undecodable result — the monitor treats that as an error and never as
 * a silent "met" (we do not fire on data we could not read).
 */
export interface MonitorCondition {
  name: string;
  buildCalls(block: BlockTag): RpcCall[];
  evaluate(results: RpcResult[]): boolean;
}

export type MonitorResult =
  | { status: "fired"; headBlock: bigint; confirmedBlock: bigint; confirmations: number }
  | { status: "not_met"; headBlock: bigint; confirmedBlock: bigint }
  /** The chain is shorter than the confirmation depth — nothing can be confirmed yet. */
  | { status: "pending"; headBlock: bigint; needed: number }
  | { status: "error"; reason: string };

export interface MonitorOptions {
  /** Confirmations required before a condition may fire. Default 3 (Base). */
  confirmations?: number;
}

const DEFAULT_CONFIRMATIONS = 3;

export class Monitor {
  private readonly confirmations: number;

  constructor(
    private readonly rpc: RpcTransport,
    opts: MonitorOptions = {},
  ) {
    const c = opts.confirmations ?? DEFAULT_CONFIRMATIONS;
    if (!Number.isInteger(c) || c < 1) {
      throw new Error(`confirmations must be a positive integer, got ${c}`);
    }
    this.confirmations = c;
  }

  async check(condition: MonitorCondition): Promise<MonitorResult> {
    // 1 — read the chain head. A failed/unreadable head means we cannot establish
    // depth, so we refuse to fire (error), never guess.
    let head: bigint;
    try {
      const [headRes] = await this.rpc.batch([{ method: "eth_blockNumber", params: [] }]);
      if (!headRes || headRes.error || headRes.result === undefined) {
        return {
          status: "error",
          reason: `eth_blockNumber failed: ${headRes?.error?.message ?? "no result"}`,
        };
      }
      head = BigInt(headRes.result);
    } catch (e) {
      return { status: "error", reason: `head read failed: ${errMsg(e)}` };
    }

    // 2 — the confirmed block is N deep. If the chain is shorter than N, nothing is
    // confirmable yet: pending, never fire on the tip (T-23).
    if (head < BigInt(this.confirmations)) {
      return { status: "pending", headBlock: head, needed: this.confirmations };
    }
    const confirmedBlock = head - BigInt(this.confirmations);
    const blockTag = `0x${confirmedBlock.toString(16)}` as Hex;

    // 3 — evaluate the condition AGAINST the confirmed block (one batched round-trip).
    let results: RpcResult[];
    try {
      results = await this.rpc.batch(condition.buildCalls(blockTag));
    } catch (e) {
      return { status: "error", reason: `condition read failed: ${errMsg(e)}` };
    }
    const errored = results.find((r) => r.error);
    if (errored) {
      return { status: "error", reason: `condition rpc error: ${errored.error!.message}` };
    }

    let met: boolean;
    try {
      met = condition.evaluate(results);
    } catch (e) {
      return { status: "error", reason: `condition evaluate failed: ${errMsg(e)}` };
    }

    return met
      ? { status: "fired", headBlock: head, confirmedBlock, confirmations: this.confirmations }
      : { status: "not_met", headBlock: head, confirmedBlock };
  }
}

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
