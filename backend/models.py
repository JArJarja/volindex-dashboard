# models.py
from pydantic import BaseModel
from typing import Optional

class TopRow(BaseModel):
    symbol: str
    name: str
    price: float
    change_pct: float
    volume: float
    realized_vol: float
    vol_volume_score: float
    bias: str           # haussier | baissier | neutre
    confidence: int     # 0-100
    updated_at: str

class Candle(BaseModel):
    t: int
    o: float
    h: float
    l: float
    c: float
    v: float

class MACDData(BaseModel):
    line: float
    signal: float
    hist: float

class Indicators(BaseModel):
    ma20: Optional[float] = None
    ema20: Optional[float] = None
    rsi14: Optional[float] = None
    atr14: Optional[float] = None
    macd: Optional[MACDData] = None

class Diagnostic(BaseModel):
    trend: str
    momentum: str
    volatility: str
    supports: list[float]
    resistances: list[float]
    scenarios: list[str]

class Detail(BaseModel):
    symbol: str
    name: str
    price: float
    change_pct: float
    candles: list[Candle]
    indicators: Indicators
    diagnostic: Diagnostic
    updated_at: str

class Report(BaseModel):
    generated_at: str
    window_minutes: int
    market_summary: str
    top_movers: list[TopRow]
    top_vol_volume: list[TopRow]
    anomalies: list[str]
    risks: list[str]
