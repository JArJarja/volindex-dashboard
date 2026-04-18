// components/FilterBar.tsx
interface FilterBarProps {
  resolution: string;
  window: number;
  onResolutionChange: (r: string) => void;
  onWindowChange: (w: number) => void;
  loading?: boolean;
  wsConnected?: boolean;
}

const RESOLUTIONS = ["1", "5", "15", "30", "60"];
const WINDOWS = [15, 30, 60, 120, 240];

function Pill({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className="px-3 py-1 rounded font-mono text-xs transition-all"
      style={{
        background: active ? "var(--accent)" : "var(--surface)",
        color: active ? "var(--bg)" : "var(--neutral)",
        border: `1px solid ${active ? "var(--accent)" : "var(--border)"}`,
        fontWeight: active ? 600 : 400,
      }}
    >
      {children}
    </button>
  );
}

export default function FilterBar({
  resolution,
  window: win,
  onResolutionChange,
  onWindowChange,
  loading,
  wsConnected,
}: FilterBarProps) {
  return (
    <div
      className="flex flex-wrap items-center gap-4 rounded-lg border px-4 py-3"
      style={{ background: "var(--surface)", borderColor: "var(--border)" }}
    >
      {/* Résolution */}
      <div className="flex items-center gap-2">
        <span className="font-mono text-xs uppercase tracking-widest" style={{ color: "var(--muted)" }}>
          Résolution
        </span>
        <div className="flex gap-1">
          {RESOLUTIONS.map((r) => (
            <Pill key={r} active={resolution === r} onClick={() => onResolutionChange(r)}>
              {r}min
            </Pill>
          ))}
        </div>
      </div>

      <div className="h-4 w-px" style={{ background: "var(--border)" }} />

      {/* Fenêtre */}
      <div className="flex items-center gap-2">
        <span className="font-mono text-xs uppercase tracking-widest" style={{ color: "var(--muted)" }}>
          Fenêtre
        </span>
        <div className="flex gap-1">
          {WINDOWS.map((w) => (
            <Pill key={w} active={win === w} onClick={() => onWindowChange(w)}>
              {w}min
            </Pill>
          ))}
        </div>
      </div>

      {/* Status */}
      <div className="ml-auto flex items-center gap-3">
        {loading && (
          <span className="font-mono text-xs" style={{ color: "var(--muted)" }}>
            Chargement…
          </span>
        )}
        <div className="flex items-center gap-1.5">
          <span
            className="w-1.5 h-1.5 rounded-full"
            style={{
              background: wsConnected ? "var(--bull)" : "var(--muted)",
              boxShadow: wsConnected ? "0 0 6px var(--bull)" : "none",
            }}
          />
          <span className="font-mono text-xs" style={{ color: wsConnected ? "var(--bull)" : "var(--muted)" }}>
            {wsConnected ? "LIVE" : "OFFLINE"}
          </span>
        </div>
      </div>
    </div>
  );
}
