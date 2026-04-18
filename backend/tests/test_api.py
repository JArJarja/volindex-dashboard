# tests/test_api.py
"""Tests sur la gestion d'erreurs API et le cache."""
import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import time
import asyncio
import pytest
from unittest.mock import AsyncMock, MagicMock, patch

from cache import TTLCache
from models import TopRow, Detail


# ── TTLCache ──────────────────────────────────────────────────────────────────

class TestTTLCache:
    def test_set_and_get(self):
        c = TTLCache(default_ttl=10)
        c.set("key", {"val": 42})
        assert c.get("key") == {"val": 42}

    def test_expiry(self):
        c = TTLCache(default_ttl=1)
        c.set("key", "data", ttl=0.05)
        time.sleep(0.1)
        assert c.get("key") is None

    def test_miss(self):
        c = TTLCache()
        assert c.get("nonexistent") is None

    def test_delete(self):
        c = TTLCache()
        c.set("x", 1)
        c.delete("x")
        assert c.get("x") is None

    def test_overwrite(self):
        c = TTLCache()
        c.set("k", "first")
        c.set("k", "second")
        assert c.get("k") == "second"

    def test_custom_ttl(self):
        c = TTLCache(default_ttl=100)
        c.set("k", "v", ttl=0.05)
        time.sleep(0.1)
        assert c.get("k") is None


# ── FinnhubClient mock ────────────────────────────────────────────────────────

class TestFinnhubClientMock:
    """Tests la gestion des erreurs sans appeler l'API réelle."""

    @pytest.mark.asyncio
    async def test_rate_limiter_acquire(self):
        from finnhub_client import RateLimiter
        rl = RateLimiter(rate=100)
        # Should not block for reasonable rate
        start = time.monotonic()
        for _ in range(5):
            await rl.acquire()
        elapsed = time.monotonic() - start
        assert elapsed < 1.0

    @pytest.mark.asyncio
    async def test_client_uses_cache(self):
        from cache import TTLCache
        from finnhub_client import FinnhubClient

        cache = TTLCache()
        cache.set("fh:/quote:[('symbol', 'SPY')]", {"c": 450.0, "pc": 445.0}, ttl=60)

        client = FinnhubClient("fake_key", cache)
        result = await client.quote("SPY")
        assert result["c"] == 450.0

    @pytest.mark.asyncio
    async def test_client_handles_http_error(self):
        import httpx
        from cache import TTLCache
        from finnhub_client import FinnhubClient

        cache = TTLCache()
        client = FinnhubClient("bad_key", cache)

        mock_response = MagicMock()
        mock_response.status_code = 401
        mock_response.raise_for_status.side_effect = httpx.HTTPStatusError(
            "Unauthorized", request=MagicMock(), response=mock_response
        )

        with patch.object(client._client, "get", return_value=mock_response):
            with pytest.raises(httpx.HTTPStatusError):
                await client.quote("SPY")


# ── Models validation ─────────────────────────────────────────────────────────

class TestModels:
    def test_toprow_valid(self):
        row = TopRow(
            symbol="SPY", name="S&P 500", price=450.0, change_pct=-0.5,
            volume=1e7, realized_vol=0.012, vol_volume_score=5.23,
            bias="haussier", confidence=72, updated_at="2024-01-01T12:00:00Z"
        )
        assert row.bias == "haussier"
        assert 0 <= row.confidence <= 100

    def test_toprow_serialization(self):
        row = TopRow(
            symbol="QQQ", name="Nasdaq", price=380.0, change_pct=0.3,
            volume=5e6, realized_vol=0.015, vol_volume_score=4.1,
            bias="neutre", confidence=45, updated_at="2024-01-01T12:00:00Z"
        )
        d = row.dict()
        assert d["symbol"] == "QQQ"
        assert isinstance(d["vol_volume_score"], float)


# ── compute_scores edge cases ─────────────────────────────────────────────────

class TestComputeScoresEdgeCases:
    @pytest.mark.asyncio
    async def test_empty_universe(self):
        from quant import compute_scores
        from cache import TTLCache
        from finnhub_client import FinnhubClient

        cache = TTLCache()
        client = FinnhubClient("fake", cache)
        result = await compute_scores(client, [], window_minutes=60, resolution="1")
        assert result == []

    @pytest.mark.asyncio
    async def test_bad_candle_response(self):
        """Symboles avec données manquantes sont ignorés silencieusement."""
        from quant import compute_scores
        from cache import TTLCache
        from finnhub_client import FinnhubClient

        cache = TTLCache()
        client = FinnhubClient("fake", cache)

        # Simuler candle vide (status "no_data")
        async def fake_candle(sym, res, from_ts, to_ts):
            return {"s": "no_data"}

        async def fake_quote(sym):
            return {"c": 100.0, "pc": 99.0}

        with patch.object(client, "candles", side_effect=fake_candle):
            with patch.object(client, "quote", side_effect=fake_quote):
                universe = [{"symbol": "FAKE", "name": "Fake Index"}]
                result = await compute_scores(client, universe, 60, "1")
                assert result == []


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
