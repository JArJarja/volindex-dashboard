# tests/test_quant.py
"""Tests unitaires : calcul score, tendance, gestion erreurs."""
import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import math
import pytest
from quant import (
    log_returns, realized_vol, zscore_normalize,
    simple_ma, ema, rsi, atr, macd_calc,
    compute_bias, detect_supports_resistances, safe_float,
)


# ── log_returns ───────────────────────────────────────────────────────────────

def test_log_returns_basic():
    closes = [100.0, 101.0, 100.5]
    rets = log_returns(closes)
    assert len(rets) == 2
    assert abs(rets[0] - math.log(101 / 100)) < 1e-9

def test_log_returns_single():
    assert log_returns([100.0]) == []

def test_log_returns_empty():
    assert log_returns([]) == []

def test_log_returns_zero_price():
    # Ne doit pas lever d'exception
    rets = log_returns([0.0, 100.0, 101.0])
    assert len(rets) == 1  # premier terme ignoré


# ── realized_vol ──────────────────────────────────────────────────────────────

def test_realized_vol_flat():
    closes = [100.0] * 10
    rv = realized_vol(closes)
    assert rv == 0.0

def test_realized_vol_positive():
    import random
    random.seed(42)
    closes = [100 * math.exp(sum(random.gauss(0, 0.01) for _ in range(i))) for i in range(50)]
    rv = realized_vol(closes)
    assert rv > 0

def test_realized_vol_too_short():
    assert realized_vol([100.0]) == 0.0


# ── zscore_normalize ──────────────────────────────────────────────────────────

def test_zscore_mean_zero():
    values = [1.0, 2.0, 3.0, 4.0, 5.0]
    z = zscore_normalize(values)
    assert abs(sum(z) / len(z)) < 1e-9

def test_zscore_constant():
    values = [5.0, 5.0, 5.0]
    z = zscore_normalize(values)
    assert all(v == 0.0 for v in z)


# ── simple_ma / ema ───────────────────────────────────────────────────────────

def test_ma_basic():
    closes = [1, 2, 3, 4, 5]
    assert simple_ma(closes, 3) == pytest.approx(4.0)

def test_ma_insufficient():
    assert simple_ma([1, 2], 5) is None

def test_ema_basic():
    closes = [float(i) for i in range(1, 25)]
    result = ema(closes, 20)
    assert result is not None
    assert result > 0

def test_ema_insufficient():
    assert ema([1, 2], 5) is None


# ── RSI ───────────────────────────────────────────────────────────────────────

def test_rsi_uptrend():
    closes = [float(100 + i) for i in range(20)]
    r = rsi(closes, 14)
    assert r is not None
    assert r > 70  # tendance haussière forte

def test_rsi_downtrend():
    closes = [float(100 - i) for i in range(20)]
    r = rsi(closes, 14)
    assert r is not None
    assert r < 30  # tendance baissière forte

def test_rsi_insufficient():
    assert rsi([100.0, 101.0], 14) is None


# ── ATR ───────────────────────────────────────────────────────────────────────

def test_atr_basic():
    n = 20
    highs  = [101.0] * n
    lows   = [99.0] * n
    closes = [100.0] * n
    a = atr(highs, lows, closes, 14)
    assert a is not None
    assert abs(a - 2.0) < 0.1

def test_atr_insufficient():
    assert atr([101], [99], [100], 14) is None


# ── MACD ──────────────────────────────────────────────────────────────────────

def test_macd_basic():
    closes = [float(100 + i * 0.1 + (i % 3) * 0.05) for i in range(50)]
    result = macd_calc(closes)
    assert result is not None
    line, signal, hist = result
    assert hist == pytest.approx(line - signal, abs=1e-6)

def test_macd_insufficient():
    assert macd_calc([100.0] * 20) is None


# ── compute_bias ──────────────────────────────────────────────────────────────

def test_bias_bullish():
    closes = [float(90 + i) for i in range(25)]
    bias, conf = compute_bias(closes, ma20=95.0, rsi_val=60.0, macd_res=(0.5, 0.2, 0.3))
    assert bias == "haussier"
    assert 0 <= conf <= 100

def test_bias_bearish():
    closes = [float(110 - i) for i in range(25)]
    bias, conf = compute_bias(closes, ma20=105.0, rsi_val=38.0, macd_res=(-0.5, -0.2, -0.3))
    assert bias == "baissier"
    assert 0 <= conf <= 100

def test_bias_neutral():
    closes = [100.0] * 25
    bias, conf = compute_bias(closes, ma20=100.0, rsi_val=50.0, macd_res=(0.0, 0.0, 0.0))
    assert bias == "neutre"

def test_bias_empty():
    bias, conf = compute_bias([], None, None, None)
    assert bias == "neutre"
    assert conf == 0


# ── safe_float ────────────────────────────────────────────────────────────────

def test_safe_float_normal():
    assert safe_float(3.14) == pytest.approx(3.14)

def test_safe_float_none():
    assert safe_float(None) == 0.0

def test_safe_float_nan():
    assert safe_float(float("nan")) == 0.0

def test_safe_float_inf():
    assert safe_float(float("inf")) == 0.0

def test_safe_float_string():
    assert safe_float("invalid") == 0.0


# ── detect_supports_resistances ───────────────────────────────────────────────

def test_supports_resistances_basic():
    highs  = [100, 105, 103, 108, 104, 106, 103, 107, 102, 105, 103]
    lows   = [98,   99, 100,  97,  99,  98, 100,  96,  99,  98, 100]
    closes = [99,  102, 101, 104, 102, 103, 101, 104, 101, 102, 101]
    highs  = [float(x) for x in highs]
    lows   = [float(x) for x in lows]
    closes = [float(x) for x in closes]
    supports, resistances = detect_supports_resistances(highs, lows, closes)
    assert isinstance(supports, list)
    assert isinstance(resistances, list)


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
