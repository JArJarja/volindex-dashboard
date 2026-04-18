# config.py
import os
from pathlib import Path

# Lire .env local si présent (développement)
_env_file = Path(__file__).parent / ".env"
if _env_file.exists():
    raw = _env_file.read_bytes().decode("utf-8-sig")
    raw = raw.replace("\r\n", "\n").replace("\r", "\n")
    for line in raw.split("\n"):
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, val = line.partition("=")
        key = key.strip()
        val = val.strip().strip('"').strip("'")
        if key and val:
            os.environ[key] = val

class Settings:
    finnhub_api_key: str = os.environ.get("FINNHUB_API_KEY", "").strip()
    fmp_api_key: str     = os.environ.get("FMP_API_KEY", "").strip()
    port: int            = int(os.environ.get("PORT", "8000"))

settings = Settings()

print(f"[Config] Finnhub : {settings.finnhub_api_key[:8]}..." if settings.finnhub_api_key else "[Config] FINNHUB_API_KEY manquante")
print(f"[Config] FMP     : {settings.fmp_api_key[:8]}..." if settings.fmp_api_key else "[Config] FMP_API_KEY non configuree")
