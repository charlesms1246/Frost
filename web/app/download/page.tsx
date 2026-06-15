"use client";

/* eslint-disable @next/next/no-img-element -- platform logos are tiny static
   brand SVGs from /public; next/image optimization adds no value here. */

// Frost download page — ported from the Claude Design handoff (download.html),
// compacted to a single viewport and OS-aware (the visitor's platform is
// detected and recommended).

import Link from "next/link";
import SiteNav from "../_components/SiteNav";
import { useOS } from "../_lib/use-os";
import { useRelease } from "../_lib/use-release";

const DOWN_ICON = (
  <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
    <path d="M7 1v9M4 7l3 3 3-3M1.5 12h11" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

const MAC_ICON = <img className="platform-icon" src="/Apple_logo_black.svg" alt="" aria-hidden="true" />;
const WIN_ICON = <img className="platform-icon" src="/Windows_logo.svg" alt="" aria-hidden="true" />;
const LINUX_ICON = <img className="platform-icon" src="/Linux_Logo.svg" alt="" aria-hidden="true" />;

const PLATFORMS = [
  { key: "mac", name: "macOS", icon: MAC_ICON, formats: ["Apple Silicon", ".dmg", ".app"], reqs: "macOS 12+ · ~5 MB", btn: "Download for macOS" },
  { key: "windows", name: "Windows", icon: WIN_ICON, formats: ["x64", ".msi", ".exe"], reqs: "Windows 10 (1903)+ · ~5 MB", btn: "Download for Windows" },
  { key: "linux", name: "Linux", icon: LINUX_ICON, formats: ["AppImage", ".deb", ".rpm"], reqs: "glibc 2.31+ · 6–78 MB", btn: "Download for Linux" },
] as const;

// Real SHA-256 sums for the published frost-v0.1.0 assets (GitHub Releases).
const CHECKSUMS: [string, string][] = [
  ["macOS aarch64 · .dmg", "388a70f93ae75919a6f49fdab6b31771f6ed42bee90c64f6413d317a63cf9e0a"],
  ["macOS aarch64 · .app", "fcbcfb2a6dc56e126a2a95c2def7536f7f35149bff05ceab8543553acf9b72a2"],
  ["Windows x64 · .msi", "8d6587e388b45308a6968923d7fcb3e25aedda5458407634da182ae3b64e8411"],
  ["Windows x64 · .exe", "ee8391f70262b361e08c57ed52fb090f1eba820327ea98dbed19f5a2b88455c6"],
  ["Linux x64 · AppImage", "aaf3b5024b4536ef759609b6de01961273d53c433a2b8bf94968e7b8284b58fe"],
  ["Linux x64 · .deb", "db6c12718ac492eecc336ab066158bc54a6d19880398f2354bacad4026e214c1"],
  ["Linux x64 · .rpm", "e58adb46b53863a3cedc75ab7c2dfbb8a4c0ea7a68d583cd8a56f16951fa5af2"],
];

export default function DownloadPage() {
  const os = useOS();
  const release = useRelease();
  const primaryKey = os === "other" ? "mac" : os;
  const ordered = [...PLATFORMS].sort(
    (a, b) => Number(b.key === primaryKey) - Number(a.key === primaryKey),
  );

  return (
    <div className="dl-page">
      <div className="grid-bg" aria-hidden="true" />
      <div className="shell dl-shell dl-compact home-shell">
        <SiteNav active="download" />

        <div className="dl-hero">
          <div className="eyebrow">Early Access · Free</div>
          <h1 className="dl-heading">Download <span>Frost</span> 1.0</h1>
          <p className="dl-desc">A native desktop app for macOS, Windows, and Linux. Built with Tauri 2 — lean, fast, fully offline-capable. Your keys never leave your machine.</p>
          <div className="version-badge"><span className="live" />{release.version ? `${release.version} · ` : ""}Tauri 2.0 · GitHub Releases</div>
        </div>

        <div className="platforms">
          {ordered.map((p) => {
            const featured = p.key === primaryKey;
            return (
              <div className={`platform-card${featured ? " featured" : ""}`} key={p.key} data-recommended={featured && p.key === os ? "Detected" : undefined}>
                {p.icon}
                <div className="platform-name">{p.name}</div>
                <ul className="platform-formats">{p.formats.map((f) => <li key={f}>{f}</li>)}</ul>
                <div className="platform-reqs">{p.reqs}</div>
                {release.assets[p.key].length > 0 ? (
                  <div className="dl-btn-stack">
                    {release.assets[p.key].map((a) => (
                      <a
                        key={a.name}
                        className="dl-platform-btn dl-asset-btn"
                        href={a.url}
                        target="_blank"
                        rel="noreferrer"
                      >
                        <span className="dl-asset-main">{DOWN_ICON}{a.format}</span>
                        <span className="dl-asset-meta">{a.label} · {a.size}</span>
                      </a>
                    ))}
                  </div>
                ) : (
                  <a
                    className="dl-platform-btn"
                    href={release.releaseUrl}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {DOWN_ICON}{release.loading ? "Loading releases…" : p.btn}
                  </a>
                )}
              </div>
            );
          })}
        </div>

        <div className="dl-strip">
          <div className="dl-strip-sec">
            <svg viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M8 2L2 5v4c0 3 2.7 5.8 6 6.5C11.3 14.8 14 12 14 9V5L8 2z" stroke="currentColor" strokeWidth="1.4" /></svg>
            Notarised on macOS · code-signed on Windows · no telemetry · runs offline after install.
          </div>
          <details className="dl-checksums-toggle">
            <summary>SHA-256 checksums</summary>
            <div className="checksums">
              <div className="checksums-header"><span>Build 0.5.0</span><span>Verify your download</span></div>
              {CHECKSUMS.map(([name, hash]) => (
                <div className="checksum-row" key={name}>
                  <span className="checksum-platform">{name}</span>
                  <span className="checksum-hash">{hash}</span>
                  <button className="checksum-copy" onClick={() => navigator.clipboard.writeText(hash)}>Copy</button>
                </div>
              ))}
            </div>
          </details>
        </div>

        <footer className="dl-footer">
          <span>© 2026 Frost · Port-42</span>
          <span>Build 0.5.0 · Tauri 2 · Base Sepolia</span>
          <Link href="/">← Back to product</Link>
        </footer>
      </div>
    </div>
  );
}
