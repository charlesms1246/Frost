import { formatUnits, hexToString, keccak256 } from "viem";
import {
  CAVEAT_TYPE,
  decodeCapRedelegate,
  decodeCommsTemplate,
  decodeRateLimit,
  decodeUint16,
  decodeUint256,
  decodeUint64,
  type Caveat,
} from "@frost/sdk";
import type { CommsTemplate, CompiledSpec } from "./types.js";
import { encodeRootCaveats } from "./encode.js";

/**
 * Render the plain-language review copy for a session authority (T-30) by
 * DECODING the on-chain caveat bytes — the same bytes the user signs. This is
 * what makes I-16 real: the sentences are a pure function of the encoded
 * mandate, not a parallel description that could drift from the signature.
 *
 * Returns one sentence per recognized caveat, in a fixed reading order
 * independent of the caveat array order.
 */
export function renderCaveats(caveats: Caveat[]): string[] {
  const byType = new Map<string, Caveat>();
  for (const c of caveats) byType.set(c.caveatType, c);

  const lines: string[] = [];

  const total = byType.get(CAVEAT_TYPE.SPEND_CAP_TOTAL);
  if (total) {
    lines.push(`This session can spend up to ${usd(decodeUint256(total))} in total.`);
  }

  const hitl = byType.get(CAVEAT_TYPE.HITL_THRESHOLD);
  if (hitl) {
    lines.push(
      `Any single action of ${usd(decodeUint256(hitl))} or more pauses for your approval.`,
    );
  }

  const slip = byType.get(CAVEAT_TYPE.SLIPPAGE_TOLERANCE);
  if (slip) {
    lines.push(`Swaps allow up to ${formatBps(decodeUint16(slip))} slippage.`);
  }

  const redel = byType.get(CAVEAT_TYPE.CAP_REDELEGATE);
  if (redel) {
    const { maxSubMandates, maxAggregateBudget } = decodeCapRedelegate(redel);
    lines.push(
      `The master agent may spawn up to ${maxSubMandates} sub-agents, ` +
        `totaling up to ${usd(maxAggregateBudget)} of budget.`,
    );
  }

  const rl = byType.get(CAVEAT_TYPE.RATE_LIMIT);
  if (rl) {
    const { capacity, refillRate } = decodeRateLimit(rl);
    lines.push(
      `Rate limit: up to ${capacity} operations in a burst, ` +
        `refilling at ${refillRate} per second (covers both payments and sub-agent spawns).`,
    );
  }

  const ttl = byType.get(CAVEAT_TYPE.TTL_EXPIRY);
  if (ttl) {
    const expiry = decodeUint64(ttl);
    lines.push(`The session expires at ${new Date(Number(expiry) * 1000).toISOString()}.`);
  }

  const comms = byType.get(CAVEAT_TYPE.COMMS_TEMPLATE);
  if (comms) {
    lines.push(...renderComms(comms));
  }

  return lines;
}

/** Convenience: render straight from a {@link CompiledSpec} via its encoding. */
export function renderSpec(spec: CompiledSpec): string[] {
  return renderCaveats(encodeRootCaveats(spec));
}

function renderComms(caveat: Caveat): string[] {
  const { templateHash, templateMetadata } = decodeCommsTemplate(caveat);
  // Integrity: the hash committed in the caveat must match its metadata bytes.
  // A mismatch means the template was tampered with after encoding (I-16).
  if (keccak256(templateMetadata) !== templateHash) {
    throw new Error("COMMS_TEMPLATE hash does not match its metadata (tampered)");
  }
  const template = JSON.parse(hexToString(templateMetadata)) as CommsTemplate;

  const lines = [`It posts a message: "${template.text}".`];
  const untrusted = template.variables.filter((v) => v.source === "untrusted-text");
  if (untrusted.length > 0) {
    const names = untrusted.map((v) => v.name).join(", ");
    const optedIn = untrusted.every((v) => v.optIn === true);
    lines.push(
      optedIn
        ? `You opted in to including externally-controlled text (${names}) in this message verbatim.`
        : `WARNING: this message includes externally-controlled text (${names}) that you have not opted in to.`,
    );
  }
  return lines;
}

/** Format USDC base units (6 decimals) as a dollar string, e.g. 10_000_000n → "$10". */
function usd(baseUnits: bigint): string {
  const s = formatUnits(baseUnits, 6);
  return `$${s}`;
}

function formatBps(bps: number): string {
  return `${bps / 100}%`;
}
