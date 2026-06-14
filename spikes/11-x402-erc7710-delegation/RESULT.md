# Spike 11 — x402 settlement via ERC-7710 delegation (MetaMask facilitator)

**Goal:** verify the *purist* x402 path — pay an x402-gated endpoint with a MetaMask Smart Account
**ERC-7710 delegation** payload (not EIP-3009), settled by MetaMask's sentinel facilitator — BEFORE
integrating it into Frost's `x402-inference` gateway + agent. Devrel-confirmed approach (test first).

## Status: ✅ FULL PASS — 402 → ERC-7710 delegation payment → on-chain settlement → 200 (live, Base Sepolia)

End-to-end PASS with the funded server account (`0xce4389…`, 7702-delegated): buyer `GET` → 402 (erc7710)
→ signed ERC-7710 delegation payment → MetaMask facilitator redeemed it on-chain → **HTTP 200**
`{"status":"success","data":"Access granted via ERC-7710 delegation payment."}`. USDC moved to the seller
`payTo` (`0x363b64Ab…`, balance rose). The purist x402-delegation rail is proven.

### CRITICAL FINDING — the payer must be an EIP-7702 *delegated* account (`Implementation.Stateless7702`)
A counterfactual `Implementation.Hybrid` ERC-4337 account (even funded + deployed) is REJECTED by the
MetaMask facilitator with `invalid_exact_evm_erc7710_account_not_delegated`. The paying delegator must be
a **7702-upgraded EOA** (code = `0xef0100‖gator`), created via
`toMetaMaskSmartAccount({ implementation: Implementation.Stateless7702, address: eoa.address, signer:{account} })`.
This is exactly the account shape the user's MetaMask produces — so in Frost the **master-agent session key
must itself be 7702-upgraded to the gator** to be the x402 delegation payer. (Hybrid works for OTHER
delegation flows, just not this facilitator's erc7710 settlement.)


### Seller (`seller.ts`) — ✅ PASS
A custom `Erc7710Scheme extends ExactEvmScheme` overrides `enhancePaymentRequirements` to force
`assetTransferMethod: "erc7710"`, and the resource server points at MetaMask's sentinel facilitator
(`HTTPFacilitatorClient({ url: https://tx-sentinel-base-sepolia.dev-api.cx.metamask.io/platform/v2/x402 })`).

Verified live on Base Sepolia (`eip155:84532`):
- `npx tsx seller.ts` boots with `syncOnStart=true` and **does NOT throw** → the MetaMask sentinel
  facilitator is reachable and advertises a supported kind for Base Sepolia.
- `GET /api/agent-data` → **HTTP 402** with a `PAYMENT-REQUIRED` header whose `accepts[0]` is:
  ```json
  { "scheme": "exact", "network": "eip155:84532",
    "asset": "0x036CbD53842c5426634e7929541eC2318f3dCF7e",  // USDC
    "payTo": "0x363b64Ab6299195E7EF06Ba3E3DBF37012522D0C",
    "extra": { "name": "USDC", "version": "2" },
    "assetTransferMethod": "erc7710" }                       // ← the override works
  ```
**Conclusion:** the seller-side change Frost's gateway needs is confirmed: subclass `ExactEvmScheme`
to force `assetTransferMethod: "erc7710"` + register `HTTPFacilitatorClient(METAMASK_SENTINEL_URL)`.

### Buyer (`buyer.ts`) — ✅ PIPELINE PROVEN (settlement ⏳ needs a funded+deployed account)
`createx402DelegationProvider({ account: buyerSmartAccount })` → `x402Erc7710Client` →
`wrapFetchWithPayment`. Dry-ran against the live seller with a throwaway (unfunded) key:
- Constructs the buyer MetaMask smart account + delegation provider ✅
- Receives the 402, **accepts the `erc7710` requirement** (the `assetTransferMethod` check passes) ✅
- Builds + signs the ERC-7710 delegation payment payload and re-sends it ✅
- Facilitator rejects on-chain settlement → final HTTP 402 — **expected**: the throwaway buyer smart
  account (`0x4663f3D1…8c1b`) is **NOT deployed** (`eth_getCode = 0x`) and holds **0 USDC** (verified on-chain).

**Two load-bearing findings (carry into the Frost integration):**
1. **`assetTransferMethod` MUST be nested in `extra`**, not top-level on the `accepts` entry — the buyer's
   `x402Erc7710Client.createPaymentPayload` reads `paymentRequirements.extra?.assetTransferMethod`. The
   seller override therefore returns `{ ...base, extra: { ...base.extra, assetTransferMethod: "erc7710" } }`.
2. **The buyer delegator smart account must be DEPLOYED and funded** with USDC before settlement can
   succeed (per the kit docs: "ensure the delegator account has been deployed … redeeming will fail" + it
   pays from its own USDC balance).

To run the full 402→pay→200 (moves real funds — gated on a funded key, same as other live spikes):
```
# 1) seller up:
SPIKE_PAY_TO=0x<sellerWallet> npx tsx seller.ts
# 2) buyer (a Base Sepolia key whose SMART ACCOUNT — printed by the buyer — is DEPLOYED + funded with USDC + a little ETH):
SPIKE_BUYER_PK=0x<funded> npx tsx buyer.ts
```
A 200 + `✅ SPIKE 11 PASS` means the MetaMask facilitator redeemed the delegation on-chain.

## Versions (resolved)
`@x402/core|evm|express|fetch` = 2.15.x (declared `^2.14`); `@metamask/x402` = **0.2.0** (NOT 2.14 —
that version does not exist); `@metamask/smart-accounts-kit` = 1.6.0 (needs `viem ^2.31`, resolved 2.52.2).

## Integration notes (for wiring into Frost after the buyer leg passes)
- **Gateway (`x402-inference/src/server.ts`):** swap `new ExactEvmScheme()` → the `Erc7710Scheme`
  subclass, and the 1Shot facilitator → `HTTPFacilitatorClient(METAMASK_SENTINEL)` **OR** keep 1Shot
  if devrel's "yes" (Q1) means the 1Shot facilitator also settles erc7710. Confirm which facilitator
  settles the delegation before swapping (1Shot vs MetaMask sentinel).
- **Agent buyer:** the master-agent session account becomes the `createx402DelegationProvider` account;
  `wrapFetchWithPayment` wraps the inference transport's fetch. The user's ERC-7715 grant context is the
  `parentPermissionContext` for the recurring-budget variant (redelegation), per the recurring-x402 guide.
