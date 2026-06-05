// Consistent marketing-site navbar (landing, download, docs, architecture,
// pitch). Wordmark only — no snowflake icon. Sticky glass bar.

import Link from "next/link";

const LINKS = [
  { href: "/", label: "Product", key: "product" },
  { href: "/architecture", label: "Architecture", key: "architecture" },
  { href: "/docs", label: "Docs", key: "docs" },
  { href: "/pitch", label: "Pitch", key: "pitch" },
] as const;

export default function SiteNav({ active }: { active?: string }) {
  return (
    <nav className="bar">
      <Link className="brand" href="/">
        FROST
        <small>BY PORT 42</small>
      </Link>
      <div className="nav-links">
        {LINKS.map((l) => (
          <Link key={l.key} href={l.href} aria-current={active === l.key ? "page" : undefined}>
            {l.label}
          </Link>
        ))}
      </div>
      <div className="nav-cta-wrap">
        <Link className="cta" href="/download" aria-current={active === "download" ? "page" : undefined}>
          <svg width="13" height="13" viewBox="0 0 13 13" fill="none" aria-hidden="true">
            <path d="M6.5 1v8M3 6.5l3.5 3.5 3.5-3.5M1.5 11.5h10" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          Download
        </Link>
      </div>
    </nav>
  );
}
