import type { Profile, ProfileSyncFn } from "$lib/stores/profile.svelte";

/**
 * Default transport for `profile.syncToHosted`. The hosted web app
 * (xfrost.vercel.app) is the mirror; the real endpoint is not wired yet, so this
 * resolves locally after a short tick. Swap the body for a real `fetch(...)` (or
 * a Tauri command that proxies it) once the hosted profile endpoint exists —
 * nothing else in the UI changes.
 *
 * Kept deliberately honest: it does NOT pretend to have reached a server.
 */
export const syncProfileToHosted: ProfileSyncFn = async (_profile: Profile) => {
  // TODO(hosted-sync): POST to the hosted profile endpoint, e.g.
  //   await fetch(`${HOSTED_BASE}/api/profile`, {
  //     method: "POST", headers: { "content-type": "application/json" },
  //     body: JSON.stringify(_profile),
  //   });
  await new Promise((r) => setTimeout(r, 150));
};

/** Read a File (the chosen profile picture) into a small data URL. */
export function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}
