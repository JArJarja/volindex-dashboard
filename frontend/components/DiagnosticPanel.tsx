// components/DiagnosticPanel.tsx
import type { Diagnostic, Indicators } from "../lib/api";

const BIAS_COLORS: Record<string, string> = {
  haussier: "var(--bull)",
  baissier: "var(--bear)",
  neutre: "var(--neutral)",
  suracheté: "var(--bear)",
  survendu: "var(--bull)",
  élevée: "var(--warn)",
  "très élevée": "var(--bear)",
  modérée: "var(--neutral)",
  faible: "var(--muted)",
};

function Badge({ label }: { label: string }) {
  const color = BIAS_COLORS[label] || "var(--neutral)";
  return (
    <span
      className="px-2 py-0.5 rounded font-mono text-xs font-semibold uppercase"
      style={{ color, background: `${color}18`, border: `1px solid ${color}40` }}
    >
      {label}
    </span>
  );
}

function Metric({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="font-mono text-xs" style={{ color: "var(--muted)" }}>{label}</span>
      <span className="font-mono text-sm font-semibold" style={{ color: color || "#c8cfe0" }}>
        {value}
      </span>
    </div>
  );
}

function RSIBar({ value }: { value: number }) {
  const color =
    value > 70 ? "var(--bear)" : value < 30 ? "var(--bull)" : "var(--neutral)";
  return (
    <div className="mt-1">
      <div className="relative h-2 rounded-full overflow-hidden" style={{ background: "var(--border)" }}>
        {/* Zone zones */}
        <div className="absolute top-0 left-0 h-full w-[30%]" style={{ background: "rgba(0,229,180,0.15)" }} />
        <div className="absolute top-0 right-0 h-full w-[30%]" style={{ background: "rgba(255,77,109,0.15)" }} />
        {/* Cursor */}
        <div
          className="absolute top-0 h-full w-1 rounded-full"
          style={{ left: `${value}%`, background: color, transform: "translateX(-50%)" }}
        />
      </div>
      <div className="flex justify-between mt-0.5 font-mono text-xs" style={{ color: "var(--muted)" }}>
        <span>0</span>
        <span style={{ color }}>RSI {value.toFixed(1)}</span>
        <span>100</span>
      </div>
    </div>
  );
}

interface Props {
  diagnostic: Diagnostic;
  indicators: Indicators;
}

export default function DiagnosticPanel({ diagnostic, indicators }: Props) {
  return (
    <div className="flex flex-col gap-5">
      {/* Tendance / Momentum / Volatilité */}
      <div
        className="rounded-lg border p-4 grid grid-cols-3 gap-6"
        style={{ background: "var(--surface)", borderColor: "var(--border)" }}
      >
        <div className="flex flex-col gap-1">
          <span className="font-mono text-xs uppercase tracking-widest" style={{ color: "var(--muted)" }}>
            Tendance
          </span>
          <Badge label={diagnostic.trend} />
        </div>
        <div className="flex flex-col gap-1">
          <span className="font-mono text-xs uppercase tracking-widest" style={{ color: "var(--muted)" }}>
            Momentum
          </span>
          <Badge label={diagnostic.momentum} />
        </div>
        <div className="flex flex-col gap-1">
          <span className="font-mono text-xs uppercase tracking-widest" style={{ color: "var(--muted)" }}>
            Volatilité
          </span>
          <Badge label={diagnostic.volatility} />
        </div>
      </div>

      {/* Indicateurs numériques */}
      <div
        className="rounded-lg border p-4 grid grid-cols-2 sm:grid-cols-4 gap-6"
        style={{ background: "var(--surface)", borderColor: "var(--border)" }}
      >
        <Metric
          label="MA 20"
          value={indicators.ma20 != null ? indicators.ma20.toFixed(3) : "—"}
          color="var(--warn)"
        />
        <Metric
          label="EMA 20"
          value={indicators.ema20 != null ? indicators.ema20.toFixed(3) : "—"}
          color="#a78bfa"
        />
        <Metric
          label="ATR 14"
          value={indicators.atr14 != null ? indicators.atr14.toFixed(3) : "—"}
          color="var(--warn)"
        />
        {indicators.macd && (
          <div className="flex flex-col gap-0.5">
            <span className="font-mono text-xs" style={{ color: "var(--muted)" }}>MACD</span>
            <span className="font-mono text-xs" style={{ color: indicators.macd.hist >= 0 ? "var(--bull)" : "var(--bear)" }}>
              Histo {indicators.macd.hist >= 0 ? "+" : ""}{indicators.macd.hist.toFixed(4)}
            </span>
            <span className="font-mono text-xs" style={{ color: "var(--neutral)" }}>
              Ligne {indicators.macd.line.toFixed(4)}
            </span>
          </div>
        )}
      </div>

      {/* RSI */}
      {indicators.rsi14 != null && (
        <div
          className="rounded-lg border p-4"
          style={{ background: "var(--surface)", borderColor: "var(--border)" }}
        >
          <span className="font-mono text-xs uppercase tracking-widest" style={{ color: "var(--muted)" }}>
            RSI 14
          </span>
          <RSIBar value={indicators.rsi14} />
        </div>
      )}

      {/* Supports / Résistances */}
      {(diagnostic.supports.length > 0 || diagnostic.resistances.length > 0) && (
        <div
          className="rounded-lg border p-4 grid grid-cols-2 gap-6"
          style={{ background: "var(--surface)", borderColor: "var(--border)" }}
        >
          <div>
            <p className="font-mono text-xs uppercase tracking-widest mb-2" style={{ color: "var(--muted)" }}>
              Supports détectés
            </p>
            <div className="flex flex-col gap-1">
              {diagnostic.supports.length > 0 ? (
                diagnostic.supports.map((s, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <div className="w-1.5 h-1.5 rounded-full" style={{ background: "var(--bull)" }} />
                    <span className="font-mono text-sm" style={{ color: "var(--bull)" }}>
                      {s.toFixed(2)}
                    </span>
                  </div>
                ))
              ) : (
                <span className="font-mono text-xs" style={{ color: "var(--muted)" }}>Aucun détecté</span>
              )}
            </div>
          </div>
          <div>
            <p className="font-mono text-xs uppercase tracking-widest mb-2" style={{ color: "var(--muted)" }}>
              Résistances détectées
            </p>
            <div className="flex flex-col gap-1">
              {diagnostic.resistances.length > 0 ? (
                diagnostic.resistances.map((r, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <div className="w-1.5 h-1.5 rounded-full" style={{ background: "var(--bear)" }} />
                    <span className="font-mono text-sm" style={{ color: "var(--bear)" }}>
                      {r.toFixed(2)}
                    </span>
                  </div>
                ))
              ) : (
                <span className="font-mono text-xs" style={{ color: "var(--muted)" }}>Aucune détectée</span>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Scénarios à surveiller */}
      {diagnostic.scenarios.length > 0 && (
        <div
          className="rounded-lg border p-4"
          style={{ background: "var(--surface)", borderColor: "var(--border)" }}
        >
          <p className="font-mono text-xs uppercase tracking-widest mb-3" style={{ color: "var(--muted)" }}>
            Scénarios à surveiller
          </p>
          <ul className="flex flex-col gap-2">
            {diagnostic.scenarios.map((s, i) => (
              <li key={i} className="flex gap-2 items-start">
                <span className="mt-0.5 shrink-0 font-mono text-xs" style={{ color: "var(--accent)" }}>→</span>
                <span className="text-xs leading-relaxed" style={{ color: "#c8cfe0" }}>{s}</span>
              </li>
            ))}
          </ul>
          <p className="mt-3 text-xs" style={{ color: "var(--muted)" }}>
            Ces scénarios sont purement informatifs et ne constituent pas des signaux d'action.
          </p>
        </div>
      )}
    </div>
  );
}
