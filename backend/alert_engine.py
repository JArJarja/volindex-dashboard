# alert_engine.py
"""
Moteur d'alertes : surveille les franchissements de supports/résistances
et envoie un email automatiquement.
Configuration via variables d'environnement :
  ALERT_EMAIL_FROM    ex: alerts@gmail.com
  ALERT_EMAIL_TO      ex: vous@email.com
  ALERT_EMAIL_PASS    mot de passe app Gmail (pas votre mdp principal)
  ALERT_SMTP_HOST     défaut: smtp.gmail.com
  ALERT_SMTP_PORT     défaut: 587
"""
import asyncio
import smtplib
import time
import math
import os
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
from dataclasses import dataclass, field


@dataclass
class PriceLevel:
    symbol: str
    name: str
    level: float
    kind: str        # "support" | "resistance"
    last_price: float
    triggered: bool = False
    triggered_at: float = 0.0


class AlertEngine:
    def __init__(self):
        self._levels: dict[str, list[PriceLevel]] = {}   # symbol → levels
        self._last_prices: dict[str, float] = {}
        self._cooldown: dict[str, float] = {}            # éviter spam (1h par niveau)
        self._email_cfg = {
            "from":  os.environ.get("ALERT_EMAIL_FROM", ""),
            "to":    os.environ.get("ALERT_EMAIL_TO", ""),
            "pwd":   os.environ.get("ALERT_EMAIL_PASS", ""),
            "host":  os.environ.get("ALERT_SMTP_HOST", "smtp.gmail.com"),
            "port":  int(os.environ.get("ALERT_SMTP_PORT", "587")),
        }
        self.enabled = bool(self._email_cfg["from"] and self._email_cfg["to"] and self._email_cfg["pwd"])
        if not self.enabled:
            print("[AlertEngine] Email non configuré — alertes désactivées. "
                  "Définissez ALERT_EMAIL_FROM, ALERT_EMAIL_TO, ALERT_EMAIL_PASS.")

    # ── Mise à jour des niveaux depuis le détail ──────────────────────────────

    def update_levels(self, symbol: str, name: str, price: float,
                      supports: list[float], resistances: list[float]):
        """Appelé à chaque refresh de données. Détecte les franchissements."""
        if price <= 0 or not math.isfinite(price):
            return

        prev_price = self._last_prices.get(symbol, 0.0)
        self._last_prices[symbol] = price

        if prev_price <= 0:
            # Premier passage : enregistrer les niveaux sans alerter
            self._levels[symbol] = []
            for s in supports:
                self._levels[symbol].append(PriceLevel(symbol, name, s, "support", price))
            for r in resistances:
                self._levels[symbol].append(PriceLevel(symbol, name, r, "resistance", price))
            return

        # Mettre à jour les niveaux (supports/résistances peuvent changer)
        existing = {(l.level, l.kind): l for l in self._levels.get(symbol, [])}
        new_levels = []
        for s in supports:
            key = (s, "support")
            lv = existing.get(key, PriceLevel(symbol, name, s, "support", prev_price))
            new_levels.append(lv)
        for r in resistances:
            key = (r, "resistance")
            lv = existing.get(key, PriceLevel(symbol, name, r, "resistance", prev_price))
            new_levels.append(lv)
        self._levels[symbol] = new_levels

        # Détecter franchissements
        for lv in new_levels:
            self._check_breach(lv, prev_price, price)

    def _check_breach(self, lv: PriceLevel, prev: float, curr: float):
        """Détecte si le prix a franchi le niveau entre deux ticks."""
        cooldown_key = f"{lv.symbol}:{lv.level}:{lv.kind}"
        now = time.time()

        # Cooldown 1h pour éviter le spam
        if now - self._cooldown.get(cooldown_key, 0) < 3600:
            return

        breached = False
        direction = ""

        if lv.kind == "resistance":
            # Franchissement haussier : prix passe au-dessus de la résistance
            if prev < lv.level and curr >= lv.level:
                breached = True
                direction = "haussier ↗"
        elif lv.kind == "support":
            # Franchissement baissier : prix passe en-dessous du support
            if prev > lv.level and curr <= lv.level:
                breached = True
                direction = "baissier ↘"

        if breached:
            self._cooldown[cooldown_key] = now
            lv.triggered = True
            lv.triggered_at = now
            print(f"[ALERT] {lv.symbol} — {lv.kind} {lv.level:.4f} franchi ({direction}) | prix: {curr:.4f}")
            asyncio.create_task(self._send_email(lv, curr, direction))

    # ── Envoi email ───────────────────────────────────────────────────────────

    async def _send_email(self, lv: PriceLevel, current_price: float, direction: str):
        if not self.enabled:
            return
        try:
            await asyncio.get_event_loop().run_in_executor(
                None, self._send_smtp, lv, current_price, direction
            )
        except Exception as e:
            print(f"[AlertEngine] Erreur email: {e}")

    def _send_smtp(self, lv: PriceLevel, current_price: float, direction: str):
        kind_fr = "résistance" if lv.kind == "resistance" else "support"
        action  = "cassure au-dessus" if lv.kind == "resistance" else "rupture en-dessous"
        ts = time.strftime("%d/%m/%Y à %H:%M:%S UTC", time.gmtime(lv.triggered_at))

        subject = f"⚡ VOLINDEX — {lv.symbol} : {kind_fr} {lv.level:.4f} franchie ({direction})"

        html = f"""
<html><body style="font-family:monospace;background:#07080a;color:#c8cfe0;padding:24px">
<div style="max-width:520px;margin:0 auto;background:#0f1117;border:1px solid #1e2130;border-radius:8px;padding:24px">
  <div style="color:#00c49a;font-size:18px;font-weight:700;margin-bottom:4px">⚡ VOLINDEX — Alerte Niveau</div>
  <div style="color:#7a8098;font-size:11px;margin-bottom:20px">{ts}</div>

  <div style="background:#1e2130;border-radius:6px;padding:14px;margin-bottom:16px">
    <div style="font-size:13px;margin-bottom:8px">
      <span style="color:#7a8098">Instrument :</span>
      <span style="color:#c8cfe0;font-weight:700;margin-left:8px">{lv.symbol} — {lv.name}</span>
    </div>
    <div style="font-size:13px;margin-bottom:8px">
      <span style="color:#7a8098">Type :</span>
      <span style="color:{'#e05060' if lv.kind=='support' else '#00c49a'};font-weight:700;margin-left:8px;text-transform:uppercase">{kind_fr} franchie</span>
    </div>
    <div style="font-size:13px;margin-bottom:8px">
      <span style="color:#7a8098">Niveau :</span>
      <span style="color:#c8cfe0;font-weight:700;margin-left:8px">{lv.level:.4f}</span>
    </div>
    <div style="font-size:13px;margin-bottom:8px">
      <span style="color:#7a8098">Prix actuel :</span>
      <span style="color:#c8cfe0;font-weight:700;margin-left:8px">{current_price:.4f}</span>
    </div>
    <div style="font-size:13px">
      <span style="color:#7a8098">Direction :</span>
      <span style="color:{'#00c49a' if 'haussier' in direction else '#e05060'};font-weight:700;margin-left:8px">{direction}</span>
    </div>
  </div>

  <div style="background:{'rgba(0,196,154,.08)' if 'haussier' in direction else 'rgba(224,80,96,.08)'};border:1px solid {'rgba(0,196,154,.3)' if 'haussier' in direction else 'rgba(224,80,96,.3)'};border-radius:6px;padding:12px;margin-bottom:16px;font-size:12px;line-height:1.6">
    <strong>Scénario détecté :</strong><br>
    {action.capitalize()} de {kind_fr} {lv.level:.4f} sur {lv.symbol}.<br>
    Biais {direction} potentiellement renforcé. Surveiller la continuation.
  </div>

  <div style="font-size:10px;color:#3a3f55;border-top:1px solid #1e2130;padding-top:12px">
    ⚠ Alerte informatique et pédagogique. Ne constitue pas un conseil en investissement.
    Aucune recommandation d'achat/vente. VOLINDEX Dashboard.
  </div>
</div>
</body></html>"""

        msg = MIMEMultipart("alternative")
        msg["Subject"] = subject
        msg["From"]    = self._email_cfg["from"]
        msg["To"]      = self._email_cfg["to"]
        msg.attach(MIMEText(html, "html", "utf-8"))

        with smtplib.SMTP(self._email_cfg["host"], self._email_cfg["port"]) as srv:
            srv.ehlo()
            srv.starttls()
            srv.login(self._email_cfg["from"], self._email_cfg["pwd"])
            srv.sendmail(self._email_cfg["from"], self._email_cfg["to"], msg.as_string())
        print(f"[AlertEngine] Email envoyé → {self._email_cfg['to']} ({lv.symbol} {lv.kind})")

    # ── API : niveaux actifs ──────────────────────────────────────────────────

    def get_recent_alerts(self, limit: int = 20) -> list[dict]:
        """Retourne les dernières alertes déclenchées."""
        alerts = []
        for levels in self._levels.values():
            for lv in levels:
                if lv.triggered:
                    alerts.append({
                        "symbol":     lv.symbol,
                        "name":       lv.name,
                        "level":      lv.level,
                        "kind":       lv.kind,
                        "triggered_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(lv.triggered_at)),
                    })
        alerts.sort(key=lambda a: a["triggered_at"], reverse=True)
        return alerts[:limit]
