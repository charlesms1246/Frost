import { keccak256, stringToHex, type Hex } from "viem";
import { CAVEAT_TYPE, decodeCommsTemplate, type Caveat } from "@frost/sdk";
import { canonicalCommsJson } from "../compile/encode.js";
import { VARIABLE_SOURCES, type CommsTemplate } from "../compile/types.js";
import { escapeForSource } from "./escape.js";

/**
 * The comms sub-agent runtime (contract-architecture §10.4; threats T-25 / I-15,
 * audit hotspot H-14). It fills a COMMS_TEMPLATE with event data and posts it to a
 * channel — and it does so only after proving the off-chain template it is about to
 * render is exactly the one committed on-chain, and only after escaping every
 * attacker-influenceable variable.
 *
 * Orchestration only: the binding check and per-variable escaping (`escape.ts`) are
 * the security core; the channel post is the injected `CommsPoster` seam. Fully
 * offline-testable, like the other sub-agents. The LLM proposes the template at
 * compile time; here the runtime disposes — it renders exactly the signed template,
 * never free-form text.
 */

export interface PostReceipt {
  channel: string;
  ok: boolean;
  id?: string;
}

/** The channel the comms agent posts through (Discord webhook in production). */
export interface CommsPoster {
  post(message: string): Promise<PostReceipt>;
}

export interface CommsRequest {
  /** The off-chain full template from session state — its hash is verified vs the mandate. */
  template: CommsTemplate;
  /** Variable values to fill (name → raw value). `untrusted-text` values may be adversarial. */
  values: Record<string, string>;
}

export type CommsResult =
  | { status: "posted"; message: string; receipt: PostReceipt }
  | { status: "rejected"; reason: string }
  | { status: "failed"; reason: string };

export interface CommsAgentDeps {
  poster: CommsPoster;
}

/** Discord hard limit on a single message. */
const MAX_MESSAGE_LEN = 2000;
const PLACEHOLDER_RE = /\$\{([^}]+)\}/g;

export class CommsAgent {
  constructor(private readonly deps: CommsAgentDeps) {}

  async post(
    mandate: { caveats: readonly Caveat[] },
    req: CommsRequest,
  ): Promise<CommsResult> {
    // 1 — binding (H-14 / I-16): the off-chain template MUST equal the on-chain
    // commitment, or an attacker could swap in a template that, e.g., relabels an
    // untrusted variable as trusted to skip escaping.
    const caveat = mandate.caveats.find((c) => c.caveatType === CAVEAT_TYPE.COMMS_TEMPLATE);
    if (!caveat) {
      return reject("no COMMS_TEMPLATE caveat — comms agent has no authorized template");
    }
    let onchainHash: Hex;
    try {
      onchainHash = decodeCommsTemplate(caveat).templateHash;
    } catch (e) {
      return reject(`undecodable COMMS_TEMPLATE caveat: ${errMsg(e)}`);
    }
    const computed = keccak256(stringToHex(canonicalCommsJson(req.template)));
    if (computed.toLowerCase() !== onchainHash.toLowerCase()) {
      return reject("off-chain template does not match the on-chain commitment (H-14)");
    }

    // 2 — resolve + escape every declared variable.
    const resolved: Record<string, string> = {};
    for (const v of req.template.variables) {
      if (!VARIABLE_SOURCES.includes(v.source)) {
        return reject(`unknown variable source "${v.source}" for "${v.name}"`);
      }
      // untrusted-text must be explicitly opted in (the compiler gates this; enforce
      // again at send so a tampered-but-rebound template can't sneak it through).
      if (v.source === "untrusted-text" && v.optIn !== true) {
        return reject(`untrusted-text variable "${v.name}" used without opt-in (T-25)`);
      }
      const raw = req.values[v.name];
      if (raw === undefined) return reject(`missing value for variable "${v.name}"`);
      const r = escapeForSource(v.name, v.source, raw);
      if (!r.ok) return reject(r.reason);
      resolved[v.name] = r.value;
    }

    // 3 — render: substitute ${name}; every placeholder must be a declared variable.
    let undeclared: string | null = null;
    const message = req.template.text.replace(PLACEHOLDER_RE, (_m, name: string) => {
      if (!(name in resolved)) {
        undeclared ??= name;
        return "";
      }
      return resolved[name]!;
    });
    if (undeclared) {
      return reject(`template references undeclared variable "${undeclared}"`);
    }
    if (message.length > MAX_MESSAGE_LEN) {
      return reject(`rendered message ${message.length} exceeds ${MAX_MESSAGE_LEN}-char limit`);
    }

    // 4 — post through the channel seam.
    try {
      const receipt = await this.deps.poster.post(message);
      return { status: "posted", message, receipt };
    } catch (e) {
      return { status: "failed", reason: `post failed: ${errMsg(e)}` };
    }
  }
}

function reject(reason: string): CommsResult {
  return { status: "rejected", reason };
}

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
