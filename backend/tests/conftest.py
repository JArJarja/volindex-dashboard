# tests/conftest.py
"""
Fixtures partagées + stubs pour les dépendances non installées (pydantic, httpx…).
Ce fichier est chargé automatiquement par pytest.
"""
import sys
import types
import math

# ── Stubs minimaux pour les modules non disponibles en CI ────────────────────

def _make_stub(name: str) -> types.ModuleType:
    m = types.ModuleType(name)
    sys.modules[name] = m
    return m


# Pydantic
if "pydantic" not in sys.modules:
    class _BaseModel:
        def __init__(self, **kw):
            for k, v in kw.items():
                setattr(self, k, v)

        def dict(self):
            return {k: v for k, v in self.__dict__.items() if not k.startswith("_")}

    pyd = _make_stub("pydantic")
    pyd.BaseModel = _BaseModel
    pyd_s = _make_stub("pydantic_settings")

    class _BaseSettings(_BaseModel):
        class Config:
            env_file = ".env"

    pyd_s.BaseSettings = _BaseSettings


# Models
if "models" not in sys.modules:
    from pydantic import BaseModel

    class TopRow(BaseModel): pass
    class Candle(BaseModel): pass
    class MACDData(BaseModel): pass
    class Indicators(BaseModel): pass
    class Diagnostic(BaseModel): pass
    class Detail(BaseModel): pass
    class Report(BaseModel): pass

    m_mod = _make_stub("models")
    for cls in [TopRow, Candle, MACDData, Indicators, Diagnostic, Detail, Report]:
        setattr(m_mod, cls.__name__, cls)


# finnhub_client
if "finnhub_client" not in sys.modules:
    fc_mod = _make_stub("finnhub_client")

    class _RateLimiter:
        def __init__(self, rate=20): self.rate = rate
        async def acquire(self): pass

    class _FinnhubClient:
        def __init__(self, key, cache): pass
        async def quote(self, symbol): return {}
        async def candles(self, symbol, res, f, t): return {"s": "no_data"}
        async def search(self, q): return {}

    fc_mod.RateLimiter = _RateLimiter
    fc_mod.FinnhubClient = _FinnhubClient


# httpx (si non installé)
if "httpx" not in sys.modules:
    httpx_mod = _make_stub("httpx")

    class _HTTPStatusError(Exception):
        def __init__(self, msg, *, request=None, response=None):
            super().__init__(msg)
            self.request = request
            self.response = response

    class _RequestError(Exception): pass

    httpx_mod.HTTPStatusError = _HTTPStatusError
    httpx_mod.RequestError = _RequestError
    httpx_mod.AsyncClient = object


import pytest

@pytest.fixture
def sample_closes_bullish():
    return [float(90 + i) for i in range(30)]

@pytest.fixture
def sample_closes_bearish():
    return [float(120 - i) for i in range(30)]

@pytest.fixture
def sample_closes_flat():
    return [100.0] * 30

@pytest.fixture
def sample_ohlcv():
    """Données OHLCV synthétiques pour 30 périodes."""
    closes = [100 + math.sin(i * 0.3) * 2 for i in range(30)]
    highs  = [c + 0.8 for c in closes]
    lows   = [c - 0.8 for c in closes]
    volumes = [1_000_000 + i * 10_000 for i in range(30)]
    return closes, highs, lows, volumes
