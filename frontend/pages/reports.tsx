// pages/reports.tsx
import { useState, useEffect } from "react";
import Head from "next/head";
import Link from "next/link";
import { fetchReport, Report } from "../lib/api";

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div
      className="rounded-lg border p-5"
      style={{ background: "var(--surface)", borderColor: "var(--border)" }}
    >
      <p className="font-mono text-xs uppercase tracking-widest mb-4" style={{ color: "var(--muted)" }}>
        {title}
      </p>
      {children}
    </div>
  );
}

export default function ReportsPage() {
  const [report, setReport] = useState<Report | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [window, setWindow] = useState(60);

  async function load(win: number) {
    setLoading(true);
    setError("");
    try {
      const r = await fetchReport(win);
      setReport(r);
    } catch (e: any) {
      setError(e.message || "Erreur chargement");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(window); }, [window]);

  const exportJson = () =>
    window && (location.href = `${API_BASE}/api/report/export/json?window=${window}`);
  const exportCsv = () =>
    window && (location.href = `${API_BASE}/api/report/export/csv?window=${window}`);

  return (
    <>
      <Head>
        <title>VOLINDEX · Rapports</title>
      </Head>

      <div className="flex flex-col gap-5">
        {/* Header */}
        <div className="flex items-end justify-between flex-wrap gap-3">
          <div>
            <h1 className="font-mono font-semibold text-xl tracking-tight" style={{ color: "var(--accent)" }}>
              RAPPORTS
            </h1>
            <p className="font-mono text-xs mt-0.5" style={{ color: "var(--muted)" }}>
              {report && `Généré le ${new Date(report.generated_at).toLocaleString("fr-FR")}`}
            </p>
          </div>
          <div className="flex gap-2">
            <button
              onClick={exportJson}
              className="px-3 py-1.5 rounded border font-mono text-xs transition-all hover:border-accent"
              style={{ borderColor: "var(--border)", color: "var(--neutral)" }}
            >
              ↓ JSON
            </button>
            <button
              onClick={exportCsv}
              className="px-3 py-1.5 rounded border font-mono text-xs transition-all hover:border-accent"
              style={{ borderColor: "var(--border)", color: "var(--neutral)" }}
            >
              ↓ CSV
            </button>
          </div>
        </div>

        {/* Fenêtre */}
        <div className="flex gap-2 items-center">
          <span className="font-mono text-xs" style={{ color: "var(--muted)" }}>Fenêtre :</span>
          {[15, 30, 60, 120, 240].map((w) => (
            <button
              key={w}
              onClick={() => setWindow(w)}
              className="px-3 py-1 rounded font-mono text-xs transition-all"
              style={{
                background: window === w ? "var(--accent)" : "var(--surface)",
                color: window === w ? "var(--bg)" : "var(--neutral)",
                border: `1px solid ${window === w ? "var(--accent)" : "var(--border)"}`,
                fontWeight: window === w ? 600 : 400,
              }}
            >
              {w}min
            </button>
          ))}
        </div>

        {error && (
          <div
            className="rounded-lg border px-4 py-3 font-mono text-sm"
            style={{ borderColor: "var(--bear)", background: "rgba(255,77,109,0.08)", color: "var(--bear)" }}
          >
            ⚠ {error}
          </div>
        )}

        {loading && !report && (
          <div className="flex items-center justify-center h-64">
            <div
              className="w-8 h-8 rounded-full border-2 animate-spin"
              style={{ borderColor: "var(--accent)", borderTopColor: "transparent" }}
            />
          </div>
        )}

        {report && (
          <>
            {/* Résumé marché */}
            <Section title="Résumé Marché">
              <p className="text-sm leading-relaxed" style={{ color: "#c8cfe0" }}>
                {report.market_summary}
              </p>
            </Section>

            {/* Top mouvements */}
            <Section title="Top Mouvements (Vol/Volume)">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b" style={{ borderColor: "var(--border)" }}>
                      {["#", "Symbole", "Nom", "Prix", "Var%", "Score", "Biais"].map((h) => (
                        <th key={h} className="px-3 py-1.5 font-mono text-xs text-left" style={{ color: "var(--muted)" }}>
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {report.top_vol_volume.map((r, i) => (
                      <tr key={r.symbol} className="border-b table-row-hover" style={{ borderColor: "var(--border)" }}>
                        <td className="px-3 py-2 font-mono text-xs" style={{ color: "var(--muted)" }}>{i + 1}</td>
                        <td className="px-3 py-2">
                          <Link
                            href={`/index/${r.symbol}`}
                            className="font-mono text-sm font-semibold hover:underline"
                            style={{ color: "var(--accent)" }}
                          >
                            {r.symbol}
                          </Link>
                        </td>
                        <td className="px-3 py-2 text-xs" style={{ color: "var(--neutral)", maxWidth: 180 }}>
                          <span className="truncate block">{r.name}</span>
                        </td>
                        <td className="px-3 py-2 font-mono text-xs">{r.price.toFixed(2)}</td>
                        <td
                          className="px-3 py-2 font-mono text-xs"
                          style={{ color: r.change_pct >= 0 ? "var(--bull)" : "var(--bear)" }}
                        >
                          {r.change_pct >= 0 ? "+" : ""}{r.change_pct.toFixed(2)}%
                        </td>
                        <td className="px-3 py-2 font-mono text-xs font-semibold" style={{ color: "var(--accent)" }}>
                          {r.vol_volume_score.toFixed(3)}
                        </td>
                        <td className="px-3 py-2">
                          <span
                            className="px-2 py-0.5 rounded font-mono text-xs uppercase"
                            style={{
                              color:
                                r.bias === "haussier"
                                  ? "var(--bull)"
                                  : r.bias === "baissier"
                                  ? "var(--bear)"
                                  : "var(--neutral)",
                            }}
                          >
                            {r.bias}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Section>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
              {/* Anomalies */}
              <Section title="Anomalies Détectées">
                {report.anomalies.length > 0 ? (
                  <ul className="flex flex-col gap-2">
                    {report.anomalies.map((a, i) => (
                      <li key={i} className="flex gap-2 items-start text-xs" style={{ color: "#c8cfe0" }}>
                        <span style={{ color: "var(--warn)" }}>⚡</span>
                        {a}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="font-mono text-xs" style={{ color: "var(--muted)" }}>Aucune anomalie détectée</p>
                )}
              </Section>

              {/* Risques */}
              <Section title="Signaux de Risque Volatilité">
                {report.risks.length > 0 ? (
                  <ul className="flex flex-col gap-2">
                    {report.risks.map((r, i) => (
                      <li key={i} className="flex gap-2 items-start text-xs" style={{ color: "#c8cfe0" }}>
                        <span style={{ color: "var(--bear)" }}>▲</span>
                        {r}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="font-mono text-xs" style={{ color: "var(--muted)" }}>Aucun signal de risque détecté</p>
                )}
              </Section>
            </div>

            {/* Traçabilité */}
            <div
              className="rounded-lg border px-4 py-3"
              style={{ borderColor: "var(--border)", background: "var(--surface)" }}
            >
              <p className="font-mono text-xs" style={{ color: "var(--muted)" }}>
                Traçabilité · Généré : {new Date(report.generated_at).toISOString()} · Fenêtre : {report.window_minutes}min ·
                Source : Finnhub API REST · Calculs locaux (non annualisé) · Aucun conseil en investissement.
              </p>
            </div>
          </>
        )}
      </div>
    </>
  );
}
