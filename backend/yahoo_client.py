# yahoo_client.py
"""
Client Yahoo Finance non-officiel.
Pas de clé API requise. Données earnings et dividendes gratuites.
"""
import asyncio, time, math
import httpx
from cache import TTLCache

YF_BASE = "https://query1.finance.yahoo.com/v8/finance"
YF_BASE2 = "https://query2.finance.yahoo.com/v10/finance"

# Mapping symboles → Yahoo tickers
YF_MAP = {
    "OR.PA": "OR.PA", "MC.PA": "MC.PA", "TTE.PA": "TTE.PA",
    "SAN.PA": "SAN.PA", "AIR.PA": "AIR.PA", "BNP.PA": "BNP.PA",
    "SU.PA": "SU.PA", "HO.PA": "HO.PA", "SAF.PA": "SAF.PA",
    "AI.PA": "AI.PA", "DG.PA": "DG.PA", "RI.PA": "RI.PA",
    "CAP.PA": "CAP.PA", "BN.PA": "BN.PA", "DSY.PA": "DSY.PA",
    "CS.PA": "CS.PA", "GLE.PA": "GLE.PA", "RMS.PA": "RMS.PA",
    "EL.PA": "EL.PA", "KER.PA": "KER.PA",
}

def sf(v, d=0.0):
    try:
        f = float(v)
        return f if math.isfinite(f) else d
    except: return d

class YahooClient:
    def __init__(self, cache: TTLCache):
        self.cache = cache
        self._client = httpx.AsyncClient(
            timeout=15,
            headers={
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
                "Accept": "application/json",
            }
        )
        self._last_call = 0.0

    def _yf_sym(self, symbol: str) -> str:
        return YF_MAP.get(symbol, symbol)

    async def _get(self, url: str, params: dict = {}, ttl: int = 3600):
        ck = f"yf:{url}:{sorted(params.items())}"
        if c := self.cache.get(ck): return c
        elapsed = time.monotonic() - self._last_call
        if elapsed < 1.0:
            await asyncio.sleep(1.0 - elapsed)
        self._last_call = time.monotonic()
        try:
            r = await self._client.get(url, params=params)
            if r.status_code == 429:
                await asyncio.sleep(5)
                r = await self._client.get(url, params=params)
            r.raise_for_status()
            data = r.json()
            self.cache.set(ck, data, ttl=ttl)
            return data
        except Exception as e:
            print(f"[Yahoo] {url}: {e}")
            return None

    async def get_earnings(self, symbol: str) -> list[dict]:
        """Résultats trimestriels Yahoo Finance — Q1 2025 et au-dela."""
        sym = self._yf_sym(symbol)
        url = f"https://query1.finance.yahoo.com/v10/finance/quoteSummary/{sym}"
        data = await self._get(url, {
            "modules": "earningsHistory,earningsTrend,financialData",
            "formatted": "false",
        }, ttl=1800)

        results = []

        # 1. Estimations futures (prochain trimestre et annee)
        try:
            qs = data["quoteSummary"]["result"][0]
            trend = qs.get("earningsTrend", {}).get("trend", [])
            for t in trend:
                period = t.get("period", "")
                if period in ["+1q", "0q", "+1y", "0y"]:
                    end_date = t.get("endDate", {}).get("fmt", "")
                    eps_est = sf(t.get("earningsEstimate", {}).get("avg", {}).get("raw"))
                    rev_est = sf(t.get("revenueEstimate", {}).get("avg", {}).get("raw"))
                    eps_low = sf(t.get("earningsEstimate", {}).get("low", {}).get("raw"))
                    eps_high = sf(t.get("earningsEstimate", {}).get("high", {}).get("raw"))
                    nb_analysts = t.get("earningsEstimate", {}).get("numberOfAnalysts", {}).get("raw", 0)
                    label = {"0q": "Trimestre en cours", "+1q": "Prochain trimestre",
                             "0y": "Annee en cours", "+1y": "Annee prochaine"}.get(period, period)
                    if eps_est or rev_est:
                        results.append({
                            "date":          end_date,
                            "period":        label,
                            "eps_actual":    0.0,
                            "eps_estimate":  eps_est,
                            "eps_low":       eps_low,
                            "eps_high":      eps_high,
                            "nb_analysts":   nb_analysts,
                            "surprise_pct":  0.0,
                            "rev_actual":    0.0,
                            "rev_estimate":  rev_est,
                            "beat_eps":      None,
                            "beat_rev":      None,
                            "is_future":     True,
                            "source":        "Yahoo Finance",
                        })
        except Exception as e:
            print(f"[Yahoo trend] {symbol}: {e}")

        # 2. Historique publie (4 derniers trimestres dans earningsHistory)
        try:
            qs = data["quoteSummary"]["result"][0]
            hist = qs.get("earningsHistory", {}).get("history", [])
            # Trier par date decroissante
            hist_sorted = sorted(hist, key=lambda x: x.get("quarter", {}).get("raw", 0), reverse=True)
            for e in hist_sorted:
                ts = e.get("quarter", {}).get("raw", 0)
                date_str = time.strftime("%Y-%m-%d", time.gmtime(ts)) if ts else ""
                fmt_date = e.get("quarter", {}).get("fmt", date_str)
                eps_act = sf(e.get("epsActual", {}).get("raw"))
                eps_est = sf(e.get("epsEstimate", {}).get("raw"))
                surprise_raw = sf(e.get("surprisePercent", {}).get("raw"))
                surprise_pct = round(surprise_raw * 100, 2) if surprise_raw else 0.0
                results.append({
                    "date":          date_str,
                    "period":        fmt_date,
                    "eps_actual":    eps_act,
                    "eps_estimate":  eps_est,
                    "eps_low":       0.0,
                    "eps_high":      0.0,
                    "nb_analysts":   0,
                    "surprise_pct":  surprise_pct,
                    "rev_actual":    0.0,
                    "rev_estimate":  0.0,
                    "beat_eps":      eps_act > eps_est if eps_est and eps_act else None,
                    "beat_rev":      None,
                    "is_future":     False,
                    "source":        "Yahoo Finance",
                })
        except Exception as e:
            print(f"[Yahoo earnings hist] {symbol}: {e}")

        # 3. Completer avec les revenues depuis financialData
        try:
            qs = data["quoteSummary"]["result"][0]
            fd = qs.get("financialData", {})
            rev = sf(fd.get("totalRevenue", {}).get("raw"))
            if rev > 0 and results:
                results[0]["rev_actual"] = rev  # Dernier CA connu
        except: pass

        return results[:20]

    async def get_dividends(self, symbol: str) -> list[dict]:
        """Dividendes depuis Yahoo Finance."""
        sym = self._yf_sym(symbol)
        # Utiliser l'API chart pour récupérer les dividendes
        url = f"https://query1.finance.yahoo.com/v8/finance/chart/{sym}"
        now = int(time.time())
        data = await self._get(url, {
            "period1": now - 3 * 365 * 86400,
            "period2": now,
            "interval": "1d",
            "events": "div",
        }, ttl=3600)

        results = []
        try:
            events = data["chart"]["result"][0].get("events", {})
            divs = events.get("dividends", {})
            for ts, d in sorted(divs.items(), reverse=True)[:12]:
                ex_date = time.strftime("%Y-%m-%d", time.gmtime(int(ts)))
                results.append({
                    "ex_date":  ex_date,
                    "pay_date": "",
                    "amount":   sf(d.get("amount")),
                    "currency": "USD",
                    "frequency": "",
                    "yield_pct": 0.0,
                })
        except Exception as e:
            print(f"[Yahoo dividends] {symbol}: {e}")

        return results
