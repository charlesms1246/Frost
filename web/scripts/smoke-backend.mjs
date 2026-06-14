// End-to-end smoke test for the Frost hosted backend — no MetaMask required.
//
// Exercises the full path against a LIVE deployment using a throwaway viem key as
// the "wallet": nonce -> SIWE sign -> verify (JWT) -> PUT user data -> GET it back.
// Proves SIWE auth + the MongoDB Atlas round-trip work end to end.
//
//   node scripts/smoke-backend.mjs [baseUrl]
//   node scripts/smoke-backend.mjs https://xfrost.vercel.app   (default)
//   node scripts/smoke-backend.mjs http://localhost:3000       (local dev)

import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

const BASE = (process.argv[2] ?? "https://xfrost.vercel.app").replace(/\/$/, "");

async function main() {
  const account = privateKeyToAccount(generatePrivateKey());
  console.log(`base=${BASE}  test-wallet=${account.address}`);

  // 1 — nonce + the exact message to sign
  const nonceRes = await fetch(`${BASE}/api/auth/nonce`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ address: account.address }),
  });
  if (!nonceRes.ok) throw new Error(`nonce ${nonceRes.status}: ${await nonceRes.text()}`);
  const { message } = await nonceRes.json();
  console.log("✓ nonce");

  // 2 — sign it (a real wallet would do this in MetaMask)
  const signature = await account.signMessage({ message });

  // 3 — verify -> JWT
  const verifyRes = await fetch(`${BASE}/api/auth/verify`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ message, signature }),
  });
  if (!verifyRes.ok) throw new Error(`verify ${verifyRes.status}: ${await verifyRes.text()}`);
  const { token } = await verifyRes.json();
  console.log("✓ verify (got JWT)");

  // 4 — gating: no token must 401
  const unauth = await fetch(`${BASE}/api/user`);
  if (unauth.status !== 401) throw new Error(`expected 401 without token, got ${unauth.status}`);
  console.log("✓ /api/user is auth-gated (401 without token)");

  // 5 — PUT some data
  const marker = `smoke-${Date.now()}`;
  const putRes = await fetch(`${BASE}/api/user`, {
    method: "PUT",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({
      profile: { displayName: marker, email: "smoke@frost.test" },
      chats: [{ id: "c1", title: "smoke", createdAt: 1, messages: [] }],
      automations: [],
    }),
  });
  if (!putRes.ok) throw new Error(`PUT ${putRes.status}: ${await putRes.text()}`);
  console.log("✓ PUT user data");

  // 6 — GET it back and confirm the round-trip
  const getRes = await fetch(`${BASE}/api/user`, { headers: { authorization: `Bearer ${token}` } });
  if (!getRes.ok) throw new Error(`GET ${getRes.status}: ${await getRes.text()}`);
  const { data } = await getRes.json();
  if (data?.profile?.displayName !== marker) {
    throw new Error(`round-trip mismatch: expected ${marker}, got ${JSON.stringify(data?.profile)}`);
  }
  console.log("✓ GET user data — round-trip OK");

  console.log("\nALL BACKEND SMOKE CHECKS PASSED ✅");
}

main().catch((e) => {
  console.error("\nSMOKE FAILED ❌\n" + (e instanceof Error ? e.message : String(e)));
  process.exit(1);
});
