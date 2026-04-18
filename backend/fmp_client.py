# fmp_client.py
"""
Financial Modeling Prep (FMP) — Plan gratuit : 250 req/jour
Sources : consensus analystes, prix cibles, résultats historiques, actualités, sentiment
https://financialmodelingprep.com/developer/docs

Obtenir une clé gratuite : https://site.financialmodelingprep.com/register
Variable d'environnement : FMP_API_KEY
"""
import os, time, math, asyncio
import httpx
from cache import TTLCache

FMP_BASE = "https://financialmodelingprep.com/stable"
FMP_BASE_V3 = "https://financialmodelingprep.com/api/v3"

# Mapping symbol → FMP ticker (actions françaises : suffixe .PA → sans suffixe sur FMP)
FMP_SYMBOL_MAP = {
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

class FMPClient:
    def __init__(self, api_key: str, cache: TTLCache):
        self.api_key = (api_key or "").strip()
        self.cache   = cache
        self.enabled = bool(api_key)
        self._client = httpx.AsyncClient(timeout=12, headers={"User-Agent": "volindex/1.0"})
        self._last_call = 0.0
        self._min_interval = 1.0  # 1s entre appels (250/jour = ~1 toutes les 5min max)
        if not self.enabled:
            print("[FMPClient] FMP_API_KEY non configuré — consensus/résultats FMP désactivés.")

    def _fmp_sym(self, symbol: str) -> str:
        return FMP_SYMBOL_MAP.get(symbol, symbol.replace(".PA", ""))

    async def _get(self, path: str, params: dict = {}, base=None, ttl=3600) -> any:
        if not self.enabled: return None
        ck = f"fmp:{path}:{sorted(params.items())}"
        if c := self.cache.get(ck): return c

        # Rate limiting
        elapsed = time.monotonic() - self._last_call
        if elapsed < self._min_interval:
            await asyncio.sleep(self._min_interval - elapsed)
        self._last_call = time.monotonic()

        url = f"{base or FMP_BASE}{path}"
        params["apikey"] = self.api_key
        try:
            r = await self._client.get(url, params=params)
            if r.status_code == 429:
                print("[FMP] Rate limit 429")
                return None
            r.raise_for_status()
            data = r.json()
            self.cache.set(ck, data, ttl=ttl)
            return data
        except Exception as e:
            print(f"[FMP] {path}: {e}")
            return None

    # ── Consensus analystes ───────────────────────────────────────────────────

    async def get_analyst_consensus(self, symbol: str) -> dict:
        """Consensus Buy/Hold/Sell + prix cible."""
        sym = self._fmp_sym(symbol)
        print(f"[FMP] Fetching consensus for {sym}")

        # Grade summary — endpoint vérifié
        grades_data = await self._get("/grades-consensus", {"symbol": sym}, ttl=3600)
        print(f"[FMP] grades_data: {grades_data}")

        # Price target consensus
        pt_data = await self._get("/price-target-consensus", {"symbol": sym}, ttl=3600)
        print(f"[FMP] pt_data: {pt_data}")

        # Historical grades individuels
        hist_grades = await self._get("/grades", {"symbol": sym, "limit": 20}, ttl=3600)

        result = self._build_analyst_result(grades_data, pt_data, hist_grades, symbol)
        return result

    def _build_analyst_result(self, grades, pt, hist_grades, symbol) -> dict:
        # Grades summary — FMP retourne [{"symbol","strongBuy","buy","hold","sell","strongSell","consensus"}]
        strong_buy = buy = hold = sell = strong_sell = 0
        g = None
        if isinstance(grades, list) and grades:
            g = grades[0]
        elif isinstance(grades, dict):
            g = grades
        if g:
            strong_buy  = int(g.get("strongBuy")  or g.get("strong_buy")  or 0)
            buy         = int(g.get("buy")         or 0)
            hold        = int(g.get("hold")        or 0)
            sell        = int(g.get("sell")        or 0)
            strong_sell = int(g.get("strongSell")  or g.get("strong_sell") or 0)

        total = strong_buy + buy + hold + sell + strong_sell or 1
        bull_pct = round((strong_buy + buy) / total * 100)
        bear_pct = round((sell + strong_sell) / total * 100)
        hold_pct = 100 - bull_pct - bear_pct

        verdict = "haussier" if bull_pct >= 55 else "baissier" if bear_pct >= 35 else "neutre"

        # Prix cible
        pt_mean = pt_high = pt_low = pt_median = 0.0
        if isinstance(pt, list) and pt:
            pt = pt[0]
        if isinstance(pt, dict):
            pt_mean   = sf(pt.get("targetConsensus") or pt.get("priceTarget"))
            pt_high   = sf(pt.get("targetHigh"))
            pt_low    = sf(pt.get("targetLow"))
            pt_median = sf(pt.get("targetMedian"))

        # Historique grades individuels
        recent_actions = []
        if isinstance(hist_grades, list):
            for g in hist_grades[:8]:
                recent_actions.append({
                    "date":        g.get("date", ""),
                    "analyst":     g.get("analystCompany") or g.get("company", ""),
                    "from_grade":  g.get("previousGrade") or g.get("from", ""),
                    "to_grade":    g.get("newGrade") or g.get("to", ""),
                    "action":      g.get("action") or g.get("type", ""),
                })

        return {
            "type": "stock",
            "verdict": verdict,
            "strong_buy": strong_buy, "buy": buy, "hold": hold,
            "sell": sell, "strong_sell": strong_sell,
            "total": total, "bull_pct": bull_pct, "bear_pct": bear_pct, "hold_pct": hold_pct,
            "price_target_mean": pt_mean, "price_target_high": pt_high,
            "price_target_low": pt_low, "price_target_median": pt_median,
            "recent_actions": recent_actions,
            "source": "Financial Modeling Prep",
        }

    # ── Résultats historiques ─────────────────────────────────────────────────

    async def get_earnings_history(self, symbol: str) -> list[dict]:
        """Résultats EPS trimestriels — endpoints gratuits FMP."""
        sym = self._fmp_sym(symbol)
        
        # Endpoint gratuit : income-statement (quarterly) contient EPS réel
        data = await self._get("/income-statement", {
            "symbol": sym, "period": "quarter", "limit": 16,
        }, base=FMP_BASE_V3, ttl=3600)
        
        if not data or not isinstance(data, list):
            # Fallback : earnings-calendar (gratuit)
            data = await self._get("/earning_calendar", {
                "symbol": sym,
            }, base=FMP_BASE_V3, ttl=3600)

        if not isinstance(data, list):
            return []

        results = []
        for e in data:
            date = e.get("date") or e.get("fiscalDateEnding", "")
            try:
                if date and int(date[:4]) < 2022: continue
            except: pass

            # FMP income-statement format
            eps_actual   = sf(e.get("eps") or e.get("epsActual") or e.get("actualEarningResult"))
            eps_estimate = sf(e.get("epsEstimated") or e.get("estimatedEarning") or e.get("epsEstimate"))
            rev_actual   = sf(e.get("revenue") or e.get("revenueActual"))
            rev_estimate = sf(e.get("revenueEstimated") or e.get("revenueEstimate"))
            period       = e.get("period") or e.get("calendarYear","")

            surprise_pct = 0.0
            if eps_estimate and eps_actual:
                surprise_pct = round((eps_actual - eps_estimate) / abs(eps_estimate) * 100, 2) if eps_estimate != 0 else 0

            results.append({
                "date":          date,
                "period":        e.get("period") or e.get("fiscalDateEnding", ""),
                "eps_actual":    eps_actual,
                "eps_estimate":  eps_estimate,
                "surprise_pct":  surprise_pct,
                "rev_actual":    rev_actual,
                "rev_estimate":  rev_estimate,
                "beat_eps":      eps_actual > eps_estimate if eps_estimate else None,
                "beat_rev":      rev_actual > rev_estimate if rev_estimate else None,
                "source":        "FMP",
            })

        return results[:16]  # Jusqu'à T1 2022

    # ── Actualités ────────────────────────────────────────────────────────────

    async def get_news(self, symbol: str) -> list[dict]:
        """Actualités récentes (7 jours)."""
        sym = self._fmp_sym(symbol)
        data = await self._get(f"/news/stock", {
            "symbols": sym, "limit": 15,
        }, ttl=600)

        if not isinstance(data, list):
            return []

        results = []
        for n in data:
            headline = n.get("title") or n.get("headline", "")
            summary  = n.get("text") or n.get("summary", "")
            if not headline: continue
            results.append({
                "headline": headline,
                "summary":  summary[:300] if summary else "",
                "source":   n.get("site") or n.get("source", "FMP"),
                "url":      n.get("url", ""),
                "datetime": int(n.get("publishedDate") and
                               time.mktime(time.strptime(n["publishedDate"][:19], "%Y-%m-%d %H:%M:%S"))
                               if n.get("publishedDate") else time.time()),
                "sentiment": self._detect_sentiment(headline + " " + (summary or "")),
            })

        return results

    async def get_dividends(self, symbol: str) -> list[dict]:
        """Dividendes via FMP (gratuit)."""
        sym = self._fmp_sym(symbol)
        # FMP historical dividends - endpoint gratuit
        data = await self._get("/historical-price-full/stock_dividend", {
            "symbol": sym,
        }, base=FMP_BASE_V3, ttl=3600)
        
        if not data:
            return []
        
        # Le format est {"symbol":"AAPL","historical":[...]}
        if isinstance(data, dict):
            items = data.get("historical", [])
        elif isinstance(data, list):
            items = data
        else:
            return []
        
        now_str = time.strftime("%Y-%m-%d")
        results = []
        for d in items[:12]:
            results.append({
                "ex_date":   d.get("date") or d.get("exDividendDate",""),
                "pay_date":  d.get("paymentDate") or d.get("payDate",""),
                "amount":    sf(d.get("dividend") or d.get("adjDividend") or d.get("amount")),
                "currency":  "USD",
                "frequency": d.get("label",""),
                "yield_pct": sf(d.get("yield")),
            })
        return results

    def _detect_sentiment(self, text: str) -> str:
        t = text.lower()
        pos = ["hausse","gain","record","croissance","bénéfice","dépasse","surpasse","augmente",
               "rise","gain","beat","growth","profit","rally","surge","upgrade","outperform","positive"]
        neg = ["baisse","perte","chute","recul","manque","déception","abaisse","réduit","coupe",
               "fall","drop","loss","miss","decline","cut","downgrade","underperform","warning","risk"]
        p = sum(1 for w in pos if w in t)
        n = sum(1 for w in neg if w in t)
        if p > n + 1: return "positif"
        if n > p + 1: return "negatif"
        return "neutre"

    # ── Sentiment marché ──────────────────────────────────────────────────────

    async def get_market_sentiment(self, symbol: str) -> dict:
        """Fear & Greed + sentiment actions."""
        sym = self._fmp_sym(symbol)

        # Score financier global
        rating_data = await self._get(f"/company-rating", {"symbol": sym}, ttl=3600)
        score_data  = await self._get(f"/score", {"symbol": sym}, ttl=3600)

        result = {"type": "stock", "symbol": symbol}

        if isinstance(rating_data, list) and rating_data:
            r = rating_data[0]
            result["overall_rating"] = r.get("rating", "")
            result["rating_score"]   = sf(r.get("ratingScore"))
            result["dcf_rating"]     = r.get("ratingDetailsDCFRating", "")
            result["roe_rating"]     = r.get("ratingDetailsROERating", "")
            result["roa_rating"]     = r.get("ratingDetailsROARating", "")
            result["de_rating"]      = r.get("ratingDetailsDERating", "")
            result["pe_rating"]      = r.get("ratingDetailsPERating", "")
            result["pb_rating"]      = r.get("ratingDetailsPBRating", "")

        if isinstance(score_data, list) and score_data:
            s = score_data[0]
            result["piotroski_score"] = sf(s.get("piotroskiScore"))
            result["altman_score"]    = sf(s.get("altmanZScore"))

        return result
