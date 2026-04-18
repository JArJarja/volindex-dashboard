# VOLINDEX — Dashboard de Surveillance Indices

> **Disclaimer** : Outil d'analyse de marché à vocation informative et pédagogique. Ne constitue pas un conseil en investissement. Aucune recommandation d'achat/vente.

---

## Architecture

```
finnhub-dashboard/
├── backend/                        # Python 3.11+ · FastAPI
│   ├── main.py                     # App FastAPI + routes + lifespan
│   ├── config.py                   # Pydantic settings (env vars)
│   ├── finnhub_client.py           # Client REST Finnhub + rate limiter
│   ├── quant.py                    # Score vol/volume + indicateurs
│   ├── cache.py                    # TTL cache thread-safe
│   ├── ws_server.py                # WebSocket broadcast manager
│   ├── models.py                   # Pydantic schemas
│   ├── indices_universe.json       # 50 indices/ETFs configurables
│   ├── requirements.txt
│   └── tests/
│       ├── test_quant.py           # Tests unitaires calcul quant
│       └── test_api.py             # Tests cache, modèles, edge cases
└── frontend/                       # Next.js 14 · TypeScript · Tailwind
    ├── pages/
    │   ├── index.tsx               # Top 30 tableau triable
    │   ├── index/[symbol].tsx      # Détail indice + graphique
    │   └── reports.tsx             # Rapports + export JSON/CSV
    ├── components/
    │   ├── Layout.tsx              # Nav + disclaimer permanent
    │   ├── TopTable.tsx            # Tableau triable multi-colonnes
    │   ├── CandleChart.tsx         # Graphique candlestick (lightweight-charts)
    │   ├── DiagnosticPanel.tsx     # Diagnostic neutre complet
    │   └── FilterBar.tsx           # Contrôles résolution/fenêtre
    └── lib/
        ├── api.ts                  # Client REST vers le backend
        └── wsClient.ts             # Hook WebSocket avec reconnexion
```

---

## Variables d'environnement

### Backend `.env`
```env
FINNHUB_API_KEY=your_api_key_here
```

### Frontend `.env.local`
```env
NEXT_PUBLIC_API_URL=http://localhost:8000
NEXT_PUBLIC_WS_URL=ws://localhost:8000/ws
```

---

## Installation locale

### Prérequis
- Python 3.11+
- Node.js 18+
- Clé API Finnhub (plan gratuit suffisant, 30 req/s)

### 1. Backend

```bash
cd backend

# Créer et activer l'environnement virtuel
python -m venv venv
source venv/bin/activate        # Linux/Mac
# venv\Scripts\activate         # Windows

# Installer les dépendances
pip install -r requirements.txt

# Configurer la clé API
cp .env.example .env
# Éditer .env et renseigner FINNHUB_API_KEY=xxx

# Lancer le backend
uvicorn main:app --reload --port 8000
```

Le backend sera disponible sur http://localhost:8000

Documentation Swagger auto-générée : http://localhost:8000/docs

### 2. Frontend

```bash
cd frontend

# Installer les dépendances
npm install

# Configurer les variables d'environnement
cp .env.local.example .env.local
# (ou créer .env.local avec les valeurs ci-dessus)

# Lancer le frontend
npm run dev
```

Le frontend sera disponible sur http://localhost:3000

---

## Tests

```bash
cd backend
source venv/bin/activate

# Lancer tous les tests
pytest tests/ -v

# Avec couverture
pip install pytest-cov
pytest tests/ -v --cov=. --cov-report=term-missing
```

---

## Endpoints API

| Méthode | Endpoint | Description |
|---------|----------|-------------|
| GET | `/api/top?window=60&resolution=1&limit=30` | Top 30 indices par score |
| GET | `/api/index/{symbol}?window=60&resolution=5` | Détail + diagnostic |
| GET | `/api/report/latest?window=60` | Rapport marché complet |
| GET | `/api/report/export/json?window=60` | Export JSON |
| GET | `/api/report/export/csv?window=60` | Export CSV |
| WS | `/ws` | Stream temps réel Top 30 |

---

## Endpoints Finnhub utilisés

| Endpoint | Usage | Cache TTL |
|----------|-------|-----------|
| `GET /quote` | Prix actuel, open/close, variation | 5s |
| `GET /stock/candle` | OHLCV sur fenêtre (résolutions 1,5,15,30,60) | 8s |
| `GET /search` | Validation/normalisation des symboles | 3600s |

---

## Logique Quantitative

### Score Volatilité/Volume

1. **Volatilité réalisée** = `std(log_returns)` sur la fenêtre (non annualisée)
   - `log_returns[i] = ln(close[i] / close[i-1])`
   
2. **Volume récent** = somme des volumes OHLCV sur la fenêtre

3. **Normalisation cross-sectionnel** : z-score pour chaque métrique
   - `vol_z = (vol - mean(vols)) / std(vols)` 
   - `volume_z = (volume - mean(volumes)) / std(volumes)`

4. **Score** = `vol_z × sigmoid(-volume_z + 1)` → score positif décalé
   - Interprétation : forte volatilité + faible volume relatif = score élevé

### Indicateurs techniques

| Indicateur | Paramètre | Usage |
|-----------|-----------|-------|
| MA simple | 20 périodes | Référence tendance |
| EMA | 20 périodes | Tendance lissée |
| RSI | 14 périodes | Momentum (suracheté >70, survendu <30) |
| ATR | 14 périodes | Amplitude de volatilité |
| MACD | 12/26/9 | Momentum croisé |

### Biais Neutre (aucune recommandation d'achat/vente)

Le biais est calculé sur 5 signaux : position prix vs MA, slope MA, structure HH/HL, RSI, MACD histogram. Le ratio signal détermine : haussier (>0.2) / baissier (<-0.2) / neutre.

---

## Configuration Univers d'Indices

Éditer `backend/indices_universe.json` pour ajouter/supprimer des symboles :

```json
[
  {"symbol": "SPY", "name": "S&P 500 ETF (SPDR)"},
  {"symbol": "QQQ", "name": "Nasdaq-100 ETF (Invesco)"},
  ...
]
```

Tout symbole valide sur Finnhub peut être ajouté (ETFs, indices, actions).

---

## Limites et Notes

### Plan gratuit Finnhub
- **30 requêtes/seconde** (le client limite à 20 req/s avec marge)
- **Univers de 50 symboles** : ~50 requêtes candles + 50 quotes = 100 req/refresh
- Temps de refresh complet : ~5-10s selon la taille de l'univers
- Le cache TTL (5-8s) évite les appels redondants

### Données
- Les indices/ETFs US ont des données intraday disponibles pendant les heures de marché (9h30-16h00 ET)
- En dehors des heures de marché : les candles peuvent être vides ou obsolètes
- La résolution "1 min" consomme plus de quota que "5 min" ou "15 min"

### Latence
- Cache backend : 5-8s TTL
- Refresh WebSocket : toutes les 15s
- Polling fallback (si pas de WS) : toutes les 30s

### Sécurité
- La clé API n'est **jamais** exposée au frontend
- Toutes les requêtes Finnhub sont faites côté backend uniquement
- Le frontend ne connaît que l'URL du backend

---

## Exemple de fichier `.env`

```env
# backend/.env
FINNHUB_API_KEY=pk_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

```env
# frontend/.env.local
NEXT_PUBLIC_API_URL=http://localhost:8000
NEXT_PUBLIC_WS_URL=ws://localhost:8000/ws
```
