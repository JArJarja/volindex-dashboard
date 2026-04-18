# config.py
import os
from pathlib import Path

# Lire .env manuellement — plus fiable que pydantic-settings
_env_file = Path(__file__).parent / ".env"
if _env_file.exists():
    for line in _env_file.read_text(encoding="utf-8-sig").splitlines():
        line = line.strip()
        if line and "=" in line and not line.startswith("#"):
            key, _, val = line.partition("=")
            key = key.strip()
            val = val.strip()
            if key and val and key not in os.environ:
                os.environ[key] = val

class Settings:
    finnhub_api_key: str = os.environ.get("FINNHUB_API_KEY", "").strip()
    fmp_api_key: str     = os.environ.get("FMP_API_KEY", "").strip()

settings = Settings()

if settings.finnhub_api_key:
    print(f"[Config] Finnhub : {settings.finnhub_api_key[:8]}...")
else:
    print("[Config] FINNHUB_API_KEY manquante")

if settings.fmp_api_key:
    print(f"[Config] FMP     : {settings.fmp_api_key[:8]}...")
else:
    print("[Config] FMP_API_KEY manquante (optionnel)")
