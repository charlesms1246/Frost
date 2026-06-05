import type { CompiledSpec, CompileResult } from "@frost/agent/browser";

/**
 * One-shot hand-off from the master-agent chat to the Runtime Manager. The chat
 * stashes a payload here, navigates to /runtime, and the runtime page `take()`s it
 * on mount. When the master already compiled a ready spec in chat, it travels too —
 * so /runtime runs it directly instead of recompiling (Option B). In-memory only.
 */
export type HandoffPayload = {
  /** The natural-language workflow (always present). */
  workflow: string;
  /** A ready, compiled spec from the chat-side master loop, if any. */
  spec?: CompiledSpec;
  /** The compile result behind `spec` (for the byte-tied review). */
  compileResult?: CompileResult;
  /** Clarification answers accumulated in chat. */
  answers?: Record<string, string>;
};

function createHandoff() {
	let payload = $state<HandoffPayload | undefined>(undefined);
	return {
		get pending() {
			return payload !== undefined;
		},
		set(p: HandoffPayload) {
			payload = p;
		},
		/** Read and clear. */
		take(): HandoffPayload | undefined {
			const p = payload;
			payload = undefined;
			return p;
		},
	};
}

export const handoff = createHandoff();
