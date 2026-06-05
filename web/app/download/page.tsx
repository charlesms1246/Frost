"use client";

/* eslint-disable @next/next/no-img-element -- platform logos are tiny static
   brand SVGs from /public; next/image optimization adds no value here. */

// Frost download page — ported from the Claude Design handoff (download.html),
// compacted to a single viewport and OS-aware (the visitor's platform is
// detected and recommended).

import Link from "next/link";
import SiteNav from "../_components/SiteNav";
import { useOS } from "../_lib/use-os";

const DOWN_ICON = (
  <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
    <path d="M7 1v9M4 7l3 3 3-3M1.5 12h11" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

const MAC_ICON = <img className="platform-icon" src="/Apple_logo_black.svg" alt="" aria-hidden="true" />;
const WIN_ICON = <img className="platform-icon" src="/Windows_logo.svg" alt="" aria-hidden="true" />;
const LINUX_ICON = <img className="platform-icon" src="/Linux_Logo.svg" alt="" aria-hidden="true" />;

const PLATFORMS = [
  { key: "mac", name: "macOS", icon: MAC_ICON, formats: ["Apple Silicon", "Intel x64", ".dmg"], reqs: "macOS 12+ · ~95 MB", btn: "Download for macOS" },
  { key: "windows", name: "Windows", icon: WIN_ICON, formats: ["x64", ".msi", ".exe"], reqs: "Windows 10 (1903)+ · ~110 MB", btn: "Download for Windows" },
  { key: "linux", name: "Linux", icon: LINUX_ICON, formats: ["AppImage", ".deb", ".rpm"], reqs: "glibc 2.31+ · ~105 MB", btn: "Download for Linux" },
] as const;

const CHECKSUMS: [string, string][] = [
  ["macOS ARM64", "a3f8d2c1b7e4f09a2d5c8b1e3f6a9d2c5b8e1f4a7d0c3b6e9f2a5d8c1b4e7f0"],
  ["macOS x64", "d7e0a3f6b9c2e5a8d1f4c7b0e3a6d9f2c5b8e1a4d7f0c3b6a9e2d5f8c1b4e7a0"],
  ["Windows x64", "b4c7a0d3f6e9b2a5c8f1d4e7a0b3f6c9d2e5b8f1a4c7d0e3b6a9f2c5d8e1b4f7"],
  ["Linux AppImage", "e1b4f7c0a3d6e9f2b5c8d1a4f7e0b3d6c9a2e5f8b1d4a7f0e3b6d9c2a5f8e1b4"],
];

export default function DownloadPage() {
  const os = useOS();
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
          <div className="version-badge"><span className="live" />Build 0.5.0 · May 2026 · Tauri 2.0</div>
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
                <a className="dl-platform-btn" href="#">{DOWN_ICON}{p.btn}</a>
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
