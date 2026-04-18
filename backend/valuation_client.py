# valuation_client.py
"""
Calcul de valorisation fondamentale des actions.
Sources : Yahoo Finance (gratuit, pas de clé requise)
Méthodes : DCF simplifié, PER, DDM, P/B, Score global
"""
import asyncio, time, math
import httpx
from cache import TTLCache

def sf(v, d=0.0):
    try:
        f = float(v)
        return f if math.isfinite(f) else d
    except: return d

# Taux sans risque (OAT 10 ans France / T-Bond US) — approximation avril 2026
RISK_FREE_RATE = 0.035   # 3.5%
MARKET_PREMIUM = 0.055   # Prime de risque marché historique ~5.5%

# PER médians par secteur (source : données historiques)
SECTOR_PER = {
    "technology": 28.0, "healthcare": 22.0, "financial": 13.0,
    "energy": 12.0, "consumer": 18.0, "industrial": 17.0,
    "materials": 15.0, "utilities": 16.0, "realestate": 20.0,
    "default": 18.0,
}

YF_MAP = {
    "OR.PA":"OR.PA","MC.PA":"MC.PA","TTE.PA":"TTE.PA","SAN.PA":"SAN.PA",
    "AIR.PA":"AIR.PA","BNP.PA":"BNP.PA","SU.PA":"SU.PA","HO.PA":"HO.PA",
    "SAF.PA":"SAF.PA","AI.PA":"AI.PA","DG.PA":"DG.PA","RI.PA":"RI.PA",
    "CAP.PA":"CAP.PA","BN.PA":"BN.PA","DSY.PA":"DSY.PA","CS.PA":"CS.PA",
    "GLE.PA":"GLE.PA","RMS.PA":"RMS.PA","EL.PA":"EL.PA","KER.PA":"KER.PA",
}

class ValuationClient:
    def __init__(self, cache: TTLCache):
        self.cache = cache
        self._client = httpx.AsyncClient(
            timeout=15,
            headers={"User-Agent":"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"}
        )
        self._last_call = 0.0

    def _sym(self, symbol: str) -> str:
        return YF_MAP.get(symbol, symbol)

    async def _get(self, url: str, params: dict = {}, ttl: int = 3600):
        ck = f"val:{url}:{sorted(params.items())}"
        if c := self.cache.get(ck): return c
        elapsed = time.monotonic() - self._last_call
        if elapsed < 1.5:
            await asyncio.sleep(1.5 - elapsed)
        self._last_call = time.monotonic()
        try:
            r = await self._client.get(url, params=params)
            r.raise_for_status()
            data = r.json()
            self.cache.set(ck, data, ttl=ttl)
            return data
        except Exception as e:
            print(f"[Valuation] {e}")
            return None

    async def get_fundamentals(self, symbol: str) -> dict:
        """Récupère tous les fondamentaux depuis Yahoo Finance."""
        sym = self._sym(symbol)
        url = f"https://query1.finance.yahoo.com/v10/finance/quoteSummary/{sym}"
        data = await self._get(url, {
            "modules": "summaryDetail,defaultKeyStatistics,financialData,incomeStatementHistory,cashflowStatementHistory,balanceSheetHistory",
            "formatted": "false",
        }, ttl=3600)
        if not data: return {}
        try:
            return data["quoteSummary"]["result"][0]
        except:
            return {}

    async def compute_valuation(self, symbol: str, current_price: float) -> dict:
        """Calcule la valorisation fondamentale complète."""
        if symbol.startswith("BINANCE:"):
            return {"available": False, "reason": "Valorisation fondamentale non applicable aux cryptomonnaies"}

        fd = await self.get_fundamentals(symbol)
        if not fd:
            return {"available": False, "reason": "Données fondamentales non disponibles"}

        sd  = fd.get("summaryDetail", {})
        ks  = fd.get("defaultKeyStatistics", {})
        fin = fd.get("financialData", {})
        ish = fd.get("incomeStatementHistory", {}).get("incomeStatementHistory", [{}])
        cfh = fd.get("cashflowStatementHistory", {}).get("cashflowStatements", [{}])
        bsh = fd.get("balanceSheetHistory", {}).get("balanceSheetStatements", [{}])

        # ── Données de base ───────────────────────────────────────────────────
        price       = current_price if current_price > 0 else sf(sd.get("previousClose", {}).get("raw") or sd.get("regularMarketPrice", {}).get("raw"))
        eps         = sf(ks.get("trailingEps", {}).get("raw"))
        eps_fwd     = sf(ks.get("forwardEps", {}).get("raw"))
        per         = sf(sd.get("trailingPE", {}).get("raw"))
        per_fwd     = sf(sd.get("forwardPE", {}).get("raw"))
        pbv         = sf(ks.get("priceToBook", {}).get("raw"))
        bvps        = sf(ks.get("bookValue", {}).get("raw"))
        div_yield   = sf(sd.get("dividendYield", {}).get("raw"))
        div_rate    = sf(sd.get("dividendRate", {}).get("raw"))
        payout      = sf(ks.get("payoutRatio", {}).get("raw"))
        beta        = sf(sd.get("beta", {}).get("raw"), 1.0)
        roe         = sf(fin.get("returnOnEquity", {}).get("raw"))
        roa         = sf(fin.get("returnOnAssets", {}).get("raw"))
        profit_mg   = sf(fin.get("profitMargins", {}).get("raw"))
        rev_growth  = sf(fin.get("revenueGrowth", {}).get("raw"))
        earn_growth = sf(fin.get("earningsGrowth", {}).get("raw"))
        debt_equity = sf(fin.get("debtToEquity", {}).get("raw"))
        curr_ratio  = sf(fin.get("currentRatio", {}).get("raw"))
        market_cap  = sf(ks.get("enterpriseValue", {}).get("raw") or sd.get("marketCap", {}).get("raw"))
        shares_out  = sf(ks.get("sharesOutstanding", {}).get("raw"))
        peg_ratio   = sf(ks.get("pegRatio", {}).get("raw"))
        ev_ebitda   = sf(ks.get("enterpriseToEbitda", {}).get("raw"))
        ev_revenue  = sf(ks.get("enterpriseToRevenue", {}).get("raw"))

        # Free cash flow par action
        fcf_total = sf(fin.get("freeCashflow", {}).get("raw"))
        fcf_ps = fcf_total / shares_out if shares_out > 0 and fcf_total else 0

        # WACC simplifié avec CAPM
        cost_equity = RISK_FREE_RATE + beta * MARKET_PREMIUM
        # Coût de la dette approximé
        cost_debt = 0.04  # hypothèse
        debt_ratio = min(debt_equity / (debt_equity + 100), 0.7) if debt_equity > 0 else 0.2
        wacc = cost_equity * (1 - debt_ratio) + cost_debt * 0.75 * debt_ratio  # 75% = 1-taux_impôt

        results = {}

        # ── 1. Méthode PER ────────────────────────────────────────────────────
        if eps > 0:
            # PER sectoriel (défaut 18)
            per_cible = SECTOR_PER.get("default", 18.0)
            valeur_per = eps * per_cible
            valeur_per_fwd = eps_fwd * per_cible if eps_fwd > 0 else 0
            results["per"] = {
                "methode": "PER (Price/Earnings)",
                "valeur_intrinsèque": round(valeur_per, 2),
                "valeur_forward": round(valeur_per_fwd, 2) if valeur_per_fwd else None,
                "per_actuel": round(per, 2) if per else None,
                "per_forward": round(per_fwd, 2) if per_fwd else None,
                "per_cible_secteur": per_cible,
                "eps_ttm": round(eps, 4),
                "eps_forward": round(eps_fwd, 4) if eps_fwd else None,
                "ecart_pct": round((valeur_per - price) / price * 100, 1) if price else 0,
                "interpretation": "sous-evalué" if valeur_per > price * 1.1 else "surévalué" if valeur_per < price * 0.9 else "juste valeur",
            }

        # ── 2. DCF simplifié (Gordon Growth + FCF) ───────────────────────────
        g_court  = max(0, min(earn_growth if earn_growth else rev_growth, 0.25))  # croissance CT plafonnée à 25%
        g_long   = min(g_court * 0.4, 0.04)  # croissance LT max 4%

        if fcf_ps > 0 and wacc > g_long:
            # DCF 5 ans + valeur terminale
            dcf_value = 0
            fcf = fcf_ps
            for yr in range(1, 6):
                fcf *= (1 + g_court)
                dcf_value += fcf / (1 + wacc) ** yr
            # Valeur terminale Gordon
            terminal = (fcf * (1 + g_long)) / (wacc - g_long)
            terminal_pv = terminal / (1 + wacc) ** 5
            dcf_total = dcf_value + terminal_pv
            results["dcf"] = {
                "methode": "DCF (Discounted Cash Flow)",
                "valeur_intrinsèque": round(dcf_total, 2),
                "fcf_par_action": round(fcf_ps, 4),
                "wacc": round(wacc * 100, 2),
                "croissance_court_terme": round(g_court * 100, 1),
                "croissance_long_terme": round(g_long * 100, 1),
                "valeur_terminale_pv": round(terminal_pv, 2),
                "ecart_pct": round((dcf_total - price) / price * 100, 1) if price else 0,
                "interpretation": "sous-evalué" if dcf_total > price * 1.1 else "surévalué" if dcf_total < price * 0.9 else "juste valeur",
            }

        # ── 3. DDM (Dividend Discount Model) ─────────────────────────────────
        if div_rate > 0 and div_yield > 0:
            g_div = min(roe * (1 - payout) if roe > 0 and payout > 0 else 0.03, 0.06)
            if cost_equity > g_div:
                ddm_value = div_rate * (1 + g_div) / (cost_equity - g_div)
                results["ddm"] = {
                    "methode": "DDM (Dividend Discount Model)",
                    "valeur_intrinsèque": round(ddm_value, 2),
                    "dividende_annuel": round(div_rate, 4),
                    "rendement_dividende": round(div_yield * 100, 2),
                    "taux_distribution": round(payout * 100, 1) if payout else None,
                    "croissance_dividende": round(g_div * 100, 2),
                    "cout_capitaux": round(cost_equity * 100, 2),
                    "ecart_pct": round((ddm_value - price) / price * 100, 1) if price else 0,
                    "interpretation": "sous-evalué" if ddm_value > price * 1.1 else "surévalué" if ddm_value < price * 0.9 else "juste valeur",
                }

        # ── 4. Price-to-Book ──────────────────────────────────────────────────
        if bvps > 0:
            # P/B juste = ROE / coût des capitaux propres
            pb_juste = roe / cost_equity if roe > 0 else 1.5
            valeur_pb = bvps * pb_juste
            results["pb"] = {
                "methode": "Price-to-Book (Valeur Comptable)",
                "valeur_intrinsèque": round(valeur_pb, 2),
                "valeur_comptable_ps": round(bvps, 2),
                "pb_actuel": round(pbv, 2) if pbv else None,
                "pb_juste": round(pb_juste, 2),
                "roe": round(roe * 100, 2) if roe else None,
                "ecart_pct": round((valeur_pb - price) / price * 100, 1) if price else 0,
                "interpretation": "sous-evalué" if valeur_pb > price * 1.1 else "surévalué" if valeur_pb < price * 0.9 else "juste valeur",
            }

        # ── 5. Score de qualité fondamentale ─────────────────────────────────
        score = 0
        facteurs = []

        if roe > 0.15:
            score += 2; facteurs.append(f"ROE élevé ({roe*100:.1f}%) — rentabilité forte")
        elif roe > 0.08:
            score += 1; facteurs.append(f"ROE correct ({roe*100:.1f}%)")
        elif roe > 0:
            facteurs.append(f"ROE faible ({roe*100:.1f}%)")

        if profit_mg > 0.20:
            score += 2; facteurs.append(f"Marge nette élevée ({profit_mg*100:.1f}%)")
        elif profit_mg > 0.08:
            score += 1; facteurs.append(f"Marge nette correcte ({profit_mg*100:.1f}%)")
        elif profit_mg > 0:
            facteurs.append(f"Marge nette faible ({profit_mg*100:.1f}%)")

        if rev_growth > 0.10:
            score += 2; facteurs.append(f"Croissance CA forte (+{rev_growth*100:.1f}%)")
        elif rev_growth > 0.03:
            score += 1; facteurs.append(f"Croissance CA modérée (+{rev_growth*100:.1f}%)")
        elif rev_growth < 0:
            score -= 1; facteurs.append(f"CA en baisse ({rev_growth*100:.1f}%)")

        if debt_equity > 0:
            if debt_equity < 50:
                score += 1; facteurs.append(f"Endettement faible (D/E {debt_equity:.0f}%)")
            elif debt_equity > 200:
                score -= 1; facteurs.append(f"Endettement élevé (D/E {debt_equity:.0f}%)")

        if curr_ratio > 1.5:
            score += 1; facteurs.append(f"Liquidité solide (ratio {curr_ratio:.1f})")
        elif curr_ratio < 1.0 and curr_ratio > 0:
            score -= 1; facteurs.append(f"Liquidité tendue (ratio {curr_ratio:.1f})")

        if div_yield > 0.02:
            score += 1; facteurs.append(f"Rendement dividende attractif ({div_yield*100:.1f}%)")

        if peg_ratio > 0 and peg_ratio < 1:
            score += 1; facteurs.append(f"PEG < 1 ({peg_ratio:.2f}) — croissance sous-valorisée")
        elif peg_ratio > 2:
            score -= 1; facteurs.append(f"PEG élevé ({peg_ratio:.2f}) — croissance surévaluée")

        quality_label = "Excellente" if score >= 7 else "Bonne" if score >= 4 else "Moyenne" if score >= 1 else "Faible"

        # ── Valeur intrinsèque consensus ──────────────────────────────────────
        valuations = []
        if "per" in results: valuations.append(results["per"]["valeur_intrinsèque"])
        if "dcf" in results: valuations.append(results["dcf"]["valeur_intrinsèque"])
        if "ddm" in results: valuations.append(results["ddm"]["valeur_intrinsèque"])
        if "pb"  in results: valuations.append(results["pb"]["valeur_intrinsèque"])

        consensus_value = sum(valuations) / len(valuations) if valuations else 0
        ecart_consensus = (consensus_value - price) / price * 100 if price and consensus_value else 0

        verdict = "Fortement sous-évalué" if ecart_consensus > 30 else \
                  "Sous-évalué" if ecart_consensus > 10 else \
                  "Légèrement sous-évalué" if ecart_consensus > 0 else \
                  "Légèrement surévalué" if ecart_consensus > -10 else \
                  "Surévalué" if ecart_consensus > -30 else \
                  "Fortement surévalué"

        return {
            "available": True,
            "symbol": symbol,
            "prix_marche": round(price, 2),
            "valeur_consensus": round(consensus_value, 2) if consensus_value else None,
            "ecart_consensus_pct": round(ecart_consensus, 1),
            "verdict": verdict,
            "qualite_fondamentale": quality_label,
            "score_qualite": score,
            "facteurs_qualite": facteurs,
            "methodes": results,
            "ratios": {
                "per_ttm":    round(per, 2) if per else None,
                "per_fwd":    round(per_fwd, 2) if per_fwd else None,
                "peg":        round(peg_ratio, 2) if peg_ratio else None,
                "pbv":        round(pbv, 2) if pbv else None,
                "ev_ebitda":  round(ev_ebitda, 2) if ev_ebitda else None,
                "ev_revenue": round(ev_revenue, 2) if ev_revenue else None,
                "roe":        round(roe * 100, 2) if roe else None,
                "roa":        round(roa * 100, 2) if roa else None,
                "marge_nette": round(profit_mg * 100, 2) if profit_mg else None,
                "croissance_ca": round(rev_growth * 100, 2) if rev_growth else None,
                "croissance_bnpa": round(earn_growth * 100, 2) if earn_growth else None,
                "dette_capitaux": round(debt_equity, 1) if debt_equity else None,
                "ratio_liquidite": round(curr_ratio, 2) if curr_ratio else None,
                "rendement_div": round(div_yield * 100, 2) if div_yield else None,
                "beta": round(beta, 2) if beta else None,
                "wacc": round(wacc * 100, 2),
            },
            "disclaimer": "Valorisation calculée sur données publiques Yahoo Finance. Modèles simplifiés à titre indicatif uniquement. Ne constitue pas un conseil en investissement.",
        }
