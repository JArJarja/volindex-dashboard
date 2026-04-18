@echo off
setlocal enabledelayedexpansion
title VOLINDEX Dashboard
color 0A
cls

echo.
echo  ============================================================
echo   VOLINDEX - Dashboard de Surveillance de Marche
echo   Outil informatif - Aucun conseil en investissement
echo  ============================================================
echo.

cd /d "%~dp0"

if not exist "backend\main.py" (
    echo  [ERREUR] Lancez ce fichier depuis le dossier finnhub-dashboard\
    pause & exit /b 1
)

:: Lire le .env
if exist "backend\.env" (
    echo  [OK] Lecture de backend\.env ...
    for /f "usebackq tokens=1,* delims==" %%A in ("backend\.env") do (
        if not "%%A"=="" if not "%%B"=="" set "%%A=%%B"
    )
)

:: Demander la cle Finnhub si manquante
if "!FINNHUB_API_KEY!"=="" (
    echo.
    set /p "FINNHUB_API_KEY=  Cle Finnhub (pk_...) : "
    if "!FINNHUB_API_KEY!"=="" ( echo [ERREUR] Cle requise. & pause & exit /b 1 )
)

echo  Finnhub : !FINNHUB_API_KEY:~0,10!...
if not "!FMP_API_KEY!"=="" echo  FMP     : !FMP_API_KEY:~0,10!... [actif]
if not "!ALERT_EMAIL_FROM!"=="" echo  Email   : !ALERT_EMAIL_FROM! [alertes actives]
echo.

:: Verifier Python
py -3.12 --version >nul 2>&1
if not errorlevel 1 ( set PYTHON_CMD=py -3.12 ) else ( set PYTHON_CMD=python )

:: Creer venv si absent
if not exist "backend\venv\Scripts\activate.bat" (
    echo  [INFO] Creation du venv Python...
    cd backend && !PYTHON_CMD! -m venv venv && call venv\Scripts\activate.bat && pip install -r requirements.txt -q && cd ..
    echo  [OK] Venv configure.
)

:: Node modules si absent
if not exist "frontend\node_modules" (
    echo  [INFO] Installation Node.js...
    cd frontend && npm install --silent && cd ..
    echo  [OK] Node modules installes.
)

:: Tuer anciens processus
echo  [INFO] Liberation des ports...
for /f "tokens=5" %%a in ('netstat -ano 2^>nul ^| findstr ":8000 "') do taskkill /PID %%a /F >nul 2>&1
for /f "tokens=5" %%a in ('netstat -ano 2^>nul ^| findstr ":3000 "') do taskkill /PID %%a /F >nul 2>&1
timeout /t 2 /nobreak >nul

:: Ecrire le script backend temporaire
echo @echo off > "%TEMP%\volindex_backend.bat"
echo cd /d "%~dp0backend" >> "%TEMP%\volindex_backend.bat"
echo call venv\Scripts\activate.bat >> "%TEMP%\volindex_backend.bat"
echo set FINNHUB_API_KEY=!FINNHUB_API_KEY! >> "%TEMP%\volindex_backend.bat"
echo set FMP_API_KEY=!FMP_API_KEY! >> "%TEMP%\volindex_backend.bat"
echo set ALERT_EMAIL_FROM=!ALERT_EMAIL_FROM! >> "%TEMP%\volindex_backend.bat"
echo set ALERT_EMAIL_TO=!ALERT_EMAIL_TO! >> "%TEMP%\volindex_backend.bat"
echo set ALERT_EMAIL_PASS=!ALERT_EMAIL_PASS! >> "%TEMP%\volindex_backend.bat"
echo uvicorn main:app --port 8000 >> "%TEMP%\volindex_backend.bat"
echo pause >> "%TEMP%\volindex_backend.bat"

:: Lancer backend
echo  [1/3] Demarrage backend (port 8000)...
start "VOLINDEX Backend" cmd /k ""%TEMP%\volindex_backend.bat""
echo  [INFO] Attente backend (8 secondes)...
timeout /t 8 /nobreak >nul

:: Lancer frontend
echo  [2/3] Demarrage frontend (port 3000)...
start "VOLINDEX Frontend" cmd /k "cd /d "%~dp0frontend" && npm run dev"
echo  [INFO] Attente frontend (10 secondes)...
timeout /t 10 /nobreak >nul

:: ── ACCES INTERNET via Cloudflare Tunnel ─────────────────────────────────────
echo  [3/3] Mise en ligne via Cloudflare Tunnel...
echo.

:: Verifier si cloudflared est installe
cloudflared --version >nul 2>&1
if errorlevel 1 (
    :: Telecharger cloudflared si absent
    if not exist "%~dp0cloudflared.exe" (
        echo  [INFO] Telechargement de Cloudflare Tunnel...
        powershell -Command "Invoke-WebRequest -Uri 'https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe' -OutFile '%~dp0cloudflared.exe'"
        echo  [OK] cloudflared.exe telecharge.
    )
    set CF_CMD="%~dp0cloudflared.exe"
) else (
    set CF_CMD=cloudflared
)

:: Lancer tunnel Cloudflare pour le frontend (port 3000)
echo  [INFO] Creation du tunnel public...
start "VOLINDEX Tunnel" cmd /k "!CF_CMD! tunnel --url http://localhost:3000"

echo.
echo  [INFO] Attente 5 secondes pour le tunnel...
timeout /t 5 /nobreak >nul

echo.
echo  ============================================================
echo   VOLINDEX est lance !
echo.
echo   LOCAL (ce PC)  : http://localhost:3000
echo   API docs       : http://localhost:8000/docs
echo   Test alertes   : http://localhost:8000/api/alerts/test
echo.
echo   INTERNET : regardez la fenetre "VOLINDEX Tunnel"
echo   Elle affiche une URL en .trycloudflare.com
echo   Exemple : https://abc-def-ghi.trycloudflare.com
echo   Partagez cette URL pour acceder depuis n'importe ou !
echo.
echo   NOTE : L'URL change a chaque redemarrage (gratuit)
echo   Pour une URL fixe : cloudflare.com (plan gratuit avec compte)
echo  ============================================================
echo.
start "" http://localhost:3000
timeout /t 5 /nobreak >nul
