@echo off
REM ============================================================
REM  ORION - Demarrage en une commande (Windows)
REM  Installe (si besoin) puis lance le backend ET l'app cliente.
REM  Deux fenetres s'ouvrent. Ferme-les pour arreter.
REM ============================================================
setlocal
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo [ERREUR] Node.js n'est pas installe.
  echo Installe-le depuis https://nodejs.org ^(version LTS^) puis relance ce fichier.
  pause
  exit /b 1
)

echo Node.js detecte.
for /f "delims=" %%v in ('node --version') do echo Version : %%v

if not exist "backend\node_modules" (
  echo Installation du backend ^(1re fois^)...
  pushd backend && call npm install && popd
)
if not exist "frontend\node_modules" (
  echo Installation de l'app cliente ^(1re fois^)...
  pushd frontend && call npm install && popd
)

echo Lancement du moteur (backend) sur http://localhost:3000
start "ORION Backend" cmd /k "cd backend && npm run dev"

echo Lancement de l'app cliente sur http://localhost:5173
start "ORION App Client" cmd /k "cd frontend && npm run dev"

echo.
echo ============================================================
echo  Ouvre http://localhost:5173 dans ton navigateur.
echo  Pour arreter : ferme les deux fenetres ouvertes.
echo ============================================================
endlocal
