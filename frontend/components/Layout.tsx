import Link from "next/link";
import { useRouter } from "next/router";
import { ReactNode } from "react";

export default function Layout({ children }: { children: ReactNode }) {
  const router = useRouter();
  const navLinks = [
    { href: "/", label: "TOP 30" },
    { href: "/reports", label: "RAPPORTS" },
  ];

  return (
    <div className="min-h-screen flex flex-col">
      {/* Header */}
      <header className="sticky top-0 z-50 border-b" style={{ background: "var(--bg)", borderColor: "var(--border)" }}>
        <div className="max-w-[1600px] mx-auto px-4 h-12 flex items-center gap-8">
          {/* Logo */}
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full pulse-dot" style={{ background: "var(--accent)" }} />
            <span className="font-mono font-semibold text-sm tracking-widest" style={{ color: "var(--accent)" }}>
              VOLINDEX
            </span>
          </div>

          {/* Nav */}
          <nav className="flex gap-6">
            {navLinks.map((l) => (
              <Link
                key={l.href}
                href={l.href}
                className="font-mono text-xs tracking-widest transition-colors"
                style={{
                  color: router.pathname === l.href ? "var(--accent)" : "var(--neutral)",
                }}
              >
                {l.label}
              </Link>
            ))}
          </nav>

          <div className="ml-auto font-mono text-xs" style={{ color: "var(--muted)" }}>
            FINNHUB · LIVE
          </div>
        </div>
      </header>

      {/* Disclaimer */}
      <div className="border-b py-1.5 px-4" style={{ background: "#0a0c10", borderColor: "var(--border)" }}>
        <p className="max-w-[1600px] mx-auto text-center font-mono text-xs" style={{ color: "var(--muted)" }}>
          ⚠ Outil d&apos;analyse de marché à vocation informative et pédagogique. Ne constitue pas un conseil en
          investissement. Aucune recommandation d&apos;achat/vente.
        </p>
      </div>

      {/* Main */}
      <main className="flex-1 max-w-[1600px] mx-auto w-full px-4 py-6">{children}</main>

      {/* Footer */}
      <footer className="border-t py-3 px-4" style={{ borderColor: "var(--border)" }}>
        <p className="max-w-[1600px] mx-auto font-mono text-xs text-center" style={{ color: "var(--muted)" }}>
          Données Finnhub API · Scores calculés localement · Latence variable selon quota API
        </p>
      </footer>
    </div>
  );
}
