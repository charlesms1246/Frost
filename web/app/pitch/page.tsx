"use client";

// Pitch deck — a VC/judge-facing slide template. Content is intentionally a
// placeholder skeleton to be finalised once the app is deployed; the deck
// mechanics (keyboard / arrow / dot navigation, one slide per viewport) are
// done. Reach it at /pitch.

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
    body: <p className="slide-lede">Bounded autonomy for web3 operators. Describe a workflow, sign once, walk away.</p>,
  },
  {
    kicker: "01 · Problem",
    title: <>Agents are trusted too much<br />or used too little.</>,
    body: <p className="slide-lede">To automate on-chain workflows today you either hand an agent your keys (unbounded risk) or babysit every action (no autonomy). There is no middle ground that is signed, scoped, and revocable.</p>,
  },
  {
    kicker: "02 · Solution",
    title: <>One signature.<br />Bounded authority.</>,
    body: <p className="slide-lede">Frost compiles a plain-English brief into a structured mandate with explicit caveats. You sign once. A master agent spawns specialists inside strictly bounded sub-mandates — and you can revoke any branch mid-flight.</p>,
  },
  {
    kicker: "03 · How it works",
    title: <>Describe → Sign → Walk away.</>,
    body: (
      <div className="slide-cols">
        <div><div className="slide-col-h">Describe</div><p>A trigger, an action, and limits in one sentence.</p></div>
        <div><div className="slide-col-h">Compile &amp; sign</div><p>The master compiles caveats, caps, TTL, HITL. You sign once.</p></div>
        <div><div className="slide-col-h">Walk away</div><p>Sub-agents spawn on demand; high-stakes actions pause for you.</p></div>
      </div>
    ),
  },
  {
    kicker: "04 · Why now",
    title: <>The rails just landed.</>,
    body: <p className="slide-lede">MetaMask Smart Accounts, ERC-7710/7715 redelegation, and x402 stablecoin payments are all production-ready in 2026. Frost is the first product to compose them into a safe, autonomous operator.</p>,
  },
  {
    kicker: "05 · Stack",
    title: <>Built on proven infra.</>,
    body: (
      <div className="caveats slide-chips">
        {[["IDENTITY", "MetaMask Smart Accounts"], ["AUTHORITY", "ERC-7710"], ["SETTLEMENT", "x402 · USDC"], ["INFERENCE", "Venice AI"], ["EXECUTION", "1Shot API"], ["AUDIT", "On-chain Merkle"]].map(([k, v]) => (
          <span className="chip" key={k}><span className="k">{k}</span><b>{v}</b></span>
        ))}
      </div>
    ),
  },
  {
    kicker: "06 · Traction",
    title: <>Hackathon → product.</>,
    body: <p className="slide-lede">Targeting the MetaMask Smart Accounts × 1Shot Dev Cook-Off (submission June 15 2026), across the Best x402 + ERC-7710, A2A Coordination, Best Agent, and Best Venice AI tracks. Placeholder — replace with live metrics post-deploy.</p>,
  },
  {
    kicker: "07 · Ask",
    title: <>Let&apos;s talk.</>,
    body: <p className="slide-lede">We&apos;re raising / partnering to take Frost from Base Sepolia to mainnet. <span className="slide-accent">hello@frost.example</span></p>,
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
