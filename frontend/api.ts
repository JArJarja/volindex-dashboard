// lib/api.ts
const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

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

export interface PricePoint { t: number; c: number; }

export interface EarningsItem {
  date: string; quarter: string; year: string;
  eps_est: number; eps_act: number;
  rev_est: number; rev_act: number; url: string;
}

export interface DividendItem {
  ex_date: string; pay_date: string; amount: number;
  currency: string; frequency: string; yield_pct: number;
}

function enc(symbol: string): string {
  return encodeURIComponent(symbol);
}

export async function fetchTop(window = 60, resolution = "1", limit = 30): Promise<TopRow[]> {
  const r = await fetch(`${API_BASE}/api/top?window=${window}&resolution=${resolution}&limit=${limit}`);
  if (!r.ok) throw new Error(`API error ${r.status}`);
  return r.json();
}

export async function fetchDetail(symbol: string, window = 60, resolution = "5"): Promise<Detail> {
  const r = await fetch(`${API_BASE}/api/index/${enc(symbol)}?window=${window}&resolution=${resolution}`);
  if (!r.ok) throw new Error(`API error ${r.status}`);
  return r.json();
}

export async function fetchReport(window = 60): Promise<Report> {
  const r = await fetch(`${API_BASE}/api/report/latest?window=${window}`);
  if (!r.ok) throw new Error(`API error ${r.status}`);
  return r.json();
}

export async function fetchHistory48(symbol: string): Promise<PricePoint[]> {
  try {
    const r = await fetch(`${API_BASE}/api/index/${enc(symbol)}/history48`);
    if (!r.ok) return [];
    return r.json();
  } catch { return []; }
}

export async function fetchEarnings(symbol: string): Promise<EarningsItem[]> {
  try {
    const r = await fetch(`${API_BASE}/api/index/${enc(symbol)}/earnings`);
    if (!r.ok) return [];
    return r.json();
  } catch { return []; }
}

export async function fetchDividends(symbol: string): Promise<DividendItem[]> {
  try {
    const r = await fetch(`${API_BASE}/api/index/${enc(symbol)}/dividends`);
    if (!r.ok) return [];
    return r.json();
  } catch { return []; }
}
