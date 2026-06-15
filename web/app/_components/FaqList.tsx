// Accordion FAQ for the landing page. Native <details>/<summary> so it works
// without client JS; the +/- toggle and active highlight are pure CSS.

const FAQS: [string, string][] = [
  [
    "What is Frost?",
    "Frost is a desktop app for bounded web3 automation. You describe a workflow in plain English; a master agent compiles it into a signed, scoped, revocable on-chain mandate and runs it autonomously within the limits you set.",
  ],
  [
    "Does Frost ever hold my keys?",
    "No. Your seed phrase and private keys never leave your device. Agents act only with narrowly-scoped delegated credentials granted through your MetaMask smart account, and you can revoke any branch in one click.",
  ],
  [
    "Do I need API keys for inference?",
    "No. Inference is paid per call in USDC over the x402 protocol — no subscriptions and no keys to manage. Unused budget simply stays in your wallet.",
  ],
  [
    "How do the spending limits work?",
    "Every mandate carries explicit caveats — spend caps, slippage and gas ceilings, a TTL, a sub-agent count, and chain scope. Authority can only narrow as it flows down the delegation chain, so a sub-agent can never out-scope its parent.",
  ],
  [
    "What is human-in-the-loop (HITL)?",
    "You set a value threshold. Any transaction above it pauses the session and fires an OS notification; nothing executes until you approve. Sub-mandates can only lower the threshold, never raise it.",
  ],
  [
    "Which chain does it run on?",
    "Base Sepolia for the early-access build. Transactions are submitted through a private mempool to avoid front-running, and every session's decision tree is anchored as an on-chain Merkle root.",
  ],
];

export default function FaqList() {
  return (
    <section className="faq" aria-label="Frequently asked questions">
      <h2 className="faq-title">
        Frequently Asked<br />Questions
      </h2>
      <div className="faq-list">
        {FAQS.map(([q, a]) => (
          <details className="faq-item" key={q}>
            <summary className="faq-q">
              <span>{q}</span>
              <span className="faq-icon" aria-hidden="true" />
            </summary>
            <p className="faq-a">{a}</p>
          </details>
        ))}
      </div>
    </section>
  );
}
