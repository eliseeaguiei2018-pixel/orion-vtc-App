#!/usr/bin/env bash
# ============================================================
# ORION — Démarrage en une commande (Mac / Linux)
# Installe (si besoin) puis lance le backend ET l'app cliente.
# Arrêt : Ctrl + C
# ============================================================
set -e

GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; NC='\033[0m'
ROOT="$(cd "$(dirname "$0")" && pwd)"

echo -e "${GREEN}🌱 ORION — démarrage…${NC}"

# 1) Vérifier Node.js
if ! command -v node >/dev/null 2>&1; then
  echo -e "${RED}❌ Node.js n'est pas installé.${NC}"
  echo "   Installe-le depuis https://nodejs.org (version LTS), puis relance ce script."
  exit 1
fi
echo -e "   Node.js détecté : $(node --version)"

# 2) Installer les dépendances si nécessaire
if [ ! -d "$ROOT/backend/node_modules" ]; then
  echo -e "${YELLOW}📦 Installation du backend (1re fois)…${NC}"
  (cd "$ROOT/backend" && npm install)
fi
if [ ! -d "$ROOT/frontend/node_modules" ]; then
  echo -e "${YELLOW}📦 Installation de l'app cliente (1re fois)…${NC}"
  (cd "$ROOT/frontend" && npm install)
fi

# 3) Lancer le backend en arrière-plan, l'arrêter quand on quitte
echo -e "${GREEN}🚗 Lancement du moteur (backend) sur http://localhost:3000${NC}"
(cd "$ROOT/backend" && npm run dev) &
BACKEND_PID=$!
cleanup() {
  echo -e "\n${YELLOW}Arrêt d'ORION…${NC}"
  kill "$BACKEND_PID" 2>/dev/null || true
}
trap cleanup EXIT INT TERM

# Laisser le backend démarrer
sleep 2

# 4) Lancer l'app cliente au premier plan
echo -e "${GREEN}📱 Lancement de l'app cliente sur http://localhost:5173${NC}"
echo -e "${GREEN}👉 Ouvre http://localhost:5173 dans ton navigateur. (Ctrl+C pour arrêter)${NC}"
(cd "$ROOT/frontend" && npm run dev)
