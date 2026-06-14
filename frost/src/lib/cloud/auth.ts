import { cloudUrl, type FetchLike } from "./client";

/**
 * Wallet-first passwordless sign-in to the hosted backend (SIWE).
 *
 * 1. ask the server for a nonce + the exact message to sign
 * 2. have the wallet sign that message (the `sign` seam: the MetaMask bridge in
 *    the app, a viem key in dev/tests)
 * 3. exchange { message, signature } for a session JWT
 *
 * The signer is injected so this is testable offline and so the production signer
 * (the flaky MetaMask bridge) is swappable for a dev/local key when needed.
 */
export type MessageSigner = (message: string) => Promise<`0x${string}`>;

export async function cloudSignIn(
  address: string,
  sign: MessageSigner,
  fetchImpl: FetchLike = fetch,
): Promise<string> {
  const nonceRes = await fetchImpl(cloudUrl("/api/auth/nonce"), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ address }),
  });
  if (!nonceRes.ok) throw new Error(`cloud nonce request failed (${nonceRes.status})`);
  const { message } = (await nonceRes.json()) as { message?: string };
  if (!message) throw new Error("cloud nonce response missing message");

  const signature = await sign(message);

  const verifyRes = await fetchImpl(cloudUrl("/api/auth/verify"), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ message, signature }),
  });
  if (!verifyRes.ok) throw new Error(`cloud sign-in failed (${verifyRes.status})`);
  const { token } = (await verifyRes.json()) as { token?: string };
  if (!token) throw new Error("cloud verify response missing token");
  return token;
}
