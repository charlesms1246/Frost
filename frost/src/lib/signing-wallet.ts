import { OneShotRestWallets, type OneShotFetch } from "@frost/agent/browser";

/**
 * Provisions the custodial signing wallet Frost uses for live on-chain actions.
 * The user never holds or enters a private key — 1Shot holds the key.
 *
 * Path A (redelegation): this wallet becomes the DELEGATE (`to`) of the user's
 * ERC-7715 grant, so 1Shot can sign the redelegation to the executor
 * (`redelegateWithDelegationData` requires the wallet to BE the grant's delegate).
 *
 * Two modes:
 *   - REAL: pass `creds` (1Shot apiKey/secret/businessId) → creates a custodial
 *     Base Sepolia wallet via the webview-safe REST primitive (`OneShotRestWallets`).
 *     Idempotent on `name`: reuses an existing wallet of the same name if present.
 *   - PLACEHOLDER: call with no creds → returns a clearly-not-real result after a
 *     tick (the desktop renderer holds no 1Shot creds today; the production path is
 *     a Tauri command / hosted API that proxies this with server-side secrets).
 */
export type ProvisionedWallet = { walletId: string; address: string };

export type ProvisionCreds = {
	apiKey: string;
	apiSecret: string;
	businessId: string;
	/** Defaults to Base Sepolia (84532). */
	chainId?: number;
	baseUrl?: string;
	/** Wallet name — reused if one already exists (idempotent). */
	name?: string;
	/** 1Shot HTTP fetch — pass the Tauri-backed fetch so the call runs from Rust (no CORS). */
	fetchImpl?: OneShotFetch;
};

const BASE_SEPOLIA_CHAIN_ID = 84532;
const DEFAULT_WALLET_NAME = "frost-session-delegate";

export async function provisionSigningWallet(creds?: ProvisionCreds): Promise<ProvisionedWallet> {
	if (!creds?.apiKey || !creds.apiSecret || !creds.businessId) {
		// No server-side creds in the renderer — honest placeholder (not a funded wallet).
		await new Promise((r) => setTimeout(r, 400));
		return { walletId: "pending-hosted-provision", address: "0x0000000000000000000000000000000000000000" };
	}
	const name = creds.name ?? DEFAULT_WALLET_NAME;
	const chainId = creds.chainId ?? BASE_SEPOLIA_CHAIN_ID;
	const wallets = new OneShotRestWallets({
		apiKey: creds.apiKey,
		apiSecret: creds.apiSecret,
		...(creds.baseUrl ? { baseUrl: creds.baseUrl } : {}),
		...(creds.fetchImpl ? { fetchImpl: creds.fetchImpl } : {}),
	});
	const existing = (await wallets.list(creds.businessId)).find((w) => w.name === name);
	if (existing) return { walletId: existing.walletId, address: existing.accountAddress };
	const created = await wallets.create(creds.businessId, { chainId, name });
	return { walletId: created.walletId, address: created.accountAddress };
}
