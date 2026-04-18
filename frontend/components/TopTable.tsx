// components/TopTable.tsx
import { useState, useMemo } from "react";
import Link from "next/link";
import type { TopRow } from "../lib/api";

type SortKey = keyof TopRow;

const BIAS_COLORS: Record<string, string> = {
  haussier: "var(--bull)",
  baissier: "var(--bear)",
  neutre: "var(--neutral)",
};

const BIAS_BG: Record<string, string> = {
  haussier: "rgba(0,229,180,0.08)",
  baissier: "rgba(255,77,109,0.08)",
  neutre: "rgba(122,128,152,0.08)",
};

function ConfBar({ value }: { value: number }) {
  const color = value >= 70 ? "var(--bull)" : value >= 40 ? "var(--warn)" : "var(--muted)";
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-1 rounded-full overflow-hidden" style={{ background: "var(--border)" }}>
        <div
          className="h-full rounded-full transition-all"
          style={{ width: `${value}%`, background: color }}
        />
      </div>
      <span className="font-mono text-xs w-7 text-right" style={{ color }}>
        {value}
      </span>
    </div>
  );
}

const COLS: { key: SortKey; label: string; right?: boolean }[] = [
  { key: "symbol", label: "SYMB" },
  { key: "name", label: "NOM" },
  { key: "price", label: "PRIX", right: true },
  { key: "change_pct", label: "VAR%", right: true },
  { key: "volume", label: "VOL.", right: true },
  { key: "realized_vol", label: "VOL.RÉAL.", right: true },
  { key: "vol_volume_score", label: "SCORE", right: true },
  { key: "bias", label: "BIAIS" },
  { key: "confidence", label: "CONFIANCE" },
];

export default function TopTable({ rows }: { rows: TopRow[] }) {
  const [sortKey, setSortKey] = useState<SortKey>("vol_volume_score");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  const sorted = useMemo(() => {
    return [...rows].sort((a, b) => {
      const va = a[sortKey];
      const vb = b[sortKey];
      const cmp = typeof va === "string" ? va.localeCompare(vb as string) : (va as number) - (vb as number);
      return sortDir === "asc" ? cmp : -cmp;
    });
  }, [rows, sortKey, sortDir]);

  function handleSort(key: SortKey) {
    if (key === sortKey) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("desc");
    }
  }

  return (
    <div className="overflow-x-auto rounded-lg border" style={{ borderColor: "var(--border)" }}>
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b" style={{ background: "var(--surface)", borderColor: "var(--border)" }}>
            <th className="px-3 py-2 font-mono text-xs text-left" style={{ color: "var(--muted)" }}>
              #
            </th>
            {COLS.map((c) => (
              <th
                key={c.key}
                onClick={() => handleSort(c.key)}
                className={`px-3 py-2 font-mono text-xs cursor-pointer select-none transition-colors hover:text-accent ${c.right ? "text-right" : "text-left"}`}
                style={{
                  color: sortKey === c.key ? "var(--accent)" : "var(--muted)",
                }}
              >
                {c.label}
                {sortKey === c.key && (
                  <span className="ml-1">{sortDir === "desc" ? "↓" : "↑"}</span>
                )}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sorted.map((row, idx) => (
            <tr
              key={row.symbol}
              className="table-row-hover border-b transition-colors"
              style={{ borderColor: "var(--border)" }}
            >
              <td className="px-3 py-2 font-mono text-xs" style={{ color: "var(--muted)" }}>
                {idx + 1}
              </td>
              <td className="px-3 py-2">
                <Link
                  href={`/index/${row.symbol}`}
                  className="font-mono font-semibold text-sm hover:underline"
                  style={{ color: "var(--accent)" }}
                >
                  {row.symbol}
                </Link>
              </td>
              <td className="px-3 py-2 text-xs" style={{ color: "#c8cfe0", maxWidth: 200 }}>
                <span className="truncate block">{row.name}</span>
              </td>
              <td className="px-3 py-2 font-mono text-xs text-right" style={{ color: "#c8cfe0" }}>
                {row.price.toFixed(2)}
              </td>
              <td className="px-3 py-2 font-mono text-xs text-right">
                <span style={{ color: row.change_pct >= 0 ? "var(--bull)" : "var(--bear)" }}>
                  {row.change_pct >= 0 ? "+" : ""}{row.change_pct.toFixed(2)}%
                </span>
              </td>
              <td className="px-3 py-2 font-mono text-xs text-right" style={{ color: "var(--neutral)" }}>
                {formatVolume(row.volume)}
              </td>
              <td className="px-3 py-2 font-mono text-xs text-right" style={{ color: "var(--neutral)" }}>
                {(row.realized_vol * 100).toFixed(3)}%
              </td>
              <td className="px-3 py-2 font-mono text-xs text-right font-semibold" style={{ color: "var(--accent)" }}>
                {row.vol_volume_score.toFixed(3)}
              </td>
              <td className="px-3 py-2">
                <span
                  className="px-2 py-0.5 rounded font-mono text-xs font-medium"
                  style={{
                    color: BIAS_COLORS[row.bias] || "var(--neutral)",
                    background: BIAS_BG[row.bias] || "transparent",
                  }}
                >
                  {row.bias.toUpperCase()}
                </span>
              </td>
              <td className="px-3 py-2 w-32">
                <ConfBar value={row.confidence} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function formatVolume(v: number): string {
  if (v >= 1e9) return `${(v / 1e9).toFixed(1)}B`;
  if (v >= 1e6) return `${(v / 1e6).toFixed(1)}M`;
  if (v >= 1e3) return `${(v / 1e3).toFixed(1)}K`;
  return v.toFixed(0);
}
