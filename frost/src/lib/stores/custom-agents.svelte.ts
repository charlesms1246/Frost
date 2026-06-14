import { browser } from "$app/environment";
import type { CustomAgentDefinition } from "@frost/agent/browser";

/**
 * User-created custom agents, persisted. Stored with bigint caps as decimal
 * strings (JSON can't hold bigint); `toDefinition` reconstructs them for the
 * runtime (`CustomAgentRegistry` / planner) when a session needs them.
 */
export type StoredAgent = {
	role: string;
	description: string;
	behavior: CustomAgentDefinition["behavior"];
	capabilities: string[];
	spendCapTotal: string;
	hitlThreshold?: string;
	estimatedTokenCost: string;
};

const STORAGE_KEY = "frost.customAgents";

function load(): StoredAgent[] {
	if (!browser) return [];
	try {
		const raw = localStorage.getItem(STORAGE_KEY);
		const parsed = raw ? (JSON.parse(raw) as StoredAgent[]) : [];
		return Array.isArray(parsed) ? parsed : [];
	} catch {
		return [];
	}
}

export function fromDefinition(d: CustomAgentDefinition): StoredAgent {
	return {
		role: d.role,
		description: d.description,
		behavior: d.behavior,
		capabilities: [...d.capabilities],
		spendCapTotal: d.spendCapTotal.toString(),
		...(d.hitlThreshold !== undefined ? { hitlThreshold: d.hitlThreshold.toString() } : {}),
		estimatedTokenCost: d.estimatedTokenCost.toString(),
	};
}

export function toDefinition(a: StoredAgent): CustomAgentDefinition {
	return {
		role: a.role,
		description: a.description,
		behavior: a.behavior,
		capabilities: [...a.capabilities],
		spendCapTotal: BigInt(a.spendCapTotal),
		...(a.hitlThreshold !== undefined ? { hitlThreshold: BigInt(a.hitlThreshold) } : {}),
		estimatedTokenCost: BigInt(a.estimatedTokenCost),
	};
}

function createCustomAgents() {
	let agents = $state<StoredAgent[]>(load());

	function persist() {
		if (browser) localStorage.setItem(STORAGE_KEY, JSON.stringify(agents));
	}

	return {
		get list() {
			return agents;
		},
		has(role: string) {
			return agents.some((a) => a.role === role);
		},
		/** Add or replace by role. */
		save(def: CustomAgentDefinition) {
			const stored = fromDefinition(def);
			agents = [...agents.filter((a) => a.role !== stored.role), stored];
			persist();
		},
		remove(role: string) {
			agents = agents.filter((a) => a.role !== role);
			persist();
		},
		/** Wipe all saved agents (used on sign-out). */
		clearAll() {
			agents = [];
			persist();
		},
		/** Replace all saved agents (used by cloud-sync restore on sign-in). */
		hydrate(next: StoredAgent[]) {
			agents = Array.isArray(next) ? next : [];
			persist();
		},
	};
}

export const customAgents = createCustomAgents();
