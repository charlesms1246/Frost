"use client";

/* eslint-disable @next/next/no-img-element -- partner logos are tiny static
   brand SVGs from /public; next/image optimization adds no value here. */

// Frost landing page — ported from the Claude Design handoff (Frost.html).
// Frosted-glass snowflake hero, partner strip, interactive lifecycle
// walk-through, how-it-works, features, use cases, download banner, footer.

import { useEffect, useState } from "react";
import FrostOrb from "./_components/FrostOrb";
import SiteNav from "./_components/SiteNav";
import SiteFooter from "./_components/SiteFooter";
import FaqList from "./_components/FaqList";
import { useOS } from "./_lib/use-os";
import { useRelease } from "./_lib/use-release";

const HOME_PLATFORMS = [
  {
    key: "mac",
    label: "macOS",
    meta: "Apple Silicon · dmg",
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

const SHOTS = [
  { src: "/shots/chat.png", title: "Describe in plain English", desc: "Author a session brief in chat — Frost compiles it into a signed, scoped mandate.", alt: "Frost chat — authoring a session brief" },
  { src: "/shots/multi-agent-workflow.png", title: "Live delegation tree", desc: "Watch the master agent spawn sub-agents on demand, each with bounded authority.", alt: "Frost multi-agent workflow visualizer" },
  { src: "/shots/custom_agents.png", title: "Custom agents", desc: "Define specialist agents and the caveats that cap their spend, calls, and scope.", alt: "Frost custom agents configuration" },
  { src: "/shots/wallet-page.png", title: "Wallet & permissions", desc: "Review balances and revoke any delegated branch in one click. Keys stay on-device.", alt: "Frost wallet and permissions page" },
] as const;

export default function Home() {
  const [idx, setIdx] = useState(0);
  const os = useOS();
  const release = useRelease();

  // The detail stage cycles real app screenshots (placeholders for the demo
  // video that will live here later). Auto-advances; dots allow manual select.
  useEffect(() => {
    const t = setInterval(() => setIdx((i) => (i + 1) % SHOTS.length), 4000);
    return () => clearInterval(t);
  }, []);

  const shot = SHOTS[idx];
  // Default the recommendation to macOS until/unless we detect the visitor's OS.
  const primaryKey = os === "other" ? "mac" : os;

  return (
    <>
      <div className="grid-bg" aria-hidden="true" />
      <div className="meta-strip" aria-hidden="true">FROST · MAINFRAME · BASE SEPOLIA</div>
      <div className="meta-strip-l" aria-hidden="true">BUILD 0.1.0 · JUN 2026 · TAURI</div>

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

        {/* ─── product showcase (centered) ─── */}
        <section className="showcase" id="detail" aria-label="Inside Frost">
          <div className="showcase-head">
            <div className="section-eyebrow">Desktop Application</div>
            <h2 className="showcase-title">Frost 1.0</h2>
            <p className="showcase-lede">A native desktop app — Tauri 2, ~5 MB, for macOS, Windows, and Linux. Describe an automation in plain English and Frost compiles it into a signed, scoped, revocable on-chain mandate, then runs it while you walk away.</p>
          </div>

          {/* Real captures of the desktop app — placeholder for the demo
              walk-through video, to be swapped in here later. */}
          <figure className="shot-showcase showcase-media">
            <div className="shot-frame">
              <img className="shot-img" src={shot.src} alt={shot.alt} loading="lazy" />
            </div>
            <figcaption className="shot-cap">
              <span className="shot-cap-title">{shot.title}</span>
              <span className="shot-cap-desc">{shot.desc}</span>
            </figcaption>
            <div className="shot-dots" role="tablist" aria-label="Screenshots">
              {SHOTS.map((sh, i) => (
                <button
                  key={sh.src}
                  type="button"
                  role="tab"
                  className={`shot-dot${i === idx ? " active" : ""}`}
                  aria-label={sh.title}
                  aria-selected={i === idx}
                  onClick={() => setIdx(i)}
                />
              ))}
            </div>
          </figure>

          <ul className="showcase-stack">
            <li><span>Identity</span>MetaMask Smart Accounts</li>
            <li><span>Authority</span>ERC-7710 redelegation</li>
            <li><span>Settlement</span>x402 over USDC</li>
            <li><span>Inference</span>Venice AI (native-x402)</li>
            <li><span>Execution</span>1Shot API · private mempool</li>
            <li><span>Audit</span>On-chain Merkle commitment</li>
          </ul>
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

        {/* ─── features (dark highlight panel) ─── */}
        <section className="features features--dark" aria-label="Features">
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

        {/* ─── faq ─── */}
        <FaqList />

        {/* ─── download banner ─── */}
        <section className="dl-banner" id="download" aria-label="Download Frost">
          <h2 className="dl-title">Download<br />Frost 1.0</h2>
          <p className="dl-sub">Free during early access. Runs locally on macOS, Windows, and Linux. Your keys stay on your machine.</p>
          <div className="dl-platforms">
            {[...HOME_PLATFORMS]
              .sort((a, b) => Number(b.key === primaryKey) - Number(a.key === primaryKey))
              .map((p) => (
                <a
                  key={p.key}
                  className={`dl-btn${p.key === primaryKey ? " primary" : ""}`}
                  href={release.assets[p.key][0]?.url ?? release.releaseUrl}
                  target="_blank"
                  rel="noreferrer"
                >
                  {p.icon}
                  <span className="dl-btn-text">
                    <span className="dl-btn-label">{p.label}{p.key === os ? " · detected" : ""}</span>
                    <span className="dl-btn-meta">{p.meta}</span>
                  </span>
                </a>
              ))}
          </div>
          <div className="dl-note">{release.version ? `${release.version} · ` : ""}Tauri 2 · Early Access · from GitHub Releases</div>
        </section>

        {/* ─── footer ─── */}
        <SiteFooter />
      </div>
    </>
  );
}
