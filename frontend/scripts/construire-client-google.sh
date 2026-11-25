#!/usr/bin/env bash
# Construit l'app cliente AUTONOME en « GOOGLE SEUL » : Google Maps est la carte de
# l'application, sans autre fond ni repli. La carte ORION (tuiles, polices) n'est pas
# livrée ; l'index des lieux (recherche d'adresses) l'est toujours.
#
#   VITE_GOOGLE_MAPS_API_KEY=<clé> scripts/construire-client-google.sh <sortie>
#
# La clé (service « Maps JavaScript API ») vient de l'environnement : elle n'est jamais
# écrite dans le dépôt. Elle se retrouve dans l'application, comme toute clé de carte
# affichée côté client : la restreindre dans Google Cloud (API autorisées, sites autorisés :
# https://localhost/* pour l'application Android).
set -euo pipefail
: "${VITE_GOOGLE_MAPS_API_KEY:?clé Google manquante (variable VITE_GOOGLE_MAPS_API_KEY)}"
SORTIE=$(realpath -m "$1")
cd "$(dirname "$0")/.."
# Un .env.local de développement pointe vers un serveur local : on l'écarte le temps du build.
if [ -f .env.local ]; then mv .env.local .env.local.ecarte; trap 'mv .env.local.ecarte .env.local' EXIT; fi
VITE_API_URL="${VITE_API_URL:-}" \
VITE_MAP_GOOGLE_SEUL=1 \
VITE_MAP_DONNEES_URL='./carte/' \
  npx vite build --outDir "$SORTIE" --emptyOutDir --logLevel error
echo "App cliente « Google seul » construite dans $SORTIE ($(du -sh "$SORTIE" | cut -f1))"
