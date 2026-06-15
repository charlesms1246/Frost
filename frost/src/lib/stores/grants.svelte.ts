import { browser } from "$app/environment";

/**
 * History of ERC-7715 spending delegations the user has granted. Each capture (a
 * MetaMask grant from setup / the delegate gate / a master-agent `request_authority`)
 * appends a record here; revocations mark it. The Account page lists the full history
 * — active, expired, and revoked — instead of only the single live grant in `config`.
 *
 * SECURITY: this stores only the human-readable METADATA of a delegation (delegate,
 * token, cap, period, expiry, status) — never the redeemable `context`/`granted` blob.
 * That sensitive, per-device secret stays in `config.metaMaskGrant` and is NEVER synced
 * (see `cloud/sync.ts`). The metadata here IS synced so the history follows the user.
 */
export type DelegationStatus = "active" | "expired" | "revoked";

export type DelegationRecord = {
	id: string;
	/** Short human label, e.g. "Spending grant (ERC-7715)". */
	label: string;
	/** The delegate the permission was granted TO (session account / relayer target). */
	delegate?: string;
	tokenAddress?: string;
	tokenSymbol?: string;
	/** Per-period spend cap in token base units (decimal string). */
	capBaseUnits?: string;
	/** Budget period length in seconds. */
	periodSecs?: number;
	/** When the grant was captured (unix ms). */
	createdAt: number;
	/** Absolute expiry (unix seconds). */
	expiryUnix?: number;
	/** Set when the user revoked it on-chain (or via sign-out). */
	revoked?: boolean;
};

const STORAGE_KEY = "frost.grants";

function uid(): string {
	if (browser && "randomUUID" in crypto) return crypto.randomUUID();
	return `g_${Date.now().toString(36)}_${Math.floor(Math.random() * 1e6).toString(36)}`;
}

function load(): DelegationRecord[] {
	if (!browser) return [];
	try {
		const raw = localStorage.getItem(STORAGE_KEY);
		if (!raw) return [];
		const parsed = JSON.parse(raw) as DelegationRecord[];
		return Array.isArray(parsed) ? parsed : [];
	} catch {
		return [];
	}
}

/** Derive the live status of a record at time `nowUnix` (seconds). */
export function statusOf(r: DelegationRecord, nowUnix: number): DelegationStatus {
	if (r.revoked) return "revoked";
	if (r.expiryUnix && r.expiryUnix < nowUnix) return "expired";
	return "active";
}

function createGrants() {
	let records = $state<DelegationRecord[]>(load());

	function persist() {
		if (browser) localStorage.setItem(STORAGE_KEY, JSON.stringify(records));
	}

	return {
		/** Most-recent first. */
		get list() {
			return [...records].sort((a, b) => b.createdAt - a.createdAt);
		},
		/** Append a new delegation record; returns its id. */
		record(r: Omit<DelegationRecord, "id" | "createdAt"> & { createdAt?: number }): string {
			const rec: DelegationRecord = { id: uid(), createdAt: r.createdAt ?? Date.now(), ...r };
			records = [rec, ...records];
			persist();
			return rec.id;
		},
		/** Mark a single record (by id) as revoked. */
		markRevokedById(id: string) {
			records = records.map((r) => (r.id === id ? { ...r, revoked: true } : r));
			persist();
		},
		/** Mark every still-active record for `delegate` (or all, if omitted) as revoked. */
		markRevoked(delegate?: string) {
			const d = delegate?.toLowerCase();
			records = records.map((r) =>
				!r.revoked && (!d || r.delegate?.toLowerCase() === d) ? { ...r, revoked: true } : r,
			);
			persist();
		},
		clearAll() {
			records = [];
			persist();
		},
		/** Replace all records (cloud-sync restore on sign-in). */
		hydrate(next: DelegationRecord[]) {
			records = Array.isArray(next) ? next : [];
			persist();
		},
	};
}

export const grants = createGrants();
