import { CLOUD_API_URL } from "$lib/flags";

/** Build a URL against the hosted backend base (no trailing slash issues). */
export function cloudUrl(path: string): string {
  return `${CLOUD_API_URL.replace(/\/$/, "")}${path}`;
}

/** Fetch seam so the cloud lib is unit-testable without a live server. */
export type FetchLike = typeof fetch;
