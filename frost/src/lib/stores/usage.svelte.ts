import { browser } from "$app/environment";
import type { RouteInfo, CompletionResponse } from "@frost/agent/browser";

/**
 * App-wide inference usage tally — EVERY AI call across Frost (master-agent workflow
 * chat, agent designer, runtime planner, …). Persisted to localStorage AND synced to
 * the cloud (so the tally follows the user and survives restart): on sign-in the app
 * pulls the cloud copy and hydrates this in-memory store; thereafter every call updates
 * it, persists locally, and schedules a debounced cloud push.
 *
 * Stored as compact AGGREGATED rows (one per source+provider+model) rather than raw
 * per-call records, so the persisted/synced payload stays tiny no matter how many calls
 * accumulate. Token/cost are summed; flags note when the API actually emitted them.
 */

/** Where an inference call originated. */
export type UsageSource = "Workflow chat" | "Agent designer" | "Runtime planner" | "Inference";

/** One aggregated row in the Usage table (grouped by source + provider + model). */
export interface UsageRow {
	source: UsageSource;
	provider: string;
	model: string;
	requests: number;
	promptTokens: number;
	completionTokens: number;
	totalTokens: number;
	costUsd: number;
	hasTokens: boolean;
	hasCost: boolean;
}

const STORAGE_KEY = "frost.usage";

const providerLabel = (p: RouteInfo["provider"]) =>
	p === "primary" ? "Venice (paid/x402)" : "OpenRouter/Groq";

function load(): UsageRow[] {
	if (!browser) return [];
	try {
		const raw = localStorage.getItem(STORAGE_KEY);
		if (!raw) return [];
		const parsed = JSON.parse(raw) as UsageRow[];
		return Array.isArray(parsed) ? parsed : [];
	} catch {
		return [];
	}
}

interface UsageInput {
	model?: string;
	promptTokens?: number;
	completionTokens?: number;
	totalTokens?: number;
	costUsd?: number;
}

function createUsage() {
	let rows = $state<UsageRow[]>(load());

	function persist() {
		if (browser) localStorage.setItem(STORAGE_KEY, JSON.stringify(rows));
	}

	/** Find-or-create the row for source+provider+model and accumulate one call. */
	function upsert(source: UsageSource, provider: string, u: UsageInput) {
		const model = u.model ?? "(unknown)";
		let row = rows.find((r) => r.source === source && r.provider === provider && r.model === model);
		if (!row) {
			row = { source, provider, model, requests: 0, promptTokens: 0, completionTokens: 0, totalTokens: 0, costUsd: 0, hasTokens: false, hasCost: false };
			rows.push(row);
		}
		row.requests += 1;
		if (u.promptTokens !== undefined) { row.promptTokens += u.promptTokens; row.hasTokens = true; }
		if (u.completionTokens !== undefined) { row.completionTokens += u.completionTokens; row.hasTokens = true; }
		if (u.totalTokens !== undefined) { row.totalTokens += u.totalTokens; row.hasTokens = true; }
		if (u.costUsd !== undefined) { row.costUsd += u.costUsd; row.hasCost = true; }
		rows = [...rows];
		persist();
	}

	return {
		get rows() {
			return rows;
		},
		get totalCalls() {
			return rows.reduce((n, r) => n + r.requests, 0);
		},
		/** Record a routed call (switcher path — provider + model + usage from RouteInfo). */
		recordRoute(source: UsageSource, info: RouteInfo) {
			const u: UsageInput = {};
			if (info.model) u.model = info.model;
			if (info.usage?.promptTokens !== undefined) u.promptTokens = info.usage.promptTokens;
			if (info.usage?.completionTokens !== undefined) u.completionTokens = info.usage.completionTokens;
			if (info.usage?.totalTokens !== undefined) u.totalTokens = info.usage.totalTokens;
			if (info.usage?.costUsd !== undefined) u.costUsd = info.usage.costUsd;
			upsert(source, providerLabel(info.provider), u);
		},
		/** Record a single-provider call (no switcher — provider label supplied by caller). */
		recordCompletion(source: UsageSource, provider: string, out: CompletionResponse) {
			const u: UsageInput = {};
			if (out.model) u.model = out.model;
			if (out.usage?.promptTokens !== undefined) u.promptTokens = out.usage.promptTokens;
			if (out.usage?.completionTokens !== undefined) u.completionTokens = out.usage.completionTokens;
			if (out.usage?.totalTokens !== undefined) u.totalTokens = out.usage.totalTokens;
			if (out.usage?.costUsd !== undefined) u.costUsd = out.usage.costUsd;
			upsert(source, provider, u);
		},
		/** Replace all rows (cloud-sync restore on sign-in). */
		hydrate(next: UsageRow[]) {
			rows = Array.isArray(next) ? next : [];
			persist();
		},
		clear() {
			rows = [];
			persist();
		},
	};
}

export const usage = createUsage();
