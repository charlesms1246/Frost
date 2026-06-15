"use client";

import { useEffect, useState } from "react";
import type { OS } from "./use-os";

// Pull download links straight from the canonical repo's GitHub Releases so the
// site always points at the newest installers without a redeploy.
const REPO = "charlesms1246/Frost";
export const RELEASES_PAGE = `https://github.com/${REPO}/releases/latest`;

type PlatformOS = Exclude<OS, "other">;

export type ReleaseAsset = {
  name: string;
  url: string;
  os: PlatformOS;
  format: string; // e.g. ".dmg", "AppImage"
  label: string; // e.g. "Apple Silicon", "x64"
  size: string; // e.g. "5.3 MB"
};

type GhAsset = { name: string; browser_download_url: string; size: number };
type GhRelease = { tag_name: string; draft: boolean; assets: GhAsset[] };

export type ReleaseInfo = {
  loading: boolean;
  version: string | null; // e.g. "v0.1.0", null until/unless a release is found
  releaseUrl: string; // always usable as a fallback href
  assets: Record<PlatformOS, ReleaseAsset[]>;
};

function fmtSize(bytes: number): string {
  const mb = bytes / 1e6; // decimal MB, matching GitHub's own display
  return mb >= 10 ? `${Math.round(mb)} MB` : `${mb.toFixed(1)} MB`;
}

// Map a release asset filename to its OS, human format, and arch label.
function classify(name: string): Omit<ReleaseAsset, "name" | "url" | "size"> | null {
  const n = name.toLowerCase();
  const isArm = /aarch64|arm64/.test(n);

  if (n.endsWith(".dmg")) return { os: "mac", format: ".dmg", label: isArm ? "Apple Silicon" : "Intel" };
  if (n.endsWith(".app.tar.gz")) return { os: "mac", format: ".app", label: isArm ? "Apple Silicon" : "Intel" };
  if (n.endsWith(".msi")) return { os: "windows", format: ".msi", label: "x64" };
  if (n.endsWith(".exe")) return { os: "windows", format: ".exe", label: "x64 installer" };
  if (n.endsWith(".appimage")) return { os: "linux", format: "AppImage", label: isArm ? "ARM64" : "x64" };
  if (n.endsWith(".deb")) return { os: "linux", format: ".deb", label: isArm ? "ARM64" : "x64" };
  if (n.endsWith(".rpm")) return { os: "linux", format: ".rpm", label: isArm ? "ARM64" : "x64" };
  return null;
}

const EMPTY: Record<PlatformOS, ReleaseAsset[]> = { mac: [], windows: [], linux: [] };

// Note: GitHub's REST API never returns DRAFT releases to unauthenticated
// callers, so while a release stays a draft every button falls back to the
// releases page. Once it's published, direct asset links resolve automatically.
export function useRelease(): ReleaseInfo {
  const [info, setInfo] = useState<ReleaseInfo>({
    loading: true,
    version: null,
    releaseUrl: RELEASES_PAGE,
    assets: EMPTY,
  });

  useEffect(() => {
    let cancelled = false;
    fetch(`https://api.github.com/repos/${REPO}/releases?per_page=10`, {
      headers: { Accept: "application/vnd.github+json" },
    })
      .then((r) => (r.ok ? (r.json() as Promise<GhRelease[]>) : Promise.reject(r.status)))
      .then((releases) => {
        if (cancelled) return;
        const rel = releases.find((r) => !r.draft);
        if (!rel) return; // keep the fallback state

        const grouped: Record<PlatformOS, ReleaseAsset[]> = { mac: [], windows: [], linux: [] };
        for (const a of rel.assets) {
          const meta = classify(a.name);
          if (!meta) continue;
          grouped[meta.os].push({ ...meta, name: a.name, url: a.browser_download_url, size: fmtSize(a.size) });
        }

        setInfo({
          loading: false,
          version: rel.tag_name,
          releaseUrl: `https://github.com/${REPO}/releases/tag/${rel.tag_name}`,
          assets: grouped,
        });
      })
      .catch(() => {
        if (!cancelled) setInfo((p) => ({ ...p, loading: false }));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return info;
}
