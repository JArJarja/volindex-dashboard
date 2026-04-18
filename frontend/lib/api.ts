// lib/api.ts
const API_BASE = process.env.NEXT_PUBLIC_BACKEND_URL || process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";
export interface TopRow {
  symbol: string;
  name: string;
  price: number;
  change_pct: number;
  volume: number;
  realized_vol: number;
  vol_volume_score: number;
  bias: "haussier" | "baissier" | "neutre";
  confidence: number;
  updated_at: string;
}
export interface Candle {
  t: number; o: number; h: number; l: number; c: number; v: number;
}
export interface Indicators {
  ma20?: number; ema20?: number; rsi14?: number; atr14?: number;
  macd?: { line: number; signal: number; hist: number };
}
export interface Diagnostic {
  trend: string; momentum: string; volatility: string;
  supports: number[]; resistances: number[]; scenarios: string[];
}
export interface Detail {
  symbol: string; name: string; price: number; change_pct: number;
  candles: Candle[]; indicators: Indicators; diagnostic: Diagnostic;
  updated_at: string;
}
export interface Report {
  generated_at: string; window_minutes: number; market_summary: string;
  top_movers: TopRow[]; top_vol_volume: TopRow[];
  anomalies: string[]; risks: string[];
}
export async function fetchTop(window = 60, resolution = "1", limit = 30): Promise<TopRow[]> {
  const r = await fetch(`${API_BASE}/api/top?window=${window}&resolution=${resolution}&limit=${limit}`);
  if (!r.ok) throw new Error(`API error ${r.status}`);
  return r.json();
}
export async function fetchDetail(symbol: string, window = 60, resolution = "5"): Promise<Detail> {
  const r = await fetch(`${API_BASE}/api/index/${symbol}?window=${window}&resolution=${resolution}`);
  if (!r.ok) throw new Error(`API error ${r.status}`);
  return r.json();
}
export async function fetchReport(window = 60): Promise<Report> {
  const r = await fetch(`${API_BASE}/api/report/latest?window=${window}`);
  if (!r.ok) throw new Error(`API error ${r.status}`);
  return r.json();
}
