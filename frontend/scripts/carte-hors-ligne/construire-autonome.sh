#!/usr/bin/env bash
# Construit l'app client AUTONOME (sans serveur ORION) avec la carte d'Abidjan embarquée :
# tuiles OpenStreetMap du district, polices, pictogrammes, quartiers d'usage et index de
# recherche. Sert à l'APK de démonstration (Android) et aux démonstrations hors ligne.
#
#   scripts/carte-hors-ligne/construire-autonome.sh <dossier-donnees> <sortie>
#
# <dossier-donnees> contient tuiles/{z}/{x}/{y}.pbf, polices/<police>/<plage>.pbf et
# carte/ (lieux-index.json, quartiers-usage.json, sprites/) — voir README.md.
set -euo pipefail
DONNEES=$(realpath "$1"); SORTIE=$(realpath -m "$2")
cd "$(dirname "$0")/../.."
# Un .env.local de développement pointe vers un serveur local : on l'écarte le temps du build.
if [ -f .env.local ]; then mv .env.local .env.local.ecarte; trap 'mv .env.local.ecarte .env.local' EXIT; fi
VITE_API_URL= \
VITE_MAP_TILES_URL='hybride:./tuiles/{z}/{x}/{y}.pbf' \
VITE_MAP_TILES_MAXZOOM=14 \
VITE_MAP_GLYPHS_URL='./polices/{fontstack}/{range}.pbf' \
VITE_MAP_DONNEES_URL='./carte/' \
  npx vite build --outDir "$SORTIE" --emptyOutDir --logLevel error
cp -rL "$DONNEES/tuiles" "$DONNEES/polices" "$DONNEES/carte" "$SORTIE/"
echo "App autonome construite dans $SORTIE ($(du -sh "$SORTIE" | cut -f1))"
