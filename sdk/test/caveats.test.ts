import { describe, it, expect } from "vitest";
import { keccak256, toBytes, type Hex } from "viem";
import {
  CAVEAT_TYPE,
  CAVEAT_SCHEMA_VERSION_V1,
  CAPABILITY,
  CAPABILITY_HASH,
  spendCapTotal,
  spendCapPerCall,
  ttlExpiry,
  maxRedelegationDepth,
  slippageTolerance,
  maxGasPrice,
  hitlThreshold,
  contextScope,
  providerWhitelist,
  capabilityWhitelist,
  rateLimit,
  capRedelegate,
  callableSurface,
  commsTemplate,
  decodeUint256,
  decodeUint64,
  decodeUint16,
  decodeUint8,
  decodeBytes32,
  decodeAddressArray,
  decodeBytes32Array,
  decodeRateLimit,
  decodeCapRedelegate,
  decodeCallableSurface,
  decodeCommsTemplate,
} from "../src/caveats/index.js";

/**
 * Builder round-trip + selector / schema invariants. These don't touch the
 * chain — they assert the SDK's encoding matches `Caveats.sol` byte-for-byte
 * for the scalar / set / composite types. The on-chain side is exercised in
 * `mandate.test.ts` (issueMandate round-trip).
 */
describe("caveat builders — round trip", () => {
  it("spendCapTotal: uint256 round trip", () => {
    const c = spendCapTotal(1_000_000_000n);
    expect(c.caveatType).toBe(CAVEAT_TYPE.SPEND_CAP_TOTAL);
    expect(c.schemaVersion).toBe(CAVEAT_SCHEMA_VERSION_V1);
    expect(decodeUint256(c)).toBe(1_000_000_000n);
  });

  it("spendCapPerCall: uint256 round trip", () => {
    expect(decodeUint256(spendCapPerCall(500_000_000n))).toBe(500_000_000n);
  });

  it("ttlExpiry: uint64 round trip", () => {
    const exp = 9_999_999_999n;
    expect(decodeUint64(ttlExpiry(exp))).toBe(exp);
  });

  it("maxRedelegationDepth: uint8 round trip", () => {
    expect(decodeUint8(maxRedelegationDepth(3))).toBe(3);
  });

  it("slippageTolerance: uint16 round trip", () => {
    expect(decodeUint16(slippageTolerance(50))).toBe(50);
  });

  it("maxGasPrice: uint64 round trip", () => {
    expect(decodeUint64(maxGasPrice(100_000_000_000n))).toBe(100_000_000_000n);
  });

  it("hitlThreshold: uint256 round trip; direction documented inverse", () => {
    expect(decodeUint256(hitlThreshold(10_000_000n))).toBe(10_000_000n);
  });

  it("contextScope: bytes32 round trip, pads short hex", () => {
    const c = contextScope("0xabcd" as Hex);
    expect(c.caveatType).toBe(CAVEAT_TYPE.CONTEXT_SCOPE);
    expect(decodeBytes32(c)).toBe(
      "0x000000000000000000000000000000000000000000000000000000000000abcd"
    );
  });

  it("providerWhitelist: address[] round trip preserves order", () => {
    const addrs = [
      "0x1111111111111111111111111111111111111111",
      "0x2222222222222222222222222222222222222222",
    ] as const;
    expect(decodeAddressArray(providerWhitelist(addrs))).toEqual(addrs);
  });

  it("capabilityWhitelist: hashes string names with keccak256", () => {
    const c = capabilityWhitelist([CAPABILITY.INFERENCE_CALL, CAPABILITY.REDELEGATE]);
    const decoded = decodeBytes32Array(c);
    expect(decoded[0]).toBe(keccak256(toBytes(CAPABILITY.INFERENCE_CALL)));
    expect(decoded[1]).toBe(keccak256(toBytes(CAPABILITY.REDELEGATE)));
    // Sanity: CAPABILITY_HASH lookup matches the same hashes.
    expect(CAPABILITY_HASH.INFERENCE_CALL).toBe(decoded[0]);
  });

  it("capabilityWhitelist: passes through 0x-prefixed pre-hashed values", () => {
    const custom = keccak256(toBytes("CAP_CUSTOM_THING"));
    const c = capabilityWhitelist([custom]);
    expect(decodeBytes32Array(c)[0]).toBe(custom);
  });

  it("rateLimit: 4-tuple round trip", () => {
    const params = {
      capacity: 10n,
      refillRate: 1n,
      currentTokens: 5n,
      lastRefill: 0n,
    };
    expect(decodeRateLimit(rateLimit(params))).toEqual(params);
  });

  it("capRedelegate: (uint8, uint256) round trip", () => {
    const p = { maxSubMandates: 10, maxAggregateBudget: 2n ** 128n - 1n };
    expect(decodeCapRedelegate(capRedelegate(p))).toEqual(p);
  });

  it("callableSurface: tuple[] round trip preserves all fields", () => {
    const entries = [
      {
        target: "0x4200000000000000000000000000000000000006" as `0x${string}`,
        selector: "0xa9059cbb" as `0x${string}`, // transfer(address,uint256)
        maxValue: 1_000_000n,
      },
    ] as const;
    const decoded = decodeCallableSurface(callableSurface(entries));
    expect(decoded.length).toBe(1);
    expect(decoded[0]?.target.toLowerCase()).toBe(entries[0].target.toLowerCase());
    expect(decoded[0]?.selector).toBe(entries[0].selector);
    expect(decoded[0]?.maxValue).toBe(entries[0].maxValue);
  });

  it("commsTemplate: (bytes32, bytes) round trip", () => {
    const p = {
      templateHash: keccak256(toBytes("discord-webhook-v1")),
      templateMetadata: "0xdeadbeef" as `0x${string}`,
    };
    expect(decodeCommsTemplate(commsTemplate(p))).toEqual(p);
  });
});

describe("selector constants match Caveats.sol", () => {
  // Hand-copied from Caveats.sol §"Type identifiers".
  it("all 14 selectors are present and unique", () => {
    const values = Object.values(CAVEAT_TYPE);
    expect(values.length).toBe(14);
    expect(new Set(values).size).toBe(14);
  });

  it("SPEND_CAP_TOTAL matches the on-chain literal", () => {
    expect(CAVEAT_TYPE.SPEND_CAP_TOTAL).toBe("0x0a4f8e8a");
  });

  it("COMMS_TEMPLATE matches the on-chain literal", () => {
    expect(CAVEAT_TYPE.COMMS_TEMPLATE).toBe("0x17e063ad");
  });
});
