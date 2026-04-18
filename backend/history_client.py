# history_client.py
"""
Historique 48h + calendrier résultats/dividendes.
Sources :
 - Finnhub /stock/candle (D = daily) pour l'historique prix
 - Finnhub /stock/earnings-calendar pour les résultats
 - Finnhub /stock/dividend pour les dividendes
 - CoinGecko /coins/{id}/market_chart pour les crypto
"""
import asyncio, time, math
import httpx
from cache import TTLCache

FINNHUB_BASE = "https://finnhub.io/api/v1"
CG_BASE      = "https://api.coingecko.com/api/v3"

CG_IDS = {
    "BINANCE:BTCUSDT": "bitcoin",
    "BINANCE:ETHUSDT": "ethereum",
    "BINANCE:SOLUSDT": "solana",
    "BINANCE:DOGEUSDT":"dogecoin",
    "BINANCE:SHIBUSDT":"shiba-inu",
    "BINANCE:PEPEUSDT":"pepe",
    "BINANCE:WIFUSDT": "dogwifcoin",
    "BINANCE:BONKUSDT":"bonk",
}

def sf(v, d=0.0):
    try:
        f = float(v)
        return f if math.isfinite(f) else d
    except: return d

class HistoryClient:
    def __init__(self, api_key: str, cache: TTLCache):
        self.api_key = api_key
        self.cache   = cache
        self._fh = httpx.AsyncClient(timeout=12)
        self._cg = httpx.AsyncClient(timeout=12, headers={"User-Agent":"volindex/1.0"})

    # ── prix 48h ─────────────────────────────────────────────────────────────

    async def get_prices_48h(self, symbol: str) -> list[dict]:
        """Retourne une liste de {t, c} sur les 48 dernières heures."""
        ck = f"h48:{symbol}"
        if c := self.cache.get(ck): return c

        now = int(time.time())
        ago = now - 48*3600

        if symbol in CG_IDS:
            data = await self._cg_history(CG_IDS[symbol])
        else:
            # Finnhub daily candles sur 7 derniers jours (gratuit)
            data = await self._fh_candles(symbol.replace(".PA",""), ago, now)

        self.cache.set(ck, data, ttl=300)
        return data

    async def _cg_history(self, cg_id: str) -> list[dict]:
        try:
            r = await self._cg.get(f"{CG_BASE}/coins/{cg_id}/market_chart",
                params={"vs_currency":"usd","days":"2","interval":"hourly"})
            r.raise_for_status()
            prices = r.json().get("prices",[])
            return [{"t": int(p[0]/1000), "c": sf(p[1])} for p in prices]
        except Exception as e:
            print(f"[CG history] {e}")
            return []

    async def _fh_candles(self, symbol: str, from_ts: int, to_ts: int) -> list[dict]:
        try:
            r = await self._fh.get(f"{FINNHUB_BASE}/stock/candle", params={
                "symbol": symbol, "resolution": "60",
                "from": from_ts, "to": to_ts,
                "token": self.api_key,
            })
            r.raise_for_status()
            d = r.json()
            if d.get("s") != "ok":
                return []
            return [{"t": int(t), "c": sf(c)}
                    for t, c in zip(d.get("t",[]), d.get("c",[]))]
        except Exception as e:
            print(f"[FH candles 48h] {symbol}: {e}")
            return []

    # ── résultats / earnings ──────────────────────────────────────────────────

    async def get_earnings(self, symbol: str) -> list[dict]:
        """Prochains et derniers résultats trimestriels."""
        # Seulement pour actions (pas crypto, pas ETF)
        if symbol in CG_IDS or symbol.startswith("BINANCE"):
            return []
        ck = f"earn:{symbol}"
        if c := self.cache.get(ck): return c

        clean = symbol.replace(".PA","")
        now = int(time.time())
        from_dt = time.strftime("%Y-%m-%d", time.gmtime(now - 90*86400))
        to_dt   = time.strftime("%Y-%m-%d", time.gmtime(now + 90*86400))

        try:
            r = await self._fh.get(f"{FINNHUB_BASE}/calendar/earnings", params={
                "symbol": clean, "from": from_dt, "to": to_dt,
                "token": self.api_key,
            })
            r.raise_for_status()
            items = r.json().get("earningsCalendar", [])
            result = [{
                "date":    i.get("date",""),
                "quarter": i.get("quarter",""),
                "year":    i.get("year",""),
                "eps_est": sf(i.get("epsEstimate")),
                "eps_act": sf(i.get("epsActual")),
                "rev_est": sf(i.get("revenueEstimate")),
                "rev_act": sf(i.get("revenueActual")),
                "url":     f"https://finnhub.io/financial-statements?symbol={clean}",
            } for i in items[:6]]
            self.cache.set(ck, result, ttl=3600)
            return result
        except Exception as e:
            print(f"[FH earnings] {symbol}: {e}")
            return []

    # ── dividendes ────────────────────────────────────────────────────────────

    async def get_dividends(self, symbol: str) -> list[dict]:
        """Dividendes récents et à venir."""
        if symbol in CG_IDS or symbol.startswith("BINANCE"):
            return []
        ck = f"div:{symbol}"
        if c := self.cache.get(ck): return c

        clean = symbol.replace(".PA","")
        now = int(time.time())
        from_dt = time.strftime("%Y-%m-%d", time.gmtime(now - 365*86400))
        to_dt   = time.strftime("%Y-%m-%d", time.gmtime(now + 180*86400))

        try:
            r = await self._fh.get(f"{FINNHUB_BASE}/stock/dividend", params={
                "symbol": clean, "from": from_dt, "to": to_dt,
                "token": self.api_key,
            })
            r.raise_for_status()
            items = r.json() if isinstance(r.json(), list) else []
            result = [{
                "ex_date":    i.get("exDate",""),
                "pay_date":   i.get("payDate",""),
                "amount":     sf(i.get("amount")),
                "currency":   i.get("currency","USD"),
                "frequency":  i.get("frequency",""),
                "yield_pct":  sf(i.get("yield")),
            } for i in items[:6]]
            self.cache.set(ck, result, ttl=3600)
            return result
        except Exception as e:
            print(f"[FH dividends] {symbol}: {e}")
            return []


    # ── Actualités ────────────────────────────────────────────────────────────

    async def get_news(self, symbol: str) -> list[dict]:
        """Actualités récentes via Finnhub /company-news (actions) ou /news (général)."""
        if symbol.startswith("BINANCE:"):
            return await self._cg_crypto_news(symbol)

        ck = f"news:{symbol}"
        if c := self.cache.get(ck): return c

        clean = symbol.replace(".PA", "")
        now = int(time.time())
        from_dt = time.strftime("%Y-%m-%d", time.gmtime(now - 7 * 86400))
        to_dt   = time.strftime("%Y-%m-%d", time.gmtime(now))

        try:
            r = await self._fh.get(f"{FINNHUB_BASE}/company-news", params={
                "symbol": clean, "from": from_dt, "to": to_dt,
                "token": self.api_key,
            })
            r.raise_for_status()
            items = r.json() if isinstance(r.json(), list) else []
            result = [{
                "headline": i.get("headline", ""),
                "summary":  i.get("summary", "")[:300],
                "source":   i.get("source", ""),
                "url":      i.get("url", ""),
                "datetime": i.get("datetime", 0),
                "image":    i.get("image", ""),
                "sentiment": self._news_sentiment(i.get("headline","") + " " + i.get("summary","")),
            } for i in items[:12] if i.get("headline")]
            self.cache.set(ck, result, ttl=600)
            return result
        except Exception as e:
            print(f"[FH news] {symbol}: {e}")
            return []

    async def _cg_crypto_news(self, symbol: str) -> list[dict]:
        """Actualités crypto depuis CoinGecko."""
        from crypto_client import CG_IDS
        cg_id = CG_IDS.get(symbol, "bitcoin")
        ck = f"news:cg:{cg_id}"
        if c := self.cache.get(ck): return c
        try:
            r = await self._cg.get(f"{CG_BASE}/news", params={"category": cg_id})
            r.raise_for_status()
            items = r.json().get("data", [])[:12]
            result = [{
                "headline": i.get("title", ""),
                "summary":  i.get("description", "")[:300],
                "source":   i.get("author", {}).get("name", "CoinGecko") if isinstance(i.get("author"), dict) else "CoinGecko",
                "url":      i.get("url", ""),
                "datetime": int(i.get("updated_at", time.time())),
                "image":    "",
                "sentiment": self._news_sentiment(i.get("title","") + " " + i.get("description","")),
            } for i in items if i.get("title")]
            self.cache.set(ck, result, ttl=600)
            return result
        except Exception as e:
            print(f"[CG news] {symbol}: {e}")
            return []

    def _news_sentiment(self, text: str) -> str:
        """Détection de sentiment simple sur le texte de l'actualité."""
        text = text.lower()
        bull_words = ["hausse","gain","rally","record","growth","profit","beat","strong","surge","rise","positive","bullish","upgrade","buy","outperform","target raised"]
        bear_words = ["baisse","loss","drop","fall","decline","miss","weak","cut","downgrade","sell","underperform","warn","risk","crash","fear","concern","target lowered"]
        bull = sum(1 for w in bull_words if w in text)
        bear = sum(1 for w in bear_words if w in text)
        if bull > bear + 1: return "positif"
        if bear > bull + 1: return "negatif"
        return "neutre"

    # ── Consensus analystes ────────────────────────────────────────────────────

    async def get_consensus(self, symbol: str) -> dict:
        """Consensus analystes : recommandations + prix cible."""
        if symbol.startswith("BINANCE:"):
            return await self._cg_crypto_consensus(symbol)

        ck = f"cons:{symbol}"
        if c := self.cache.get(ck): return c

        clean = symbol.replace(".PA", "")

        try:
            # Recommandations
            r1 = await self._fh.get(f"{FINNHUB_BASE}/stock/recommendation", params={"symbol": clean, "token": self.api_key})
            r1.raise_for_status()
            recs = r1.json() if isinstance(r1.json(), list) else []

            # Prix cible
            r2 = await self._fh.get(f"{FINNHUB_BASE}/stock/price-target", params={"symbol": clean, "token": self.api_key})
            r2.raise_for_status()
            pt = r2.json() if isinstance(r2.json(), dict) else {}

            # EPS surprises (historique surprises)
            r3 = await self._fh.get(f"{FINNHUB_BASE}/stock/earnings", params={"symbol": clean, "token": self.api_key})
            r3.raise_for_status()
            eps_hist = r3.json() if isinstance(r3.json(), list) else []

            # Sentiment social
            r4 = await self._fh.get(f"{FINNHUB_BASE}/stock/social-sentiment", params={
                "symbol": clean, "from": time.strftime("%Y-%m-%d", time.gmtime(time.time()-30*86400)),
                "token": self.api_key,
            })
            r4.raise_for_status()
            social = r4.json() if isinstance(r4.json(), dict) else {}

            result = self._build_consensus(recs, pt, eps_hist, social)
            self.cache.set(ck, result, ttl=3600)
            return result
        except Exception as e:
            print(f"[FH consensus] {symbol}: {e}")
            return self._empty_consensus()

    async def _cg_crypto_consensus(self, symbol: str) -> dict:
        """Consensus simplifié pour crypto depuis CoinGecko (sentiment + prix)."""
        from crypto_client import CG_IDS
        cg_id = CG_IDS.get(symbol, "bitcoin")
        ck = f"cons:cg:{cg_id}"
        if c := self.cache.get(ck): return c
        try:
            r = await self._cg.get(f"{CG_BASE}/coins/{cg_id}", params={
                "localization": "false", "tickers": "false",
                "community_data": "true", "developer_data": "false",
            })
            r.raise_for_status()
            d = r.json()
            cm = d.get("community_data", {})
            sent = d.get("sentiment_votes_up_percentage", 50)
            mc = d.get("market_data", {})
            result = {
                "type": "crypto",
                "sentiment_up_pct": sf(sent),
                "sentiment_down_pct": round(100 - sf(sent), 1),
                "community_score": sf(d.get("community_score")),
                "price_target_high": sf(mc.get("ath", {}).get("usd")),
                "price_target_low":  sf(mc.get("atl", {}).get("usd")),
                "price_target_mean": sf(mc.get("current_price", {}).get("usd")),
                "reddit_subscribers": cm.get("reddit_subscribers", 0),
                "twitter_followers":  cm.get("twitter_followers", 0),
                "recommendations": [],
                "eps_surprises": [],
                "social": {},
                "verdict": "haussier" if sf(sent) > 60 else "baissier" if sf(sent) < 40 else "neutre",
            }
            self.cache.set(ck, result, ttl=1800)
            return result
        except Exception as e:
            print(f"[CG consensus] {symbol}: {e}")
            return self._empty_consensus()

    def _build_consensus(self, recs: list, pt: dict, eps_hist: list, social: dict) -> dict:
        latest_rec = recs[0] if recs else {}
        strong_buy  = int(latest_rec.get("strongBuy", 0))
        buy         = int(latest_rec.get("buy", 0))
        hold        = int(latest_rec.get("hold", 0))
        sell        = int(latest_rec.get("sell", 0))
        strong_sell = int(latest_rec.get("strongSell", 0))
        total = strong_buy + buy + hold + sell + strong_sell or 1

        bull_pct = round((strong_buy + buy) / total * 100)
        bear_pct = round((sell + strong_sell) / total * 100)
        hold_pct = round(hold / total * 100)

        verdict = "haussier" if bull_pct >= 55 else "baissier" if bear_pct >= 40 else "neutre"

        # EPS surprises récentes
        eps_surprises = [{
            "period": e.get("period",""),
            "actual":   sf(e.get("actual")),
            "estimate": sf(e.get("estimate")),
            "surprise_pct": sf(e.get("surprisepercent")),
        } for e in eps_hist[:6]]

        # Social
        reddit = social.get("reddit", [])
        twitter = social.get("twitter", [])
        r_score = sum(sf(x.get("score")) for x in reddit[-7:]) / max(len(reddit[-7:]),1) if reddit else 0
        t_score = sum(sf(x.get("score")) for x in twitter[-7:]) / max(len(twitter[-7:]),1) if twitter else 0

        return {
            "type": "stock",
            "recommendations": [{
                "period":      latest_rec.get("period",""),
                "strong_buy":  strong_buy,
                "buy":         buy,
                "hold":        hold,
                "sell":        sell,
                "strong_sell": strong_sell,
                "total":       total,
                "bull_pct":    bull_pct,
                "bear_pct":    bear_pct,
                "hold_pct":    hold_pct,
            }] + [{
                "period":      r.get("period",""),
                "strong_buy":  int(r.get("strongBuy",0)),
                "buy":         int(r.get("buy",0)),
                "hold":        int(r.get("hold",0)),
                "sell":        int(r.get("sell",0)),
                "strong_sell": int(r.get("strongSell",0)),
                "total":       int(r.get("strongBuy",0))+int(r.get("buy",0))+int(r.get("hold",0))+int(r.get("sell",0))+int(r.get("strongSell",0)) or 1,
                "bull_pct":    round((int(r.get("strongBuy",0))+int(r.get("buy",0))) / max(int(r.get("strongBuy",0))+int(r.get("buy",0))+int(r.get("hold",0))+int(r.get("sell",0))+int(r.get("strongSell",0)),1)*100),
                "bear_pct":    round((int(r.get("sell",0))+int(r.get("strongSell",0))) / max(int(r.get("strongBuy",0))+int(r.get("buy",0))+int(r.get("hold",0))+int(r.get("sell",0))+int(r.get("strongSell",0)),1)*100),
                "hold_pct":    round(int(r.get("hold",0)) / max(int(r.get("strongBuy",0))+int(r.get("buy",0))+int(r.get("hold",0))+int(r.get("sell",0))+int(r.get("strongSell",0)),1)*100),
            } for r in recs[1:4]],
            "price_target_high": sf(pt.get("targetHigh")),
            "price_target_low":  sf(pt.get("targetLow")),
            "price_target_mean": sf(pt.get("targetMean")),
            "price_target_median": sf(pt.get("targetMedian")),
            "analyst_count":     int(pt.get("lastUpdated","") and 1 or 0),
            "eps_surprises":     eps_surprises,
            "social_reddit_score":  round(r_score, 2),
            "social_twitter_score": round(t_score, 2),
            "verdict": verdict,
            "bull_pct": bull_pct,
            "bear_pct": bear_pct,
            "hold_pct": hold_pct,
        }

    def _empty_consensus(self) -> dict:
        return {"type":"none","verdict":"neutre","recommendations":[],"eps_surprises":[],"bull_pct":0,"bear_pct":0,"hold_pct":0,"price_target_mean":0,"price_target_high":0,"price_target_low":0}
