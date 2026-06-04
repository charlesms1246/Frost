/**
 * Provisions the custodial signing wallet Frost uses for live on-chain actions
 * (issuance / revoke / audit-commit). The user never holds or enters a private
 * key — instead the app asks the HOSTED web API to create a 1Shot custodial
 * wallet (1Shot holds the key) and fund it from our treasury key, then returns
 * the wallet id + address.
 *
 * This keeps every secret (the funding key, the 1Shot API creds) server-side and
 * out of the desktop client — the product's "no keys to manage" posture.
 *
 * Honest stub for now: the hosted endpoint isn't wired, so this returns a
 * deterministic placeholder after a short tick. Swap the body for the real call
 * (a `fetch` to the hosted API, or a Tauri command that proxies it) — nothing
 * downstream changes. It does NOT pretend a real wallet was funded.
 */
export type ProvisionedWallet = { walletId: string; address: string };

export async function provisionSigningWallet(): Promise<ProvisionedWallet> {
	// TODO(hosted-provision): POST to the hosted API which creates + funds a
	// 1Shot custodial wallet server-side, e.g.
	//   const res = await fetch(`${HOSTED_BASE}/api/signing-wallet`, { method: "POST" });
	//   return (await res.json()) as ProvisionedWallet;
	await new Promise((r) => setTimeout(r, 400));
	// Placeholder, clearly not a real funded wallet (zero-ish address).
	return {
		walletId: "pending-hosted-provision",
		address: "0x0000000000000000000000000000000000000000",
	};
}
