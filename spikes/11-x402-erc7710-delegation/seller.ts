// Spike 11 — SELLER: x402 resource server that settles via an ERC-7710 DELEGATION payload
// (not EIP-3009), using MetaMask's sentinel facilitator.
//
// This is the load-bearing piece devrel said to verify: by default @x402/evm's ExactEvmScheme
// advertises erc3009/permit2 assetTransferMethods. To accept a MetaMask Smart Account delegation,
// we subclass it and force `assetTransferMethod: "erc7710"` in enhancePaymentRequirements, then
// point the resource server at the MetaMask sentinel facilitator (which can settle a delegation
// redemption on-chain). If this server can issue a 402 advertising erc7710 and then 200 after the
// buyer pays with a delegation, the seller side of the purist x402 path works.
//
// Run: npm run seller   (listens on :4111)

import express from "express";
import { paymentMiddleware, x402ResourceServer } from "@x402/express";
import type { Network } from "@x402/express";
import type { RoutesConfig } from "@x402/core/server";
import { HTTPFacilitatorClient } from "@x402/core/server";
import { ExactEvmScheme } from "@x402/evm/exact/server";

const PORT = Number(process.env.SPIKE_SELLER_PORT ?? 4111);
const NETWORK = (process.env.X402_NETWORK ?? "eip155:84532") as Network; // Base Sepolia
const PRICE = process.env.X402_PRICE ?? "$0.001";
const PAY_TO = process.env.SPIKE_PAY_TO ?? process.env.EVM_ADDRESS ?? "";
// MetaMask's x402 sentinel facilitator for Base Sepolia (from the x402-payments skill table).
const METAMASK_FACILITATOR =
  process.env.MM_FACILITATOR_URL ??
  "https://tx-sentinel-base-sepolia.dev-api.cx.metamask.io/platform/v2/x402";

if (!PAY_TO) throw new Error("SPIKE_PAY_TO (or EVM_ADDRESS) is required — the seller's receiving wallet.");

/**
 * Force the asset transfer method to ERC-7710 so the 402 tells the buyer to pay with a
 * MetaMask Smart Account delegation payload (not erc3009/permit2). Per devrel guidance.
 */
type EnhanceArgs = Parameters<ExactEvmScheme["enhancePaymentRequirements"]>;
type EnhanceRet = ReturnType<ExactEvmScheme["enhancePaymentRequirements"]>;

class Erc7710Scheme extends ExactEvmScheme {
  async enhancePaymentRequirements(...args: EnhanceArgs): EnhanceRet {
    const base = await super.enhancePaymentRequirements(...args);
    // Force the asset transfer method so the 402 tells the buyer to pay with an ERC-7710
    // MetaMask Smart Account delegation payload (not erc3009/permit2). The buyer's
    // x402Erc7710Client reads `paymentRequirements.extra.assetTransferMethod` (NOT top-level),
    // so it MUST be nested inside `extra` (preserving the existing USDC name/version).
    const b = base as Record<string, unknown>;
    return {
      ...b,
      extra: { ...(b.extra as Record<string, unknown> | undefined), assetTransferMethod: "erc7710" },
    } as Awaited<EnhanceRet>;
  }
}

const app = express();
app.use(express.json({ limit: "1mb" }));

app.get("/healthz", (_req, res) => {
  res.json({ ok: true, network: NETWORK, price: PRICE, payTo: PAY_TO, facilitator: METAMASK_FACILITATOR });
});

const facilitator = new HTTPFacilitatorClient({ url: METAMASK_FACILITATOR });
const resourceServer = new x402ResourceServer(facilitator).register(NETWORK, new Erc7710Scheme());

const routes: RoutesConfig = {
  "GET /api/agent-data": {
    accepts: { scheme: "exact", price: PRICE, network: NETWORK, payTo: PAY_TO },
    description: "Spike 11 — ERC-7710-delegation-gated resource",
    mimeType: "application/json",
  },
};

// syncOnStart=true → pull supported kinds from the MetaMask facilitator at boot (proves it's reachable
// and advertises a kind for Base Sepolia). Set SPIKE_SYNC=false to skip the network round-trip.
const syncOnStart = process.env.SPIKE_SYNC !== "false";
app.use(paymentMiddleware(routes, resourceServer, undefined, undefined, syncOnStart));

app.get("/api/agent-data", (_req, res) => {
  res.json({ status: "success", data: "Access granted via ERC-7710 delegation payment." });
});

app.listen(PORT, () => {
  console.log(`[spike11-seller] listening on :${PORT}`);
  console.log(`[spike11-seller]   network=${NETWORK} price=${PRICE} payTo=${PAY_TO}`);
  console.log(`[spike11-seller]   facilitator=${METAMASK_FACILITATOR}`);
  console.log(`[spike11-seller]   scheme=Erc7710Scheme (assetTransferMethod=erc7710)`);
});
