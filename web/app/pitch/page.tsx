"use client";

// Pitch deck — the judge-facing presentation deck (5 slides), the on-screen
// pitch that runs alongside the demo video. Keyboard / arrow / dot navigation,
// one slide per viewport. Reach it at /pitch. Content tracks hackathon-pitch.md
// and DEMO_SCRIPT.md — keep the closing claim (slide 04) verifiable on screen
// or on BaseScan.

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

type Slide = {
  kicker: string;
  title: React.ReactNode;
  body: React.ReactNode;
};

const SLIDES: Slide[] = [
  {
    kicker: "Port-42",
    title: <>FROST</>,
    body: (
      <>
        <p className="slide-lede">Bounded autonomy for web3 operators. Describe a workflow in plain English, sign once, walk away — work that settles per call in USDC and stays revocable mid-flight.</p>
        <p className="slide-accent">Signed. Scoped. Revocable.</p>
      </>
    ),
  },
  {
    kicker: "01 · The problem",
    title: <>You hand it the keys<br />and hope.</>,
    body: <p className="slide-lede">Agents act with no scope — one you spin up to rebalance your position can, technically, drain it. No spending cap, no off switch once it&apos;s running, no record of what it did. So you either over-trust it (unbounded risk) or babysit every move (no autonomy). No middle ground that is signed, scoped, and revocable.</p>,
  },
  {
    kicker: "02 · Frost",
    title: <>Describe → Sign → Walk away.</>,
    body: (
      <div className="slide-cols">
        <div><div className="slide-col-h">Describe</div><p>A trigger, an action, and limits in one English sentence.</p></div>
        <div><div className="slide-col-h">Compile &amp; sign</div><p>The master compiles it into a structured mandate — caps, slippage, TTL, HITL, spawning bounds. You review the spec and sign once.</p></div>
        <div><div className="slide-col-h">Walk away</div><p>The master spawns specialists on demand inside bounded sub-mandates. High-stakes actions pause for you; you revoke any branch mid-flight.</p></div>
      </div>
    ),
  },
  {
    kicker: "03 · What's different",
    title: <>Bounded autonomy,<br />with a receipt.</>,
    body: (
      <div className="slide-cols slide-cols--quad">
        <div><div className="slide-col-h">Dynamic A2A spawning</div><p>The master decides at runtime what specialists a task needs and spawns them under signed <code>CAP_REDELEGATE</code> bounds — not a fixed template.</p></div>
        <div><div className="slide-col-h">Per-call USDC, no API keys</div><p>Every inference call is paid per call in USDC over x402, settled as a delegation of your own Smart Account grant.</p></div>
        <div><div className="slide-col-h">HITL + revocation</div><p>Above your signed threshold Frost stops and asks. Revoking spawning authority halts new sub-agents at the contract layer.</p></div>
        <div><div className="slide-col-h">On-chain audit trail</div><p>Every decision is committed to a tamper-evident Merkle root on-chain, co-signed so neither side can forge history.</p></div>
      </div>
    ),
  },
  {
    kicker: "04 · The stack & the ask",
    title: <>Five primitives.<br />One product.</>,
    body: (
      <>
        <div className="caveats slide-chips">
          {[["IDENTITY", "MetaMask Smart Accounts"], ["AUTHORITY", "ERC-7710 / 7715"], ["SETTLEMENT", "x402 · USDC"], ["INFERENCE", "Venice AI"], ["EXECUTION", "1Shot API"], ["AUDIT", "On-chain Merkle"]].map(([k, v]) => (
            <span className="chip" key={k}><span className="k">{k}</span><b>{v}</b></span>
          ))}
        </div>
        <p className="slide-lede">Targeting the MetaMask Smart Accounts × 1Shot Dev Cook-Off across the Best x402 + ERC-7710, A2A Coordination, Best Agent, and Best Venice AI tracks. Open source, running on <span className="slide-accent">Base Sepolia today</span>.</p>
        <Link className="cta slide-cta" href="/download">Download Frost</Link>
      </>
    ),
  },
];

export default function PitchPage() {
  const [i, setI] = useState(0);
  const go = useCallback((n: number) => setI(Math.max(0, Math.min(SLIDES.length - 1, n))), []);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "ArrowRight" || e.key === "PageDown" || e.key === " ") { e.preventDefault(); go(i + 1); }
      if (e.key === "ArrowLeft" || e.key === "PageUp") { e.preventDefault(); go(i - 1); }
      if (e.key === "Home") go(0);
      if (e.key === "End") go(SLIDES.length - 1);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [i, go]);

  const s = SLIDES[i];

  return (
    <div className="deck-page">
      <div className="grid-bg" aria-hidden="true" />

      <header className="deck-top">
        <Link className="brand" href="/">FROST<small>BY PORT 42</small></Link>
        <Link className="back-btn" href="/">Exit deck</Link>
      </header>

      <main className="deck-stage">
        <section className="slide" key={i}>
          <div className="slide-kicker">{s.kicker}</div>
          <h1 className="slide-title">{s.title}</h1>
          <div className="slide-body">{s.body}</div>
        </section>
      </main>

      <footer className="deck-bar">
        <button className="deck-arrow" onClick={() => go(i - 1)} disabled={i === 0} aria-label="Previous slide">
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M9 2L4 7l5 5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>
        </button>
        <div className="deck-dots">
          {SLIDES.map((_, n) => (
            <button key={n} className={`deck-dot${n === i ? " on" : ""}`} onClick={() => go(n)} aria-label={`Slide ${n + 1}`} />
          ))}
        </div>
        <button className="deck-arrow" onClick={() => go(i + 1)} disabled={i === SLIDES.length - 1} aria-label="Next slide">
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M5 2l5 5-5 5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>
        </button>
        <div className="deck-count">{String(i + 1).padStart(2, "0")} / {String(SLIDES.length).padStart(2, "0")}</div>
      </footer>
    </div>
  );
}
