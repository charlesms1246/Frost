import { browser } from "$app/environment";

/**
 * App-wide configuration captured at onboarding (`/setup`) and editable from app
 * Settings. Persisted locally and designed to SYNC with the hosted web app.
 * Every page reads from this single source of truth.
 *
 * Inference model: **Venice is the primary provider** (x402 pay-per-call) — the
 * user picks an ordered list of Venice models. When Venice is unavailable / out
 * of budget, the runtime falls back to **OpenRouter or Groq** with its own
 * ordered model list. This maps onto `SwitchingInferenceTransport`
 * (primary = Venice, fallback = the chosen provider).
 *
 * NOTE: there is deliberately NO raw private key here. Live on-chain signing uses
 * a custodial 1Shot wallet provisioned + funded server-side during onboarding
 * (see `$lib/signing-wallet`); only its id/address are stored.
 *
 * The ordered `veniceModels` / `fallbackModels` are CAPTURED now; the runtime
 * currently uses the first of each (primary → fallback). Wiring the full top-down
 * within-provider chain is a tracked follow-up.
 */
export type ProviderId = "openrouter" | "groq";

export type FrostConfig = {
	// Comms
	discordWebhookUrl: string;
	// Venice — PRIMARY x402 inference provider (key also serves RPC reads)
	veniceApiKey: string;
	veniceModels: [string, string, string];
	veniceCallBudget: number; // calls routed to Venice before falling back
	// Fallback provider (OpenRouter or Groq) + its key + ordered models
	fallbackProvider: ProviderId;
	openRouterApiKey: string;
	groqApiKey: string;
	fallbackModels: [string, string, string];
	// Auto-provisioned custodial signing wallet (no private key client-side)
	signingWalletId?: string;
	signingWalletAddress?: string;
	// Captured ERC-7715 authority from the user's MetaMask (the session's root authority).
	// `metaMaskGrant` is the raw granted delegation (JSON); the rest is the request scope.
	sessionAccount?: string; // the agent session account the permission was granted TO
	metaMaskGrant?: string;
	grantTokenAddress?: string;
	grantMaxAmount?: string; // token base units
	grantExpiryUnix?: number;
	// Advanced
	rpcUrl: string;
	// Optional BaseScan/Etherscan-v2 key — enables the master agent's contract lookups
	basescanApiKey: string;
	// Onboarding completed via /setup
	onboarded: boolean;
};

const STORAGE_KEY = "frost.config";

const DEFAULTS: FrostConfig = {
	discordWebhookUrl: "",
	veniceApiKey: "",
	veniceModels: ["llama-3.3-70b", "", ""],
	veniceCallBudget: 3,
	fallbackProvider: "openrouter",
	openRouterApiKey: "",
	groqApiKey: "",
	fallbackModels: ["openai/gpt-4o-mini", "", ""],
	rpcUrl: "https://base-sepolia.publicnode.com",
	basescanApiKey: "",
	onboarded: false,
};

function clone(c: FrostConfig): FrostConfig {
	return { ...c, veniceModels: [...c.veniceModels], fallbackModels: [...c.fallbackModels] };
}

function normalizeTriple(
	v: readonly string[] | undefined,
	fallback: [string, string, string],
): [string, string, string] {
	const a = Array.isArray(v) ? v : fallback;
	return [a[0] ?? "", a[1] ?? "", a[2] ?? ""];
}

function load(): FrostConfig {
	if (!browser) return clone(DEFAULTS);
	try {
		const raw = localStorage.getItem(STORAGE_KEY);
		if (!raw) return clone(DEFAULTS);
		const parsed = JSON.parse(raw) as Partial<FrostConfig>;
		return {
			...clone(DEFAULTS),
			...parsed,
			veniceModels: normalizeTriple(parsed.veniceModels, DEFAULTS.veniceModels),
			fallbackModels: normalizeTriple(parsed.fallbackModels, DEFAULTS.fallbackModels),
		};
	} catch {
		return clone(DEFAULTS);
	}
}

/** The fallback provider's API key, given the chosen provider. */
export function fallbackKeyOf(c: FrostConfig): string {
	return c.fallbackProvider === "groq" ? c.groqApiKey : c.openRouterApiKey;
}

/** Injectable transport so the hosted-sync seam is unit-testable. */
export type ConfigSyncFn = (config: FrostConfig) => Promise<void>;

function createConfig() {
	let current = $state<FrostConfig>(load());
	let synced = $state(false);
	let syncing = $state(false);

	function persist() {
		if (browser) localStorage.setItem(STORAGE_KEY, JSON.stringify(current));
	}

	return {
		get value() {
			return current;
		},
		get onboarded() {
			return current.onboarded;
		},
		/** The model the runtime uses today (primary Venice, else fallback). */
		get primaryModel() {
			const veniceUsable =
				current.veniceApiKey.trim() !== "" && current.veniceModels[0].trim() !== "";
			return veniceUsable ? current.veniceModels[0] : current.fallbackModels[0];
		},
		/** A usable thinking path exists: Venice OR the chosen fallback provider. */
		get ready() {
			const venice = current.veniceApiKey.trim() !== "" && current.veniceModels[0].trim() !== "";
			const fallback = fallbackKeyOf(current).trim() !== "" && current.fallbackModels[0].trim() !== "";
			return venice || fallback;
		},
		get syncing() {
			return syncing;
		},
		get synced() {
			return synced;
		},
		update(patch: Partial<FrostConfig>) {
			current = {
				...current,
				...patch,
				...(patch.veniceModels
					? { veniceModels: normalizeTriple(patch.veniceModels, current.veniceModels) }
					: {}),
				...(patch.fallbackModels
					? { fallbackModels: normalizeTriple(patch.fallbackModels, current.fallbackModels) }
					: {}),
			};
			synced = false;
			persist();
		},
		clear() {
			current = clone(DEFAULTS);
			synced = false;
			persist();
		},
		async syncToHosted(send: ConfigSyncFn): Promise<boolean> {
			syncing = true;
			try {
				await send(current);
				synced = true;
				return true;
			} catch {
				synced = false;
				return false;
			} finally {
				syncing = false;
			}
		},
	};
}

export const config = createConfig();
