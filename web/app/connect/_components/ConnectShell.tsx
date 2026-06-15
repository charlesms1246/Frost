// Shared chrome for the /connect bridge pages. These are focused, single-task
// callback screens reached from the Tauri app — so no site navbar, just a
// centered Frost wordmark and a vertically-centered content column that fits in
// one viewport. Presentation only; each page keeps its MetaMask / viem logic.

import Link from "next/link";
import type { ReactNode } from "react";

export default function ConnectShell({
  eyebrow,
  title,
  subtitle,
  children,
}: {
  eyebrow: string;
  title: string;
  subtitle?: ReactNode;
  children: ReactNode;
}) {
  return (
    <>
      <div className="grid-bg" aria-hidden="true" />
      <div className="shell connect-shell">
        <Link className="connect-logo" href="/">
          FROST
        </Link>
        <main className="connect-main">
          <div className="connect-eyebrow">{eyebrow}</div>
          <h1 className="connect-h1">{title}</h1>
          {subtitle && <p className="connect-sub">{subtitle}</p>}
          {children}
        </main>
      </div>
    </>
  );
}
