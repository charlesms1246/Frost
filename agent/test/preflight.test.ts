import { describe, expect, it } from "vitest";
import type { Address, Hex } from "viem";
import {
  callableSurface,
  hitlThreshold,
  maxGasPrice,
  slippageTolerance,
  spendCapTotal,
  type Caveat,
  type CallableSurfaceEntry,
} from "@frost/sdk";
import { preflightExecution, type ProposedExecution } from "../src/executor/preflight.js";

const ROUTER = "0x2626664c2603336E57B271c5C0b26F421741e481" as Address;
const SELECTOR = "0x04e45aaf" as Hex; // exactInputSingle
const OTHER_SELECTOR = "0xb858183f" as Hex; // exactInput

const surfaceEntry: CallableSurfaceEntry = {
  target: ROUTER,
  selector: SELECTOR,
  maxValue: 1_000_000_000n, // $1,000
};

/**
 * A baseline well-formed proposal: in-surface, small value, low slippage/gas.
 * An override set explicitly to `undefined` OMITS that field (so we can exercise
 * the "constrained but undeclared" paths under exactOptionalPropertyTypes).
 */
type ProposalOverrides = { [K in keyof ProposedExecution]?: ProposedExecution[K] | undefined };
function proposal(o: ProposalOverrides = {}): ProposedExecution {
  const out: ProposedExecution = {
    target: o.target ?? ROUTER,
    selector: o.selector ?? SELECTOR,
    notionalUsdc: o.notionalUsdc ?? 100_000_000n, // $100
  };
  const gasPriceWei = "gasPriceWei" in o ? o.gasPriceWei : 1_000_000_000n; // 1 gwei
  const slippageBps = "slippageBps" in o ? o.slippageBps : 30;
  if (gasPriceWei !== undefined) out.gasPriceWei = gasPriceWei;
  if (slippageBps !== undefined) out.slippageBps = slippageBps;
  return out;
}

describe("preflightExecution (§10.3 safety boundary)", () => {
  it("submits when target/selector are in surface and all bounds hold", () => {
    const caveats: Caveat[] = [
      callableSurface([surfaceEntry]),
      slippageTolerance(50),
      maxGasPrice(2_000_000_000n),
      hitlThreshold(500_000_000n),
    ];
    expect(preflightExecution(caveats, proposal())).toEqual({ decision: "submit" });
  });

  it("rejects when there is no CALLABLE_SURFACE caveat (no authorized surface)", () => {
    const v = preflightExecution([spendCapTotal(10n)], proposal());
    expect(v.decision).toBe("reject");
    expect((v as { reason: string }).reason).toMatch(/no CALLABLE_SURFACE/);
  });

  it("rejects a target not in the surface", () => {
    const v = preflightExecution(
      [callableSurface([surfaceEntry])],
      proposal({ target: ("0x" + "99".repeat(20)) as Address }),
    );
    expect(v.decision).toBe("reject");
    expect((v as { reason: string }).reason).toMatch(/not in CALLABLE_SURFACE/);
  });

  it("rejects a matching target but non-allowed selector", () => {
    const v = preflightExecution(
      [callableSurface([surfaceEntry])],
      proposal({ selector: OTHER_SELECTOR }),
    );
    expect(v.decision).toBe("reject");
    expect((v as { reason: string }).reason).toMatch(/not in CALLABLE_SURFACE/);
  });

  it("rejects a call value above the surface maxValue", () => {
    const v = preflightExecution(
      [callableSurface([surfaceEntry])],
      proposal({ notionalUsdc: 1_000_000_001n }),
    );
    expect(v.decision).toBe("reject");
    expect((v as { reason: string }).reason).toMatch(/exceeds CALLABLE_SURFACE maxValue/);
  });

  it("rejects slippage above tolerance", () => {
    const v = preflightExecution(
      [callableSurface([surfaceEntry]), slippageTolerance(50)],
      proposal({ slippageBps: 51 }),
    );
    expect(v.decision).toBe("reject");
    expect((v as { reason: string }).reason).toMatch(/slippage 51 bps exceeds tolerance 50/);
  });

  it("refuses to submit blind when slippage is constrained but undeclared (T-32)", () => {
    const v = preflightExecution(
      [callableSurface([surfaceEntry]), slippageTolerance(50)],
      proposal({ slippageBps: undefined }),
    );
    expect(v.decision).toBe("reject");
    expect((v as { reason: string }).reason).toMatch(/did not declare slippage/);
  });

  it("rejects gas price above MAX_GAS_PRICE", () => {
    const v = preflightExecution(
      [callableSurface([surfaceEntry]), maxGasPrice(1_000_000_000n)],
      proposal({ gasPriceWei: 1_000_000_001n }),
    );
    expect(v.decision).toBe("reject");
    expect((v as { reason: string }).reason).toMatch(/exceeds MAX_GAS_PRICE/);
  });

  it("refuses to submit blind when gas is constrained but undeclared (T-32)", () => {
    const v = preflightExecution(
      [callableSurface([surfaceEntry]), maxGasPrice(1_000_000_000n)],
      proposal({ gasPriceWei: undefined }),
    );
    expect(v.decision).toBe("reject");
    expect((v as { reason: string }).reason).toMatch(/did not declare gas price/);
  });

  it("pauses for HITL when value exceeds the threshold but is otherwise allowed", () => {
    const v = preflightExecution(
      [callableSurface([surfaceEntry]), hitlThreshold(50_000_000n)],
      proposal({ notionalUsdc: 60_000_000n }),
    );
    expect(v.decision).toBe("hitl");
    expect((v as { reason: string }).reason).toMatch(/exceeds HITL threshold/);
  });

  it("lets a value exactly at the HITL threshold through (≤, not <)", () => {
    const v = preflightExecution(
      [callableSurface([surfaceEntry]), hitlThreshold(60_000_000n)],
      proposal({ notionalUsdc: 60_000_000n }),
    );
    expect(v.decision).toBe("submit");
  });

  it("prefers a hard reject over a HITL pause when both apply", () => {
    // value over BOTH maxValue and HITL threshold → reject wins, never a pause.
    const v = preflightExecution(
      [callableSurface([surfaceEntry]), hitlThreshold(50_000_000n)],
      proposal({ notionalUsdc: 2_000_000_000n }),
    );
    expect(v.decision).toBe("reject");
    expect((v as { reason: string }).reason).toMatch(/exceeds CALLABLE_SURFACE maxValue/);
  });

  it("matches target/selector case-insensitively", () => {
    const v = preflightExecution(
      [callableSurface([surfaceEntry])],
      proposal({ target: ROUTER.toLowerCase() as Address, selector: "0x04E45AAF" as Hex }),
    );
    expect(v.decision).toBe("submit");
  });

  it("submits when only the surface is constrained (optional bounds absent)", () => {
    const v = preflightExecution(
      [callableSurface([surfaceEntry])],
      proposal({ slippageBps: undefined, gasPriceWei: undefined }),
    );
    expect(v.decision).toBe("submit");
  });

  it("rejects a malformed selector before any caveat logic", () => {
    const v = preflightExecution(
      [callableSurface([surfaceEntry])],
      proposal({ selector: "0x1234" as Hex }),
    );
    expect(v.decision).toBe("reject");
    expect((v as { reason: string }).reason).toMatch(/malformed selector/);
  });
});
