import os
"""
Finnhub Market Dashboard — FastAPI Backend
Outil d'analyse de marché informatif. Ne constitue pas un conseil en investissement.
"""
import asyncio
import time
import json
import csv
import io
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException, Query, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse

from config import settings
from cache import TTLCache
from finnhub_client import FinnhubClient
from quant import compute_scores, compute_detail
from models import TopRow, Detail, Report
from ws_server import WSManager
from alert_engine import AlertEngine
from history_client import HistoryClient
from fmp_client import FMPClient
from yahoo_client import YahooClient
from valuation_client import ValuationClient

# ── Singletons ────────────────────────────────────────────────────────────────
cache         = TTLCache(default_ttl=8)
ws_manager    = WSManager()
finnhub       = FinnhubClient(settings.finnhub_api_key, cache)
alert_engine  = AlertEngine()
history_client= HistoryClient(settings.finnhub_api_key, cache)
# Lire FMP_API_KEY depuis settings (lu depuis .env via pydantic-settings)
_fmp_key = settings.fmp_api_key or os.environ.get("FMP_API_KEY","")
fmp_client    = FMPClient(_fmp_key, cache)
yahoo_client      = YahooClient(cache)
valuation_client  = ValuationClient(cache)
if _fmp_key:
    print(f"[FMP] Cle configuree : {_fmp_key[:8]}...")
else:
    print("[FMP] Cle non configuree — ajoutez FMP_API_KEY dans backend/.env")

def load_universe() -> list[dict]:
    with open("indices_universe.json") as f:
        return json.load(f)

# ── Background tasks ──────────────────────────────────────────────────────────

async def background_refresh():
    """Rafraîchit le top toutes les 20s, broadcast WS, et vérifie les alertes."""
    while True:
        try:
            universe = load_universe()
            rows = await compute_scores(finnhub, universe, window_minutes=60, resolution="1")
            rows_sorted = sorted(rows, key=lambda r: r.vol_volume_score, reverse=True)[:50]
            await ws_manager.broadcast({
                "type": "top_update",
                "data": [r.dict() for r in rows_sorted],
            })

            # Vérifier alertes depuis les quotes (pas de candles = compatible plan gratuit)
            for row in rows_sorted[:5]:
                try:
                    # Utiliser les données du quote déjà récupéré (price + change_pct)
                    # Les supports/résistances sont approximés depuis le range journalier
                    from finnhub_client import FinnhubClient
                    q = await finnhub.quote(row.symbol) if not row.symbol.startswith("BINANCE:") else None
                    if q:
                        h = float(q.get("h") or 0)
                        l = float(q.get("l") or 0)
                        p = float(q.get("c") or 0)
                        supports = [round(l, 4)] if l > 0 and l < p else []
                        resistances = [round(h, 4)] if h > p else []
                        alert_engine.update_levels(
                            symbol=row.symbol,
                            name=row.name,
                            price=p,
                            supports=supports,
                            resistances=resistances,
                        )
                except Exception:
                    pass

        except asyncio.CancelledError:
            break
        except Exception as e:
            print(f"[BG refresh error] {e}")

        try:
            await asyncio.sleep(45)
        except asyncio.CancelledError:
            break

# ── Lifespan ──────────────────────────────────────────────────────────────────

@asynccontextmanager
async def lifespan(app: FastAPI):
    task = asyncio.create_task(background_refresh())
    yield
    task.cancel()
    try:
        await asyncio.wait_for(asyncio.shield(task), timeout=2.0)
    except (asyncio.CancelledError, asyncio.TimeoutError):
        pass

# ── App ───────────────────────────────────────────────────────────────────────

app = FastAPI(
    title="Finnhub Dashboard API",
    description="Outil d'analyse de marché. Ne constitue pas un conseil en investissement.",
    lifespan=lifespan,
)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── Endpoints principaux ──────────────────────────────────────────────────────

@app.get("/api/top", response_model=list[TopRow])
async def get_top(
    window: int = Query(60, ge=5, le=480),
    resolution: str = Query("1"),
    limit: int = Query(50, ge=1, le=300),
):
    ck = f"top:{window}:{resolution}:{limit}"
    if cached := cache.get(ck):
        return cached
    universe = load_universe()
    rows = await compute_scores(finnhub, universe, window_minutes=window, resolution=resolution)
    rows_sorted = sorted(rows, key=lambda r: r.vol_volume_score, reverse=True)[:limit]
    cache.set(ck, rows_sorted, ttl=20)
    return rows_sorted


@app.get("/api/index/{symbol}", response_model=Detail)
async def get_detail(
    symbol: str,
    window: int = Query(60, ge=5, le=480),
    resolution: str = Query("5"),
):
    ck = f"detail:{symbol}:{window}:{resolution}"
    if cached := cache.get(ck):
        return cached
    universe = load_universe()
    meta = next((u for u in universe if u["symbol"] == symbol), None)
    name = meta["name"] if meta else symbol
    detail = await compute_detail(finnhub, symbol, name, window_minutes=window, resolution=resolution)
    cache.set(ck, detail, ttl=30)

    # Mettre à jour les niveaux d'alerte
    alert_engine.update_levels(
        symbol=symbol,
        name=name,
        price=detail.price,
        supports=detail.diagnostic.supports,
        resistances=detail.diagnostic.resistances,
    )
    return detail


@app.get("/api/report/latest", response_model=Report)
async def get_report(window: int = Query(60, ge=5, le=480)):
    ck = f"report:{window}"
    if cached := cache.get(ck):
        return cached
    universe = load_universe()
    rows = await compute_scores(finnhub, universe, window_minutes=window, resolution="5")
    rows_sorted = sorted(rows, key=lambda r: r.vol_volume_score, reverse=True)
    bias_counts = {"haussier": 0, "baissier": 0, "neutre": 0}
    for r in rows_sorted:
        bias_counts[r.bias] = bias_counts.get(r.bias, 0) + 1
    anomalies = [f"{r.symbol} : signal fort (confiance {r.confidence})" for r in rows_sorted if r.confidence > 85]
    risks = [f"{r.symbol} : vol. élevée ({r.realized_vol:.2%})" for r in rows_sorted if r.realized_vol > 0.05]
    report = Report(
        generated_at=time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        window_minutes=window,
        market_summary=(
            f"Volatilité globale sur {window}min — "
            f"{bias_counts['haussier']} haussiers, "
            f"{bias_counts['baissier']} baissiers, "
            f"{bias_counts['neutre']} neutres."
        ),
        top_movers=rows_sorted[:10],
        top_vol_volume=rows_sorted[:10],
        anomalies=anomalies[:10],
        risks=risks[:10],
    )
    cache.set(ck, report, ttl=30)
    return report


@app.get("/api/report/export/{fmt}")
async def export_report(fmt: str, window: int = Query(60)):
    if fmt not in ("json", "csv"):
        raise HTTPException(400, "Format must be json or csv")
    universe = load_universe()
    rows = await compute_scores(finnhub, universe, window_minutes=window, resolution="5")
    rows_sorted = sorted(rows, key=lambda r: r.vol_volume_score, reverse=True)
    if fmt == "json":
        content = json.dumps([r.dict() for r in rows_sorted], indent=2, default=str)
        return StreamingResponse(io.StringIO(content), media_type="application/json",
                                 headers={"Content-Disposition": "attachment; filename=report.json"})
    output = io.StringIO()
    if rows_sorted:
        writer = csv.DictWriter(output, fieldnames=rows_sorted[0].dict().keys())
        writer.writeheader()
        writer.writerows([r.dict() for r in rows_sorted])
    output.seek(0)
    return StreamingResponse(output, media_type="text/csv",
                             headers={"Content-Disposition": "attachment; filename=report.csv"})

# ── Alertes ───────────────────────────────────────────────────────────────────

@app.get("/api/alerts")
async def get_alerts():
    """Dernières alertes de franchissement déclenchées."""
    return {
        "alerts": alert_engine.get_recent_alerts(20),
        "email_enabled": alert_engine.enabled,
        "email_to": alert_engine._email_cfg["to"] if alert_engine.enabled else "",
    }

@app.get("/api/alerts/test")
async def test_alert():
    """Envoie un email de test pour vérifier la configuration."""
    if not alert_engine.enabled:
        raise HTTPException(400, "Email non configuré. Définissez ALERT_EMAIL_FROM, ALERT_EMAIL_TO, ALERT_EMAIL_PASS.")
    from alert_engine import PriceLevel
    test_lv = PriceLevel("BTC", "Bitcoin (test)", 80000.0, "resistance", 79900.0)
    test_lv.triggered_at = time.time()
    await alert_engine._send_email(test_lv, 80050.0, "haussier ↗")
    return {"status": "ok", "message": f"Email de test envoyé à {alert_engine._email_cfg['to']}"}

# ── Historique & Calendrier ───────────────────────────────────────────────────

@app.get("/api/index/{symbol}/history48")
async def get_history_48h(symbol: str):
    ck = f"h48:{symbol}"
    if cached := cache.get(ck): return cached
    data = await history_client.get_prices_48h(symbol)
    cache.set(ck, data, ttl=300)
    return data

@app.get("/api/index/{symbol}/earnings")
async def get_earnings(symbol: str):
    ck = f"earn3:{symbol}"
    if cached := cache.get(ck): return cached
    if symbol.startswith("BINANCE:"):
        data = []
    else:
        # Yahoo Finance — gratuit, pas de clé requise
        data = await yahoo_client.get_earnings(symbol)
        if not data:
            data = await history_client.get_earnings(symbol)
    cache.set(ck, data, ttl=3600)
    return data

@app.get("/api/index/{symbol}/dividends")
async def get_dividends(symbol: str):
    ck = f"div3:{symbol}"
    if cached := cache.get(ck): return cached
    if symbol.startswith("BINANCE:"):
        data = []
    else:
        # Yahoo Finance — gratuit, pas de clé requise
        data = await yahoo_client.get_dividends(symbol)
        if not data:
            data = await history_client.get_dividends(symbol)
    cache.set(ck, data, ttl=3600)
    return data


@app.get("/api/index/{symbol}/news")
async def get_news(symbol: str):
    ck = f"news2:{symbol}"
    if cached := cache.get(ck): return cached
    if fmp_client.enabled and not symbol.startswith("BINANCE:"):
        data = await fmp_client.get_news(symbol)
        if not data:  # fallback Finnhub
            data = await history_client.get_news(symbol)
    else:
        data = await history_client.get_news(symbol)
    cache.set(ck, data, ttl=600)
    return data

@app.get("/api/index/{symbol}/consensus")
async def get_consensus(symbol: str):
    ck = f"cons2:{symbol}"
    if cached := cache.get(ck): return cached
    if fmp_client.enabled and not symbol.startswith("BINANCE:"):
        data = await fmp_client.get_analyst_consensus(symbol)
    else:
        data = await history_client.get_consensus(symbol)
    cache.set(ck, data, ttl=3600)
    return data

@app.get("/api/index/{symbol}/sentiment")
async def get_sentiment(symbol: str):
    ck = f"sent:{symbol}"
    if cached := cache.get(ck): return cached
    if fmp_client.enabled and not symbol.startswith("BINANCE:"):
        data = await fmp_client.get_market_sentiment(symbol)
    else:
        data = await history_client.get_consensus(symbol)
    cache.set(ck, data, ttl=3600)
    return data

@app.get("/api/index/{symbol}/valuation")
async def get_valuation(symbol: str):
    ck = f"val:{symbol}"
    if cached := cache.get(ck): return cached
    if symbol.startswith("BINANCE:"):
        return {"available": False, "reason": "Non applicable aux cryptomonnaies"}
    detail_ck = f"detail:{symbol}:60:5"
    price = 0.0
    if detail := cache.get(detail_ck):
        try: price = detail.price
        except: price = detail.get("price", 0.0) if isinstance(detail, dict) else 0.0
    data = await valuation_client.compute_valuation(symbol, price)
    cache.set(ck, data, ttl=3600)
    return data

@app.get("/api/index/{symbol}/valuation")
async def get_valuation(symbol: str):
    ck = f"val:{symbol}"
    if cached := cache.get(ck): return cached
    if symbol.startswith("BINANCE:"):
        return {"available": False, "reason": "Non applicable aux cryptomonnaies"}
    # Recuperer le prix actuel depuis le cache detail
    price = 0.0
    for res in ["1","5"]:
        for win in [60, 30]:
            detail = cache.get(f"detail:{symbol}:{win}:{res}")
            if detail:
                try:
                    price = detail.price if hasattr(detail,"price") else detail.get("price",0.0)
                    if price > 0: break
                except: pass
        if price > 0: break
    data = await valuation_client.compute_valuation(symbol, price)
    cache.set(ck, data, ttl=3600)
    return data

# ── WebSocket ─────────────────────────────────────────────────────────────────

@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await ws_manager.connect(websocket)
    try:
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        ws_manager.disconnect(websocket)
