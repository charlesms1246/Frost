import type { Metadata } from "next";
import Link from "next/link";
import SiteNav from "../_components/SiteNav";
import FrostOrb from "../_components/FrostOrb";
import { SnowflakeMark } from "../_components/SnowflakeMark";

export const metadata: Metadata = {
  title: "Architecture — Frost & Port-42",
  description: "How Port-42 powers Frost: the four-layer stack, the session lifecycle, the six contracts, and the caveat model.",
};

const LAYERS = [
  { n: "01", title: "Identity", body: "MetaMask Smart Accounts give every user a programmable account. The user signs once; agents never touch the seed.", tag: "Smart Accounts" },
  { n: "02", title: "Authority", body: "ERC-7710 redelegation encodes bounded, revocable mandates. Authority flows down a chain and can only ever narrow.", tag: "ERC-7710 / 7715" },
  { n: "03", title: "Settlement & Inference", body: "x402 pays per call in USDC. Venice AI supplies native-x402 inference and read-side RPC for the monitor and pricer agents.", tag: "x402 · Venice" },
  { n: "04", title: "Execution & Audit", body: "1Shot submits transactions through a private mempool. Every decision is hashed into an on-chain Merkle root.", tag: "1Shot · Merkle" },
];

const LIFECYCLE = [
  ["Brief", "You describe a workflow in plain English. The master agent compiles it into a structured authority spec with explicit caveats."],
  ["Sign", "You review the spec and sign one root mandate with your smart account. No standing agents exist yet."],
  ["Spawn", "When the trigger fires, the master dynamically issues sub-mandates and spawns specialists — monitors, pricers, executors."],
  ["Gate", "Any action above your HITL threshold pauses the session and fires an OS notification. You approve or deny."],
  ["Execute", "The executor submits through 1Shot's private mempool to avoid front-running. Inference is metered per call over x402."],
  ["Commit", "The full decision tree is hashed and the Merkle root is anchored on Base Sepolia. Revoke any branch at any time."],
];

const CONTRACTS = [
  ["Mandate", "Issues root mandates and sub-mandates; validates each operation against the active caveat set and ancestry."],
  ["RefillableMandate", "Refill replaces the active mandate and mints a fresh mandateId per cycle (Option A)."],
  ["DelegationRegistry", "Tracks aggregate redelegation state so caps hold across the whole sub-mandate tree."],
  ["Settlement", "x402 settlement over USDC. The USDC address is hardcoded immutably per chain."],
  ["ProviderRegistry", "Whitelists the inference / execution providers an agent may pay and call."],
  ["Revocation", "One-call revocation of any delegation — a branch or the master's spawning authority."],
];

export default function ArchitecturePage() {
  return (
    <>
      <div className="grid-bg" aria-hidden="true" />
      <div className="shell home-shell">
        <SiteNav active="architecture" />

        <header className="page-head">
          <div className="section-eyebrow">Architecture · Port-42</div>
          <h1 className="page-title">Bounded authority,<br />all the way down.</h1>
          <p className="page-lede">Frost is the product; <strong>Port-42</strong> is the rail underneath it — MetaMask Smart Accounts, ERC-7710 redelegation, x402 payments, Venice AI inference, and 1Shot execution, composed so an autonomous agent can do exactly what you authorised and nothing more.</p>
        </header>

        {/* four layers */}
        <section className="how" aria-label="The four layers">
          <div className="section-eyebrow">The stack</div>
          <div className="how-steps">
            {LAYERS.map((l) => (
              <div className="how-step" key={l.n} style={{ padding: "32px 28px" }}>
                <span className="step-num">{l.n}</span>
                <div className="step-title">{l.title}</div>
                <p className="step-body">{l.body}</p>
                <span className="feat-tag">{l.tag}</span>
              </div>
            ))}
            {/* fill the two empty cells of the 3-col grid with a frost-mark motif */}
            <div className="how-step how-step--motif" aria-hidden="true">
              <SnowflakeMark className="motif-mark" />
            </div>
            <div className="how-step how-step--motif" aria-hidden="true">
              <SnowflakeMark className="motif-mark motif-mark--alt" />
            </div>
          </div>
        </section>

        {/* lifecycle */}
        <section className="arch-lifecycle" aria-label="Session lifecycle">
          <div className="section-eyebrow">Session lifecycle</div>
          <div className="lifecycle-layout">
            <ol className="lifecycle">
              {LIFECYCLE.map(([t, b], i) => (
                <li className="lifecycle-step" key={t}>
                  <div className="lifecycle-rail"><span className="lifecycle-dot" />{i < LIFECYCLE.length - 1 && <span className="lifecycle-line" />}</div>
                  <div className="lifecycle-body">
                    <div className="lifecycle-title">{t}</div>
                    <p className="doc-p" style={{ margin: 0 }}>{b}</p>
                  </div>
                </li>
              ))}
            </ol>
            <div className="lifecycle-aside" aria-hidden="true">
              <FrostOrb className="frost-orb--aside" />
            </div>
          </div>
        </section>

        {/* contracts */}
        <section className="features" aria-label="The six contracts">
          <div className="features-header">
            <div>
              <div className="section-eyebrow" style={{ marginBottom: 16 }}>On-chain</div>
              <div className="features-title">Six contracts.</div>
            </div>
            <p className="features-sub">Port-42 is deliberately small. Six contracts hold the entire authority, settlement, and audit model — each one auditable in isolation.</p>
          </div>
          <div className="feat-grid">
            {CONTRACTS.map(([name, desc]) => (
              <div className="feat-card" key={name}>
                <div className="feat-name mono">{name}</div>
                <p className="feat-desc">{desc}</p>
                <span className="feat-tag">Solidity</span>
              </div>
            ))}
          </div>
        </section>

        {/* caveat model */}
        <section className="usecases" aria-label="Caveat model">
          <div className="section-eyebrow">The caveat model</div>
          <div className="uc-grid">
            <div className="uc-card">
              <div className="uc-category">Narrowing only</div>
              <div className="uc-title">Authority can only shrink</div>
              <p className="uc-desc">Every sub-mandate is a strict subset of its parent — lower caps, fewer calls, shorter TTL, narrower chain scope. A child can never out-scope its parent.</p>
            </div>
            <div className="uc-card">
              <div className="uc-category">Safe intersection</div>
              <div className="uc-title">HITL is max(parent, sub)</div>
              <p className="uc-desc">The human-in-the-loop threshold intersects upward: sub-mandates can only lower it, tightening safety. A min here would silently weaken the guarantee — so it is forbidden.</p>
            </div>
            <div className="uc-card">
              <div className="uc-category">Unified budget</div>
              <div className="uc-title">One token bucket</div>
              <p className="uc-desc">A single rate-limit bucket covers both x402 settlements and sub-mandate issuance, so a runaway agent can&apos;t escape the cap by switching channels.</p>
            </div>
          </div>
        </section>

        <footer className="site">
          <div className="col"><strong>Frost</strong><Link href="/">Product</Link><Link href="/download">Download</Link><Link href="/docs">Docs</Link></div>
          <div className="col"><strong>Architecture</strong><a href="#">Layers</a><a href="#">Lifecycle</a><a href="#">Contracts</a></div>
          <div className="col"><strong>Community</strong><a href="#">Discord</a><a href="#">GitHub</a></div>
          <div className="col" style={{ textAlign: "right", marginLeft: "auto" }}><strong>© Frost · Port-42</strong><span>Early access · Build 0.5.0</span></div>
        </footer>
      </div>
    </>
  );
}
