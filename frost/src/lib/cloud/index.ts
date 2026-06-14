import { bridgeCloudSignIn } from "./bridge-signin";
import { cloudSession } from "./session.svelte";

export { cloudSession } from "./session.svelte";
export { cloudSignIn } from "./auth";
export { collectLocalData, applyCloudData, pullCloud, pushCloud } from "./sync";

/**
 * Production cloud sign-in end to end: SIWE via the wallet bridge → store the JWT →
 * restore the user's profile / chats / automations from the backend. Returns whether
 * any cloud data existed to restore. Throws if the bridge sign-in fails (the caller
 * treats cloud sync as best-effort — a failure must never break the local app).
 */
export async function cloudSignInAndPull(): Promise<{ restored: boolean; address: string }> {
  const { token, address } = await bridgeCloudSignIn();
  cloudSession.setToken(token);
  return { restored: await cloudSession.pull(), address };
}
