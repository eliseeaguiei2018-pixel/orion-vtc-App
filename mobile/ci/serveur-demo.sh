#!/usr/bin/env bash
# Démarre le serveur ORION de démonstration (données en mémoire) sur le port 3000.
# Le numéro 07 08 09 10 11 reçoit toujours le code 240726 (mécanisme du compte de revue).
set -euo pipefail
JOURNAL="${1:-$PWD/serveur.log}"
cd "$(dirname "$0")/../../backend"
NODE_ENV=development PORT=3000 HOST=0.0.0.0 CORS_ORIGIN='*' RATE_LIMIT_MAX=100000 \
  CLIENT_REVIEW_PHONE='+225 07 08 09 10 11' CLIENT_REVIEW_CODE='240726' \
  nohup npx tsx src/server.ts > "$JOURNAL" 2>&1 &
for _ in $(seq 1 90); do
  if curl -fsS http://localhost:3000/health/ready > /dev/null 2>&1; then
    echo "Serveur ORION prêt sur le port 3000"
    exit 0
  fi
  sleep 2
done
echo "Le serveur ORION n'a pas démarré :"
cat "$JOURNAL"
exit 1
