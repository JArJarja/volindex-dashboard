# finnhub_client.py
"""
Client Finnhub avec throttling (30 req/s plan gratuit).
Utilise httpx async + retry simple.
"""
import time
import asyncio
import httpx
from cache import TTLCache

FINNHUB_BASE = "https://finnhub.io/api/v1"


class RateLimiter:
    """Token bucket — 25 req/s (marge sous la limite gratuite de 30/s)."""
    def __init__(self, rate: float = 25.0):
        self.rate = rate
        self.tokens = rate
        self.last = time.monotonic()
        self._lock = asyncio.Lock()

    async def acquire(self):
        async with self._lock:
            now = time.monotonic()
            elapsed = now - self.last
            self.tokens = min(self.rate, self.tokens + elapsed * self.rate)
            self.last = now
            if self.tokens < 1:
                wait = (1 - self.tokens) / self.rate
                await asyncio.sleep(wait)
                self.tokens = 0
            else:
                self.tokens -= 1


class FinnhubClient:
    def __init__(self, api_key: str, cache: TTLCache):
        self.api_key = api_key
        self.cache = cache
        self.limiter = RateLimiter(rate=20)  # conservatif
        self._client = httpx.AsyncClient(timeout=10)

    async def _get(self, path: str, params: dict, cache_ttl: int = 8) -> dict:
        cache_key = f"fh:{path}:{sorted(params.items())}"
        if cached := self.cache.get(cache_key):
            return cached

        await self.limiter.acquire()
        params["token"] = self.api_key
        url = f"{FINNHUB_BASE}{path}"

        for attempt in range(3):
            try:
                r = await self._client.get(url, params=params)
                r.raise_for_status()
                data = r.json()
                self.cache.set(cache_key, data, ttl=cache_ttl)
                return data
            except httpx.HTTPStatusError as e:
                if e.response.status_code == 429:
                    await asyncio.sleep(2 ** attempt)
                else:
                    raise
            except httpx.RequestError:
                await asyncio.sleep(1)

        raise RuntimeError(f"Finnhub request failed after retries: {path}")

    async def quote(self, symbol: str) -> dict:
        """GET /quote — prix temps réel."""
        return await self._get("/quote", {"symbol": symbol}, cache_ttl=5)

    async def candles(self, symbol: str, resolution: str, from_ts: int, to_ts: int) -> dict:
        """GET /stock/candle — OHLCV."""
        return await self._get(
            "/stock/candle",
            {"symbol": symbol, "resolution": resolution, "from": from_ts, "to": to_ts},
            cache_ttl=8,
        )

    async def search(self, query: str) -> dict:
        """GET /search — validation symbole."""
        return await self._get("/search", {"q": query}, cache_ttl=3600)
