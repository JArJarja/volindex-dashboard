# quant.py — plan gratuit : Finnhub /quote pour ETFs, CoinGecko pour crypto
import time, math, asyncio
import numpy as np
from models import TopRow, Detail, Candle, Indicators, MACDData, Diagnostic
from finnhub_client import FinnhubClient

def sf(v, d=0.0):
    try:
        f = float(v)
        return f if math.isfinite(f) else d
    except (TypeError, ValueError):
        return d

safe_float = sf

def clean(v, ndigits=4):
    if v is None:
        return None
    try:
        f = float(v)
        return round(f if math.isfinite(f) else 0.0, ndigits)
    except (TypeError, ValueError):
        return None

def log_returns(closes):
    if len(closes) < 2:
        return []
    return [math.log(closes[i]/closes[i-1]) for i in range(1,len(closes)) if closes[i-1]>0]

def realized_vol(closes):
    rets = log_returns(closes)
    if len(rets) < 2:
        return 0.0
    v = float(np.std(rets, ddof=1))
    return v if math.isfinite(v) else 0.0

def zscore_normalize(values):
    arr = np.array(values, dtype=float)
    arr = np.where(np.isfinite(arr), arr, 0.0)
    if arr.std() == 0:
        return [0.0]*len(values)
    z = (arr - arr.mean()) / arr.std()
    return [float(x) if math.isfinite(x) else 0.0 for x in z]

def simple_ma(closes, period):
    if len(closes) < period:
        return None
    v = float(np.mean(closes[-period:]))
    return v if math.isfinite(v) else None

def ema(closes, period):
    if len(closes) < period:
        return None
    k = 2/(period+1)
    val = float(np.mean(closes[:period]))
    for c in closes[period:]:
        val = c*k + val*(1-k)
    return val if math.isfinite(val) else None

def rsi(closes, period=14):
    if len(closes) < period+1:
        return None
    rets = [closes[i]-closes[i-1] for i in range(1,len(closes))]
    gains  = [max(r,0) for r in rets[-period:]]
    losses = [abs(min(r,0)) for r in rets[-period:]]
    avg_g = sum(gains)/period
    avg_l = sum(losses)/period
    if avg_l == 0:
        return 100.0
    v = 100 - (100/(1+avg_g/avg_l))
    return v if math.isfinite(v) else None

def atr(highs, lows, closes, period=14):
    if len(closes) < period+1:
        return None
    trs = [max(highs[i]-lows[i], abs(highs[i]-closes[i-1]), abs(lows[i]-closes[i-1]))
           for i in range(1,len(closes))]
    v = float(np.mean(trs[-period:]))
    return v if math.isfinite(v) else None

def macd_calc(closes):
    if len(closes) < 35:
        return None
    fast = ema(closes,12); slow = ema(closes,26)
    if fast is None or slow is None:
        return None
    line = fast-slow
    ms = []
    for i in range(26,len(closes)+1):
        f=ema(closes[:i],12); s=ema(closes[:i],26)
        if f and s: ms.append(f-s)
    signal = ema(ms,9) if len(ms)>=9 else None
    if signal is None:
        return None
    return line, signal, line-signal

def detect_supports_resistances(highs, lows, closes, n=3):
    price = closes[-1] if closes else 0.0
    ph, pl = [], []
    for i in range(n, len(highs)-n):
        if all(highs[i]>=highs[i-j] and highs[i]>=highs[i+j] for j in range(1,n+1)):
            ph.append(highs[i])
        if all(lows[i]<=lows[i-j] and lows[i]<=lows[i+j] for j in range(1,n+1)):
            pl.append(lows[i])
    sup = sorted(set(round(l,2) for l in pl if l<price), reverse=True)[:3]
    res = sorted(set(round(h,2) for h in ph if h>price))[:3]
    return sup, res

def compute_bias(closes, ma20, rsi_val, macd_res):
    if not closes or len(closes)<5:
        return "neutre", 0
    price = closes[-1]
    score, signals = 0, 0
    if ma20 and math.isfinite(ma20):
        signals+=1
        if price>ma20*1.002: score+=1
        elif price<ma20*0.998: score-=1
    if len(closes)>=10:
        signals+=1
        slope = closes[-1]-closes[-5]
        if slope>0: score+=1
        elif slope<0: score-=1
    if len(closes)>=10:
        signals+=1
        h10=closes[-10:]
        if h10[-1]>max(h10[:-1]): score+=1
        elif h10[-1]<min(h10[:-1]): score-=1
    if rsi_val is not None and math.isfinite(rsi_val):
        signals+=1
        if rsi_val>55: score+=1
        elif rsi_val<45: score-=1
    if macd_res is not None:
        signals+=1
        if macd_res[2]>0: score+=1
        elif macd_res[2]<0: score-=1
    if signals==0:
        return "neutre", 0
    ratio = score/signals
    conf  = int(abs(ratio)*100)
    if ratio>0.2: return "haussier", conf
    elif ratio<-0.2: return "baissier", conf
    else: return "neutre", conf

async def safe_quote(client, symbol):
    try:
        return await client.quote(symbol)
    except Exception:
        return None

async def fetch_candle_data(client, symbol, window_minutes, resolution):
    to_ts = int(time.time())
    from_ts = to_ts - window_minutes*60
    try:
        data = await client.candles(symbol, resolution, from_ts, to_ts)
        if data.get("s")=="ok" and data.get("c"):
            return data
    except Exception as e:
        print(f"[candle error] {symbol}: {e}")
    return None

def quote_to_row(meta, q, now_str):
    """Convertit un dict quote (Finnhub ou CoinGecko normalisé) en TopRow.
    Garde les instruments hors session (price=0) en utilisant le prev close.
    """
    price = sf(q.get("c"))
    prev  = sf(q.get("pc"))
    high  = sf(q.get("h"))
    low   = sf(q.get("l"))
    opn   = sf(q.get("o"))

    # Marché fermé : price=0 mais prev close disponible
    if price <= 0 and prev > 0:
        price = prev  # utiliser le dernier prix connu
    if prev <= 0 and price > 0:
        prev = price
    # Aucune donnée du tout
    if price <= 0 and prev <= 0:
        return None, None, None

    change_pct = (price-prev)/prev*100 if prev > 0 else 0.0
    if not math.isfinite(change_pct):
        change_pct = 0.0
    abs_chg   = abs(change_pct)
    day_range = (high-low)/price if price>0 and (high-low)>=0 else 0.0
    if not math.isfinite(day_range):
        day_range = 0.0
    return change_pct, abs_chg, day_range

async def compute_scores(client, universe, window_minutes=60, resolution="1"):
    now_str = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())

    # Séparer crypto et ETFs
    from crypto_client import CryptoClient, COINGECKO_IDS
    from cache import TTLCache
    crypto_client = CryptoClient(client.cache)

    crypto_syms = [u["symbol"] for u in universe if crypto_client.is_crypto(u["symbol"])]
    etf_universe = [u for u in universe if not crypto_client.is_crypto(u["symbol"])]

    # Fetch crypto (CoinGecko, 1 seul appel)
    crypto_quotes = {}
    if crypto_syms:
        crypto_quotes = await crypto_client.get_prices(crypto_syms)

    # Fetch ETFs (Finnhub, par batch)
    etf_quotes = {}
    batch_size = 10
    for i in range(0, len(etf_universe), batch_size):
        batch = etf_universe[i:i+batch_size]
        results = await asyncio.gather(*[safe_quote(client, u["symbol"]) for u in batch])
        for u, q in zip(batch, results):
            if q:
                etf_quotes[u["symbol"]] = q
        await asyncio.sleep(0.1)

    # Combiner — inclure TOUS les instruments, même hors session
    entries, abs_chg_list, range_list = [], [], []
    for meta in universe:
        sym = meta["symbol"]
        q = crypto_quotes.get(sym) or etf_quotes.get(sym)

        if not q:
            # Pas de quote du tout — ajouter quand même avec valeurs nulles
            entries.append({
                "meta": meta, "price": 0.0, "prev": 0.0,
                "change_pct": 0.0, "abs_chg": 0.0, "day_range": 0.0,
                "opn": 0.0, "high": 0.0, "low": 0.0,
            })
            abs_chg_list.append(0.0)
            range_list.append(0.0)
            continue

        price = sf(q.get("c"))
        prev  = sf(q.get("pc"))
        high  = sf(q.get("h"))
        low   = sf(q.get("l"))
        opn   = sf(q.get("o"))

        # Marché fermé : utiliser prev close si price=0
        if price <= 0 and prev > 0:
            price = prev
        if prev <= 0 and price > 0:
            prev = price

        change_pct = (price - prev) / prev * 100 if prev > 0 else 0.0
        if not math.isfinite(change_pct):
            change_pct = 0.0
        abs_chg   = abs(change_pct)
        day_range = (high - low) / price if price > 0 and (high - low) >= 0 else 0.0
        if not math.isfinite(day_range):
            day_range = 0.0

        abs_chg_list.append(abs_chg)
        range_list.append(day_range)
        entries.append({
            "meta": meta, "price": price, "prev": prev,
            "change_pct": change_pct, "abs_chg": abs_chg,
            "day_range": day_range, "opn": opn, "high": high, "low": low,
        })

    if not entries:
        return []

    chg_z   = zscore_normalize(abs_chg_list)
    range_z = zscore_normalize(range_list)

    rows = []
    for idx, entry in enumerate(entries):
        score = sf(chg_z[idx])*0.6 + sf(range_z[idx])*0.4 + 5.0
        score = max(0.0, score) if math.isfinite(score) else 5.0
        chg   = entry["change_pct"]
        if chg>0.3 and entry["price"]>=entry["opn"]:
            bias, conf = "haussier", min(100,int(abs(chg)*15))
        elif chg<-0.3 and entry["price"]<=entry["opn"]:
            bias, conf = "baissier", min(100,int(abs(chg)*15))
        else:
            bias, conf = "neutre", min(100,int(abs(chg)*8))

        rows.append(TopRow(
            symbol=entry["meta"]["symbol"],
            name=entry["meta"]["name"],
            price=round(entry["price"],4),
            change_pct=round(chg,2),
            volume=round(entry["abs_chg"],4),
            realized_vol=round(entry["day_range"],6),
            vol_volume_score=round(score,4),
            bias=bias, confidence=conf,
            updated_at=now_str,
        ))
    return rows

async def compute_detail(client, symbol, name, window_minutes=60, resolution="5"):
    now_str = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())

    from crypto_client import CryptoClient
    crypto_client = CryptoClient(client.cache)

    # Récupérer le quote selon la source
    if crypto_client.is_crypto(symbol):
        prices = await crypto_client.get_prices([symbol])
        qdata  = prices.get(symbol)
        cdata  = None
    else:
        cdata, qdata = await asyncio.gather(
            fetch_candle_data(client, symbol, window_minutes, resolution),
            safe_quote(client, symbol),
        )

    candles = []
    closes, highs, lows, volumes = [], [], [], []

    if cdata:
        ts_list = cdata.get("t",[])
        for i in range(len(ts_list)):
            oc = sf(cdata["c"][i] if i<len(cdata.get("c",[])) else 0)
            oh = sf(cdata["h"][i] if i<len(cdata.get("h",[])) else 0)
            ol = sf(cdata["l"][i] if i<len(cdata.get("l",[])) else 0)
            oo = sf(cdata["o"][i] if i<len(cdata.get("o",[])) else 0)
            ov = sf(cdata["v"][i] if i<len(cdata.get("v",[])) else 0)
            candles.append(Candle(t=int(ts_list[i]),o=oo,h=oh,l=ol,c=oc,v=ov))
            closes.append(oc); highs.append(oh); lows.append(ol); volumes.append(ov)

    price = sf(qdata.get("c")) if qdata else (closes[-1] if closes else 0.0)
    prev  = sf(qdata.get("pc")) if qdata else (closes[0] if closes else price)

    # Bougies synthétiques depuis quote
    if not candles and qdata:
        h = sf(qdata.get("h")); l = sf(qdata.get("l")); o = sf(qdata.get("o"))
        if o==0: o = price
        t = int(time.time())
        for step in range(4):
            frac  = step/4
            synth = o+(price-o)*(step+1)/4 if price!=o else price
            candles.append(Candle(t=t-(3-step)*3600, o=o+(price-o)*frac, h=h, l=l, c=synth, v=0))
            closes.append(synth); highs.append(h); lows.append(l); volumes.append(0)

    change_pct = ((price-prev)/prev*100) if prev else 0.0
    if not math.isfinite(change_pct):
        change_pct = 0.0

    ma20_val  = simple_ma(closes, min(20,len(closes)))
    ema20_val = ema(closes, min(20,len(closes)))
    rsi_val   = rsi(closes) if len(closes)>15 else None
    atr_val   = atr(highs,lows,closes) if len(closes)>15 else None
    macd_res  = macd_calc(closes) if len(closes)>=35 else None

    indicators = Indicators(
        ma20=clean(ma20_val),
        ema20=clean(ema20_val),
        rsi14=clean(rsi_val,2),
        atr14=clean(atr_val),
        macd=MACDData(
            line=clean(macd_res[0]),
            signal=clean(macd_res[1]),
            hist=clean(macd_res[2]),
        ) if macd_res else None,
    )

    bias, confidence = compute_bias(closes, ma20_val, rsi_val, macd_res)

    if qdata:
        h_day = sf(qdata.get("h")); l_day = sf(qdata.get("l"))
        supports    = [round(l_day,2)] if l_day>0 and l_day<price else []
        resistances = [round(h_day,2)] if h_day>price else []
        rng_pct = (h_day-l_day)/price*100 if price>0 else 0
        vol_label = ("très élevée" if rng_pct>3 else "élevée" if rng_pct>1.5
                     else "modérée" if rng_pct>0.5 else "faible")
    else:
        supports, resistances = detect_supports_resistances(highs,lows,closes) if len(closes)>=10 else ([],[])
        rv = realized_vol(closes)
        vol_label = ("très élevée" if rv>0.03 else "élevée" if rv>0.015
                     else "modérée" if rv>0.005 else "faible")

    if rsi_val is None:       momentum = "neutre"
    elif rsi_val>70:          momentum = "suracheté"
    elif rsi_val<30:          momentum = "survendu"
    elif rsi_val>55:          momentum = "haussier"
    elif rsi_val<45:          momentum = "baissier"
    else:                     momentum = "neutre"

    scenarios = []
    if resistances:
        scenarios.append(f"Si cassure au-dessus de {resistances[0]} -> biais haussier renforcé")
    if supports:
        scenarios.append(f"Si retour sous {supports[0]} -> biais baissier renforcé")
    if rsi_val and rsi_val>65:
        scenarios.append("RSI en zone haute : surveiller un potentiel retournement de momentum")
    if rsi_val and rsi_val<35:
        scenarios.append("RSI en zone basse : surveiller un rebond de momentum")
    scenarios.append(f"Variation de {change_pct:+.2f}% vs clôture précédente : surveiller la continuité")

    return Detail(
        symbol=symbol, name=name,
        price=round(price,4),
        change_pct=round(change_pct,2),
        candles=candles[-200:],
        indicators=indicators,
        diagnostic=Diagnostic(
            trend=bias, momentum=momentum, volatility=vol_label,
            supports=supports, resistances=resistances, scenarios=scenarios,
        ),
        updated_at=now_str,
    )
