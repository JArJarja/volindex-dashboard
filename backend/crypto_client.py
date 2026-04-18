# crypto_client.py
"""
Client CoinGecko — gratuit, sans clé API.
Utilisé pour les crypto que Finnhub ne supporte pas sur plan gratuit.
"""
import asyncio
import httpx
import time
from cache import TTLCache

COINGECKO_BASE = "https://api.coingecko.com/api/v3"

# Mapping symbole → id CoinGecko
COINGECKO_IDS = {
    "BINANCE:BTCUSDT":  "bitcoin",
    "BINANCE:ETHUSDT":  "ethereum",
    "BINANCE:SOLUSDT":  "solana",
    "BINANCE:DOGEUSDT": "dogecoin",
    "BINANCE:SHIBUSDT": "shiba-inu",
    "BINANCE:PEPEUSDT": "pepe",
    "BINANCE:WIFUSDT":  "dogwifcoin",
    "BINANCE:BONKUSDT": "bonk",
}

class CryptoClient:
    def __init__(self, cache: TTLCache):
        self.cache = cache
        self._last_cg_call = 0.0   # timestamp dernier appel CoinGecko
        self._min_interval = 12.0  # 12s min entre appels (5 req/min max)
        self._client = httpx.AsyncClient(timeout=15, headers={
            "Accept": "application/json",
            "User-Agent": "finnhub-dashboard/1.0",
        })

    def is_crypto(self, symbol: str) -> bool:
        return symbol in COINGECKO_IDS

    async def get_prices(self, symbols: list[str]) -> dict[str, dict]:
        """Récupère les prix de plusieurs crypto en un seul appel."""
        crypto_syms = [s for s in symbols if self.is_crypto(s)]
        if not crypto_syms:
            return {}

        ids = [COINGECKO_IDS[s] for s in crypto_syms]
        ids_str = ",".join(ids)
        cache_key = f"cg:prices:{ids_str}"

        if cached := self.cache.get(cache_key):
            return cached

        # Rate limiting CoinGecko : max 5 req/min sur plan gratuit
        import time as _time
        elapsed = _time.monotonic() - self._last_cg_call
        if elapsed < self._min_interval:
            import asyncio as _asyncio
            await _asyncio.sleep(self._min_interval - elapsed)
        self._last_cg_call = _time.monotonic()

        try:
            r = await self._client.get(
                f"{COINGECKO_BASE}/coins/markets",
                params={
                    "vs_currency": "usd",
                    "ids": ids_str,
                    "price_change_percentage": "24h",
                    "per_page": 50,
                    "page": 1,
                }
            )
            r.raise_for_status()
            data = r.json()

            # Construire un dict id → données
            by_id = {coin["id"]: coin for coin in data}

            # Mapper vers nos symboles
            result = {}
            for sym in crypto_syms:
                cg_id = COINGECKO_IDS[sym]
                if cg_id in by_id:
                    coin = by_id[cg_id]
                    result[sym] = {
                        "c":  coin.get("current_price", 0),
                        "pc": coin.get("current_price", 0) / (1 + coin.get("price_change_percentage_24h", 0) / 100)
                             if coin.get("price_change_percentage_24h") else coin.get("current_price", 0),
                        "h":  coin.get("high_24h", 0),
                        "l":  coin.get("low_24h", 0),
                        "o":  coin.get("current_price", 0),  # approx
                        "chg_pct": coin.get("price_change_percentage_24h", 0),
                        "name": coin.get("name", sym),
                    }

            self.cache.set(cache_key, result, ttl=30)
            return result

        except Exception as e:
            print(f"[CoinGecko error] {e}")
            return {}
