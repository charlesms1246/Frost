"use client";

/* eslint-disable @next/next/no-img-element -- partner logos are tiny static
   brand SVGs from /public; next/image optimization adds no value here. */

// Frost landing page — ported from the Claude Design handoff (Frost.html).
// Frosted-glass snowflake hero, partner strip, interactive lifecycle
// walk-through, how-it-works, features, use cases, download banner, footer.

import Link from "next/link";
import { useEffect, useState } from "react";
import FrostOrb from "./_components/FrostOrb";
import SiteNav from "./_components/SiteNav";
import { useOS } from "./_lib/use-os";

type TreeNode = { cls: string; name: string; role: string };
type TreeItem =
  | { line: true }
  | { branch: TreeNode[] }
  | TreeNode;

type WalkState = {
  label: string;
  title: string;
  status: string;
  l1: string;
  quote: string;
  tree: TreeItem[];
  l3: string;
  caveats: [string, string][];
  foot: string;
  cta: string;
};

const STATES: WalkState[] = [
  {
    label: "01 / BRIEF",
    title: "Frost — New Session · drafting",
    status: "DRAFT",
    l1: "Session Brief",
    quote:
      "If <em>ETH on Uniswap v3</em> falls below <em>$2,800</em>, swap to USDC on the best Base DEX, then post a Discord update to my community.",
    tree: [
      { cls: "node user", name: "0x7Ac…E91", role: "User" },
      { line: true },
      { cls: "node master pending", name: "master.agent", role: "Pending" },
    ],
    l3: "Compiled Caveats",
    caveats: [
      ["CAP", "$200"], ["HITL ≥", "$8k"], ["SLIPPAGE", "30bps"],
      ["TTL", "48h"], ["SUBS ≤", "12"], ["CHAIN", "Base"],
    ],
    foot: "Review the structured spec before signing",
    cta: "Sign Mandate",
  },
  {
    label: "02 / SPAWN",
    title: "Frost — Task Session · #04B2",
    status: "ACTIVE",
    l1: "Condition fired",
    quote:
      "Alchemy Notify · <em>ETH/USDC</em> price crossed <em>$2,800</em> · master spawning sub-agents.",
    tree: [
      { cls: "node user", name: "0x7Ac…E91", role: "User" },
      { line: true },
      { cls: "node master", name: "master.agent", role: "Master" },
      { line: true },
      {
        branch: [
          { cls: "node sub", name: "monitor", role: "Sub" },
          { cls: "node sub", name: "pricer.uni", role: "Sub" },
          { cls: "node sub", name: "pricer.1inch", role: "Sub" },
          { cls: "node sub", name: "pricer.para", role: "Sub" },
        ],
      },
    ],
    l3: "Spawn budget",
    caveats: [
      ["SUBS", "4 / 12"], ["SPENT", "$1.40"], ["VENICE", "4 calls"], ["RATE", "OK"],
    ],
    foot: "Master selecting best route across 3 quotes",
    cta: "Inspect",
  },
  {
    label: "03 / HITL",
    title: "Frost — Task Session · #04B2",
    status: "PAUSED",
    l1: "Awaiting approval",
    quote:
      "Executor pre-check: tx value <em>$9,420</em> exceeds <em>HITL ≥ $8k</em>. Holding submission.",
    tree: [
      { cls: "node user", name: "0x7Ac…E91", role: "User" },
      { line: true },
      { cls: "node master", name: "master.agent", role: "Master" },
      { line: true },
      {
        branch: [
          { cls: "node sub", name: "pricer.uni", role: "Done" },
          { cls: "node sub hitl", name: "executor", role: "HITL" },
          { cls: "node sub", name: "comms", role: "Queued" },
        ],
      },
    ],
    l3: "Pending transaction",
    caveats: [
      ["VALUE", "$9,420"], ["SLIPPAGE", "24bps"], ["ROUTE", "Uniswap v3"], ["GAS", "0.04 gwei"],
    ],
    foot: "Notification posted to OS · 14:32 remaining",
    cta: "Approve",
  },
  {
    label: "04 / RECEIPT",
    title: "Frost — Task Session · #04B2 · closed",
    status: "SETTLED",
    l1: "Session receipt",
    quote:
      "Swap settled on <em>Uniswap v3</em>. Comms posted to <em>#alpha-room</em>. Audit Merkle root anchored on Base Sepolia.",
    tree: [
      { cls: "node user", name: "0x7Ac…E91", role: "User" },
      { line: true },
      { cls: "node master", name: "master.agent", role: "Closed" },
      { line: true },
      {
        branch: [
          { cls: "node sub", name: "monitor", role: "Done" },
          { cls: "node sub", name: "pricer×3", role: "Done" },
          { cls: "node sub exec", name: "executor", role: "Done" },
          { cls: "node sub", name: "comms", role: "Done" },
        ],
      },
    ],
    l3: "Totals",
    caveats: [
      ["SWAP", "$9,420"], ["SPENT", "$0.84"], ["SUBS", "6 / 12"], ["HITL", "1"], ["BLOCK", "#19,402,118"],
    ],
    foot: "0x3b9…f02 · on-chain Merkle root",
    cta: "Open receipt",
  },
];

const HOME_PLATFORMS = [
  {
    key: "mac",
    label: "macOS",
    meta: "Apple Silicon + Intel · dmg",
    icon: <svg className="dl-btn-icon" viewBox="0 0 18 18" fill="none"><path d="M9 2v10M5 8l4 4 4-4M2.5 14.5h13" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>,
  },
  {
    key: "windows",
    label: "Windows",
    meta: "x64 · msi installer",
    icon: <svg className="dl-btn-icon" viewBox="0 0 18 18" fill="none"><rect x="2" y="2" width="6" height="6" rx="1" stroke="currentColor" strokeWidth="1.5" /><rect x="10" y="2" width="6" height="6" rx="1" stroke="currentColor" strokeWidth="1.5" /><rect x="2" y="10" width="6" height="6" rx="1" stroke="currentColor" strokeWidth="1.5" /><rect x="10" y="10" width="6" height="6" rx="1" stroke="currentColor" strokeWidth="1.5" /></svg>,
  },
  {
    key: "linux",
    label: "Linux",
    meta: "AppImage · deb · rpm",
    icon: <svg className="dl-btn-icon" viewBox="0 0 18 18" fill="none"><circle cx="9" cy="9" r="7" stroke="currentColor" strokeWidth="1.5" /><path d="M9 5v4l3 2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /><path d="M6 13.5c1-1 4-1 6 0" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>,
  },
] as const;

function TreeView({ items }: { items: TreeItem[] }) {
  return (
    <div className="tree">
      {items.map((item, i) => {
        if ("line" in item) return <div key={i} className="tree-line" />;
        if ("branch" in item) {
          return (
            <div key={i} className="branch">
              {item.branch.map((n, j) => (
                <div key={j} className={n.cls}>
                  <span className="glyph" />
                  {n.name} <span className="role">{n.role}</span>
                </div>
              ))}
            </div>
          );
        }
        return (
          <div key={i} className={item.cls}>
            <span className="glyph" />
            {item.name} <span className="role">{item.role}</span>
          </div>
        );
      })}
    </div>
  );
}

export default function Home() {
  const [idx, setIdx] = useState(0);
  const os = useOS();

  // Walk-through auto-advances on its own — the app window reads as "live"
  // without the (removed) playback controls cluttering the detail section.
  useEffect(() => {
    const t = setInterval(() => setIdx((i) => (i + 1) % STATES.length), 3200);
    return () => clearInterval(t);
  }, []);

  const s = STATES[idx];
  // Default the recommendation to macOS until/unless we detect the visitor's OS.
  const primaryKey = os === "other" ? "mac" : os;

  return (
    <>
      <div className="grid-bg" aria-hidden="true" />
      <div className="meta-strip" aria-hidden="true">PORT-42 · MAINFRAME · BASE SEPOLIA</div>
      <div className="meta-strip-l" aria-hidden="true">BUILD 0.5.0 · MAY 2026 · TAURI</div>

      <div className="shell home-shell">
        <SiteNav active="product" />

        {/* ─── hero ─── */}
        {/* fade the whole stage once so BOUNDED(z1) · snowflake(z2) · AUTONOMY(z4)
            interleave correctly — fading the layers individually makes .headline
            its own stacking context and flattens the two words into one layer. */}
        <section className="hero">
          <div className="hero-stage fade-up d1">
            <div className="headline" aria-hidden="true">
              <div className="row back">Bounded</div>
              <div className="row row-2 front">Autonomy</div>
            </div>

            <FrostOrb />
          </div>

          <div className="tagline fade-up d3">
            <span className="rule" />
            Signed. Scoped. Revocable.
            <span className="rule" />
          </div>
        </section>

        {/* ─── partner strip ─── */}
        {/* Static brand marks from /public — plain <img> is fine; no optimization needed. */}
        <section className="partners fade-up d4" aria-label="Underlying stack">
          <div className="partner">
            <img className="partner-logo" src="/MetaMask-icon-fox-developer.svg" alt="" aria-hidden="true" />
            <span>MetaMask<span className="role">Smart Accounts</span></span>
          </div>
          <div className="partner">
            <img className="partner-logo" src="/venice-keys-deep-blue.svg" alt="" aria-hidden="true" />
            <span>Venice AI<span className="role">x402 inference</span></span>
          </div>
          <div className="partner">
            <span className="partner-mark" aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.6" /><path d="M8 12 L11 15 L17 9" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></svg>
            </span>
            <span>1Shot API<span className="role">execution</span></span>
          </div>
          <div className="partner">
            <img className="partner-logo" src="/x402_vector.svg" alt="" aria-hidden="true" />
            <span>x402<span className="role">per-call USDC</span></span>
          </div>
          <div className="partner">
            <img className="partner-logo" src="/Base_square_blue.svg" alt="" aria-hidden="true" />
            <span>Base<span className="role">Sepolia testnet</span></span>
          </div>
        </section>

        {/* ─── product detail ─── */}
        <section className="detail detail-2" id="detail">
          <div className="col col-left">
            <div className="kicker">Desktop Application</div>
            <h2 className="product-name">Frost<br />1.0</h2>
            <div className="product-spec">Tauri · 240 MB · macOS / Linux / Windows</div>
            <div style={{ marginTop: "auto" }}>
              <div className="label">Stack</div>
              <ul className="stack-list" style={{ marginTop: 12 }}>
                <li><span>Identity</span>MetaMask Smart Accounts</li>
                <li><span>Authority</span>ERC-7710 redelegation</li>
                <li><span>Settlement</span>x402 over USDC</li>
                <li><span>Inference</span>Venice AI (native-x402)</li>
                <li><span>Execution</span>1Shot API · private mempool</li>
                <li><span>Audit</span>On-chain Merkle commitment</li>
              </ul>
            </div>
          </div>

          <div className="detail-stage">
            <article className="app-frame" aria-label="Frost task session detail">
              <header className="app-titlebar">
                <div className="traffic"><span /><span /><span /></div>
                <div className="app-title">{s.title}</div>
                <div className="app-meta"><span className="live" />{s.status}</div>
              </header>
              <div className="app-body">
                <div>
                  <div className="app-section-label">{s.l1}</div>
                  <p className="app-quote" dangerouslySetInnerHTML={{ __html: s.quote }} />
                </div>
                <div>
                  <div className="app-section-label">Delegation Tree</div>
                  <TreeView items={s.tree} />
                </div>
                <div>
                  <div className="app-section-label">{s.l3}</div>
                  <div className="caveats">
                    {s.caveats.map(([k, v], i) => (
                      <span className="chip" key={i}><span className="k">{k}</span><b>{v}</b></span>
                    ))}
                  </div>
                </div>
              </div>
              <footer className="app-foot">
                <div className="ks">{s.foot}</div>
                <div className="sign">{s.cta}</div>
              </footer>
            </article>
          </div>
        </section>

        {/* ─── how it works ─── */}
        <section className="how" aria-label="How it works">
          <div className="section-eyebrow">How it works</div>
          <div className="how-steps">
            <div className="how-step">
              <span className="step-num">01</span>
              <div className="step-icon">
                <svg width="20" height="20" viewBox="0 0 20 20" fill="none"><path d="M4 5h12M4 9h8M4 13h10" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" /></svg>
              </div>
              <div className="step-title">Describe</div>
              <p className="step-body">Write your intent in plain English — a condition, an action, a limit. No code, no config files. Frost reads it like a brief.</p>
            </div>
            <div className="how-step">
              <span className="step-num">02</span>
              <div className="step-icon">
                <svg width="20" height="20" viewBox="0 0 20 20" fill="none"><path d="M10 2L3 7v6l7 5 7-5V7L10 2z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" /><path d="M7 10l2 2 4-4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>
              </div>
              <div className="step-title">Compile &amp; Sign</div>
              <p className="step-body">The master agent compiles a structured mandate — caveats, caps, TTL, HITL thresholds — surfaces it for review. You sign exactly once with your MetaMask smart account.</p>
            </div>
            <div className="how-step">
              <span className="step-num">03</span>
              <div className="step-icon">
                <svg width="20" height="20" viewBox="0 0 20 20" fill="none"><circle cx="10" cy="10" r="7" stroke="currentColor" strokeWidth="1.6" /><path d="M10 6v4l3 2" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" /></svg>
              </div>
              <div className="step-title">Walk Away</div>
              <p className="step-body">Frost runs in the background. Sub-agents spawn on demand. High-stakes actions pause for your approval. An on-chain Merkle root logs every decision.</p>
            </div>
          </div>
        </section>

        {/* ─── features ─── */}
        <section className="features" aria-label="Features">
          <div className="features-header">
            <div>
              <div className="section-eyebrow" style={{ marginBottom: 16 }}>Capabilities</div>
              <div className="features-title">Built for<br />precision.</div>
            </div>
            <p className="features-sub">Every design decision in Frost traces back to one constraint: agents should do exactly what you authorised — no more, no less, never without a trail.</p>
          </div>
          <div className="feat-grid">
            <div className="feat-card">
              <svg className="feat-icon" viewBox="0 0 32 32" fill="none"><path d="M16 4L6 9v8c0 5.5 4.3 10.7 10 12 5.7-1.3 10-6.5 10-12V9L16 4z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" /><path d="M12 16l3 3 6-6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>
              <div className="feat-name">Bounded Authority</div>
              <p className="feat-desc">ERC-7710 redelegation chains hard-cap every sub-agent&apos;s spend, call count, TTL, and chain scope. Authority can only narrow, never expand downstream.</p>
              <span className="feat-tag">ERC-7710</span>
            </div>
            <div className="feat-card">
              <svg className="feat-icon" viewBox="0 0 32 32" fill="none"><circle cx="16" cy="16" r="11" stroke="currentColor" strokeWidth="1.6" /><path d="M16 10v6l4 3" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" /><circle cx="16" cy="16" r="2" fill="currentColor" /></svg>
              <div className="feat-name">Human-in-the-Loop</div>
              <p className="feat-desc">Set a value threshold — any transaction above it pauses the session and fires an OS notification. You approve or deny before execution resumes.</p>
              <span className="feat-tag">HITL</span>
            </div>
            <div className="feat-card">
              <svg className="feat-icon" viewBox="0 0 32 32" fill="none"><circle cx="16" cy="8" r="3" stroke="currentColor" strokeWidth="1.6" /><circle cx="8" cy="22" r="3" stroke="currentColor" strokeWidth="1.6" /><circle cx="24" cy="22" r="3" stroke="currentColor" strokeWidth="1.6" /><path d="M16 11v4M16 15l-5 4M16 15l5 4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" /></svg>
              <div className="feat-name">Dynamic Sub-agents</div>
              <p className="feat-desc">No standing agents. The master spawns specialists at runtime — pricers, monitors, executors — only when the trigger condition fires. Venice AI powers each call via x402.</p>
              <span className="feat-tag">x402 · Venice</span>
            </div>
            <div className="feat-card">
              <svg className="feat-icon" viewBox="0 0 32 32" fill="none"><rect x="8" y="14" width="16" height="12" rx="2" stroke="currentColor" strokeWidth="1.6" /><path d="M11 14v-3a5 5 0 0 1 10 0v3" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" /><circle cx="16" cy="20" r="2" fill="currentColor" /></svg>
              <div className="feat-name">Zero Custody</div>
              <p className="feat-desc">Your seed phrase and private keys never leave your device. Agents operate with narrowly-scoped delegated credentials; revoke any branch in one click.</p>
              <span className="feat-tag">Non-custodial</span>
            </div>
            <div className="feat-card">
              <svg className="feat-icon" viewBox="0 0 32 32" fill="none"><path d="M6 26l5-5m10-10l5-5M11 21l10-10M8 8l16 16" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" opacity="0.3" /><rect x="5" y="5" width="9" height="9" rx="2" stroke="currentColor" strokeWidth="1.6" /><rect x="18" y="18" width="9" height="9" rx="2" stroke="currentColor" strokeWidth="1.6" /><path d="M14 9h4v4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>
              <div className="feat-name">On-chain Audit</div>
              <p className="feat-desc">Every session&apos;s full decision tree is hashed and committed as a Merkle root on Base Sepolia. Immutable, verifiable, attributable — without storing sensitive data on-chain.</p>
              <span className="feat-tag">Base · Merkle</span>
            </div>
            <div className="feat-card">
              <svg className="feat-icon" viewBox="0 0 32 32" fill="none"><circle cx="16" cy="16" r="11" stroke="currentColor" strokeWidth="1.6" /><path d="M16 10v2m0 8v2m-4.2-9.8l1.4 1.4m5.6 5.6l1.4 1.4M10 16h2m8 0h2m-9.8 4.2l1.4-1.4m5.6-5.6l1.4-1.4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" /><circle cx="16" cy="16" r="3" stroke="currentColor" strokeWidth="1.6" /></svg>
              <div className="feat-name">Pay-per-Inference</div>
              <p className="feat-desc">Venice AI is billed per call over the x402 protocol in USDC — no subscriptions, no API keys to manage. Unused budget stays in your wallet.</p>
              <span className="feat-tag">x402 · USDC</span>
            </div>
          </div>
        </section>

        {/* ─── use cases ─── */}
        <section className="usecases" aria-label="Use cases">
          <div className="section-eyebrow">In practice</div>
          <div className="uc-grid">
            <div className="uc-card">
              <div className="uc-category">DeFi Automation</div>
              <div className="uc-title">Conditional swaps while you sleep</div>
              <p className="uc-desc">Set a price trigger, a slippage cap, and a spend ceiling. Frost watches the market, finds the best route across DEXs, and executes — pausing for approval if the value exceeds your HITL threshold.</p>
              <div className="uc-brief" dangerouslySetInnerHTML={{ __html: '"If <em>ETH &lt; $2,800</em> swap to USDC on best Base DEX. Slippage &lt; <em>30bps</em>, cap <em>$200</em>, HITL ≥ <em>$8k</em>."' }} />
            </div>
            <div className="uc-card">
              <div className="uc-category">DAO Governance</div>
              <div className="uc-title">Vote on proposals without babysitting Snapshot</div>
              <p className="uc-desc">Define a voting policy — quorum threshold, keywords to watch, delegate rules. Frost monitors DAO proposals and casts your vote or posts a summary to your community channel when criteria match.</p>
              <div className="uc-brief" dangerouslySetInnerHTML={{ __html: '"Vote <em>YES</em> on any Uniswap proposal with quorum &gt; <em>10M</em>. Post summary to <em>#dao-updates</em>."' }} />
            </div>
            <div className="uc-card">
              <div className="uc-category">Portfolio Management</div>
              <div className="uc-title">Rebalance on drift, not on schedule</div>
              <p className="uc-desc">Define target allocations and a drift tolerance. When any asset drifts outside its band, Frost prices trades across venues, picks the cheapest route, and rebalances — with full on-chain receipts.</p>
              <div className="uc-brief" dangerouslySetInnerHTML={{ __html: '"Keep <em>60% ETH / 40% USDC</em>. Rebalance if drift &gt; <em>5%</em>. Max gas <em>50 gwei</em>."' }} />
            </div>
          </div>
        </section>

        {/* ─── download banner ─── */}
        <section className="dl-banner" id="download" aria-label="Download Frost">
          <h2 className="dl-title">Download<br />Frost 1.0</h2>
          <p className="dl-sub">Free during early access. Runs locally on macOS, Windows, and Linux. Your keys stay on your machine.</p>
          <div className="dl-platforms">
            {[...HOME_PLATFORMS]
              .sort((a, b) => Number(b.key === primaryKey) - Number(a.key === primaryKey))
              .map((p) => (
                <Link key={p.key} className={`dl-btn${p.key === primaryKey ? " primary" : ""}`} href="/download">
                  {p.icon}
                  <span className="dl-btn-text">
                    <span className="dl-btn-label">{p.label}{p.key === os ? " · detected" : ""}</span>
                    <span className="dl-btn-meta">{p.meta}</span>
                  </span>
                </Link>
              ))}
          </div>
          <div className="dl-note">Build 0.5.0 · May 2026 · Tauri 2 · Early Access</div>
        </section>

        {/* ─── footer ─── */}
        <footer className="site">
          <div className="col">
            <strong>Frost</strong>
            <Link href="/">Product</Link>
            <Link href="#">Pitch deck</Link>
            <Link href="#">Build journal</Link>
            <Link href="/download">Download</Link>
          </div>
          <div className="col">
            <strong>Resources</strong>
            <Link href="#">Port-42 architecture</Link>
            <Link href="#">Threat model</Link>
            <Link href="#">Contract specs</Link>
            <Link href="#">Changelog</Link>
          </div>
          <div className="col">
            <strong>Community</strong>
            <Link href="#">Discord</Link>
            <Link href="#">GitHub</Link>
            <Link href="#">X / Twitter</Link>
          </div>
          <div className="col" style={{ textAlign: "right", marginLeft: "auto" }}>
            <strong>© Frost · Port-42</strong>
            <span>Early access · Build 0.5.0</span>
            <span>Targeting June 15 2026</span>
          </div>
        </footer>
      </div>
    </>
  );
}
