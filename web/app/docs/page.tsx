import type { Metadata } from "next";
import Link from "next/link";
import SiteNav from "../_components/SiteNav";
import SiteFooter from "../_components/SiteFooter";
import FrostOrb from "../_components/FrostOrb";

export const metadata: Metadata = {
  title: "Docs — Frost",
  description: "How to install Frost, connect MetaMask, author a bounded mandate, and understand the caveat model.",
};

const TOC = [
  ["overview", "Overview"],
  ["install", "Install"],
  ["connect", "Connect your wallet"],
  ["mandate", "Author a mandate"],
  ["caveats", "Caveats & safety"],
  ["bridge", "Bridge routes"],
  ["faq", "FAQ"],
] as const;

export default function DocsPage() {
  return (
    <>
      <div className="grid-bg" aria-hidden="true" />
      <div className="shell home-shell">
        <SiteNav active="docs" />

        <header className="page-head page-head--mark">
          <div className="section-eyebrow">Documentation</div>
          <h1 className="page-title">Run Frost in<br />ten minutes.</h1>
          <p className="page-lede">Everything you need to install the desktop app, connect a MetaMask smart account, and ship your first bounded automation. This is living documentation for the early-access build.</p>
          <FrostOrb className="page-head-orb" />
        </header>

        <div className="docs-layout">
          <aside className="docs-toc">
            <div className="docs-toc-label">On this page</div>
            {TOC.map(([id, label]) => (
              <a key={id} href={`#${id}`}>{label}</a>
            ))}
          </aside>

          <div className="docs-content">
            <section className="doc-section" id="overview">
              <h2 className="doc-h2">Overview</h2>
              <p className="doc-p">Frost is a desktop app that turns a plain-English instruction into a <strong>signed, scoped, revocable</strong> on-chain mandate. A master agent compiles your brief into a structured authority spec; you sign once; at runtime the master dynamically spawns specialist sub-agents inside strictly bounded sub-mandates. Inference is paid per call in USDC over the <strong>x402</strong> rail (no API keys), transactions are submitted through 1Shot&apos;s private mempool, and every decision is committed to an on-chain Merkle root via the <code className="mono">AuditRegistry</code>.</p>
              <div className="doc-callout">New here? Read the <Link className="connect-link" href="/architecture">Architecture</Link> page for how Port-42 fits together — the six contracts are live on Base Sepolia and each links to BaseScan — then come back to install.</div>
            </section>

            <section className="doc-section" id="install">
              <h2 className="doc-h2">Install</h2>
              <p className="doc-p">Grab the build for your platform from the <Link className="connect-link" href="/download">download page</Link>, which links straight to the latest <strong>GitHub Release</strong>. Frost is a Tauri 2 app — about <strong>5 MB</strong> for the macOS <code className="mono">.dmg</code>, Windows <code className="mono">.msi</code>/<code className="mono">.exe</code>, and Linux <code className="mono">.deb</code>/<code className="mono">.rpm</code> (the self-contained Linux <code className="mono">AppImage</code> is ~78 MB) — and runs fully offline after install.</p>
              <ol className="doc-steps">
                <li><span className="doc-step-n">1</span><div><strong>Download &amp; open.</strong> Pick the binary for your platform; each download has a published SHA-256 you can verify against the checksums on the download page.</div></li>
                <li><span className="doc-step-n">2</span><div><strong>Install MetaMask Flask.</strong> Frost needs Flask (or a Snap-capable MetaMask) for ERC-7715 permission grants.</div></li>
                <li><span className="doc-step-n">3</span><div><strong>Add Base Sepolia.</strong> The MVP targets Base Sepolia; Frost will prompt MetaMask to switch/add the chain on first connect.</div></li>
              </ol>
            </section>

            <section className="doc-section" id="connect">
              <h2 className="doc-h2">Connect your wallet</h2>
              <p className="doc-p">Frost talks to your browser MetaMask through a hosted bridge at <code className="mono">/connect</code>. When the app needs a signature or a permission grant, it opens the matching bridge route and waits for the signed result on a local callback. You stay in control: nothing is submitted without an explicit click in MetaMask.</p>
              <p className="doc-p">Your account must be a <strong>MetaMask Smart Account</strong>. Frost never upgrades it for you — switch the account to a smart account inside MetaMask, then retry.</p>
            </section>

            <section className="doc-section" id="mandate">
              <h2 className="doc-h2">Author a mandate</h2>
              <p className="doc-p">Describe the workflow in one sentence — a trigger, an action, and limits:</p>
              <pre className="doc-code">If ETH on Uniswap v3 falls below $2,800, swap to USDC on the best
Base DEX, then post a Discord update. Cap $200, slippage &lt; 30bps,
pause for me above $8k, expire in 48h.</pre>
              <p className="doc-p">Frost compiles that into a structured mandate with explicit caveats, shows you the spec, and asks you to sign once. From then on the master agent acts only within those bounds.</p>
            </section>

            <section className="doc-section" id="caveats">
              <h2 className="doc-h2">Caveats &amp; safety</h2>
              <p className="doc-p">Caveats are the load-bearing safety primitive. Authority can only <strong>narrow</strong> as it flows down the delegation chain — a sub-agent can never hold more power than its parent.</p>
              <div className="caveats" style={{ marginTop: 4 }}>
                {[["CAP", "$200"], ["HITL ≥", "$8k"], ["SLIPPAGE", "30bps"], ["TTL", "48h"], ["SUBS ≤", "12"], ["CHAIN", "Base"]].map(([k, v]) => (
                  <span className="chip" key={k}><span className="k">{k}</span><b>{v}</b></span>
                ))}
              </div>
              <ul className="doc-list">
                <li><strong>HITL threshold</strong> intersects as <code className="mono">max(parent, sub)</code> — sub-mandates can only tighten it.</li>
                <li><strong>Rate limits</strong> use a unified token bucket across x402 settlements and sub-mandate issuance.</li>
                <li><strong>Revocation</strong> is one click — kill any branch, or the master&apos;s spawning authority, mid-flight.</li>
              </ul>
            </section>

            <section className="doc-section" id="bridge">
              <h2 className="doc-h2">Bridge routes</h2>
              <p className="doc-p">The hosted bridge exposes one route per signing action. The Tauri app opens these with a one-time challenge and a local callback port.</p>
              <div className="doc-routes">
                {[
                  ["/connect/login", "Connect a MetaMask Flask account and read its address + chain."],
                  ["/connect/grant-permissions", "Review and approve an ERC-7715 execution permission."],
                  ["/connect/commit", "EIP-712 co-sign of a session&apos;s audit Merkle root."],
                  ["/connect/revoke", "Submit disableDelegation() to revoke a granted permission."],
                  ["/connect/echo", "Round-trip smoke test for the Tauri ↔ browser bridge."],
                ].map(([route, desc]) => (
                  <div className="doc-route" key={route}>
                    <code className="mono">{route}</code>
                    <span dangerouslySetInnerHTML={{ __html: desc }} />
                  </div>
                ))}
              </div>
            </section>

            {/* <section className="doc-section" id="faq">
              <h2 className="doc-h2">FAQ</h2>
              <div className="doc-faq">
                <div><div className="doc-q">Does Frost ever hold my keys?</div><p className="doc-p">No. Your seed phrase and private keys never leave your device. Agents act with narrowly-scoped delegated credentials only.</p></div>
                <div><div className="doc-q">Which chain does it run on?</div><p className="doc-p">Base Sepolia for the early-access MVP. Mainnet Base follows.</p></div>
                <div><div className="doc-q">Do I need API keys for inference?</div><p className="doc-p">No. Inference is billed per call over x402 in USDC — no subscriptions, no keys to manage. Each call settles real USDC on Base through the 1Shot x402 facilitator before the completion is returned.</p></div>
              </div>
            </section> */}
          </div>
        </div>

        <SiteFooter />
      </div>
    </>
  );
}
