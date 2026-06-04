/**
 * One-shot hand-off from the master-agent chat to the Runtime Manager: the chat
 * stashes a workflow string here, navigates to /runtime, and the runtime page
 * `take()`s it on mount to prefill + auto-compile. In-memory only (single session).
 */
function createHandoff() {
	let workflow = $state<string | undefined>(undefined);
	return {
		get pending() {
			return workflow !== undefined;
		},
		set(w: string) {
			workflow = w;
		},
		/** Read and clear. */
		take(): string | undefined {
			const w = workflow;
			workflow = undefined;
			return w;
		},
	};
}

export const handoff = createHandoff();
