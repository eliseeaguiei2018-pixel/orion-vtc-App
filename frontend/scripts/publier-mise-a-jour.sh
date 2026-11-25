#!/usr/bin/env bash
# PUBLIER UNE MISE À JOUR À CHAUD d'une app ORION (client, chauffeur ou console).
#
#   ORION_SERVEUR=https://… ORION_JETON_ADMIN=… scripts/publier-mise-a-jour.sh <app> <version> [natifMin] [notes] [obligatoire]
#
# Construit l'application web de l'app, en fait un paquet zip et l'envoie au serveur ORION, qui le
# signe et l'annonce en direct : à l'ouverture (jamais pendant une course), l'app affiche « Mise à
# jour disponible » et l'installe en quelques secondes, sans nouvelle APK. obligatoire=1 retire
# le bouton « Plus tard ». natifMin : versionCode Android minimal (25 = APK 1.9.0, la
# première à savoir se mettre à jour) ; à relever seulement si la version a besoin d'un nouveau
# module natif (elle attendra alors la nouvelle APK).
#
# Le paquet est servi publiquement : il est construit SANS la clé Google (l'APK la garde sur le
# téléphone) et le script refuse de l'envoyer s'il y trouve une clé.
set -euo pipefail
APP="${1:?app : client, chauffeur ou console}"
VERSION="${2:?version, par exemple 1.9.0-2611231200}"
NATIF_MIN="${3:-25}"
NOTES="${4:-}"
OBLIGATOIRE="${5:-0}"
: "${ORION_SERVEUR:?adresse du serveur ORION (ORION_SERVEUR)}"
: "${ORION_JETON_ADMIN:?jeton de session de la direction (ORION_JETON_ADMIN)}"
cd "$(dirname "$0")/.."

TMP=$(mktemp -d)
nettoyer() { rm -rf "$TMP"; if [ -f .env.local.ecarte ]; then mv .env.local.ecarte .env.local; fi; }
trap nettoyer EXIT
if [ -f .env.local ]; then mv .env.local .env.local.ecarte; fi

unset VITE_GOOGLE_MAPS_API_KEY
export VITE_API_URL="$ORION_SERVEUR" VITE_MISES_A_JOUR=1 ORION_VERSION_WEB="$VERSION"
case "$APP" in
  client)
    VITE_MAP_GOOGLE_SEUL=1 VITE_MAP_DONNEES_URL='./carte/' npx vite build --outDir "$TMP/web" --emptyOutDir --logLevel error ;;
  chauffeur)
    ORION_APP=chauffeur VITE_MAP_GOOGLE_SEUL=1 VITE_MAP_DONNEES_URL='./carte/' npx vite build --outDir "$TMP/web" --emptyOutDir --logLevel error
    mv "$TMP/web/driver.html" "$TMP/web/index.html" ;;
  console)
    ORION_APP=console npx vite build --outDir "$TMP/web" --emptyOutDir --logLevel error
    mv "$TMP/web/admin.html" "$TMP/web/index.html" ;;
  *) echo "App inconnue : $APP" >&2; exit 1 ;;
esac

# Aucune clé Google (« AIza… ») dans un paquet public.
if grep -rqE 'AIza[0-9A-Za-z_-]{20,}' "$TMP/web"; then echo "Refus : une clé Google est présente dans le paquet." >&2; exit 1; fi
grep -rqF "$VERSION" "$TMP/web/assets" || { echo "Refus : la version $VERSION n'est pas dans le paquet." >&2; exit 1; }

(cd "$TMP/web" && zip -qr -X "$TMP/paquet.zip" .)
echo "Paquet $APP $VERSION : $(du -h "$TMP/paquet.zip" | cut -f1)"
curl -sS --fail-with-body -X PUT \
  -H "authorization: Bearer $ORION_JETON_ADMIN" -H 'content-type: application/zip' \
  --data-binary @"$TMP/paquet.zip" \
  "$ORION_SERVEUR/admin/mises-a-jour/$APP?version=$VERSION&natifMin=$NATIF_MIN&notes=$(python3 -c "import sys,urllib.parse; print(urllib.parse.quote(sys.argv[1]))" "$NOTES")&obligatoire=$OBLIGATOIRE" \
  | python3 -c "import json,sys; m=json.load(sys.stdin)['manifeste']; print('Publié :', m['app'], m['version'], m['taille'], 'octets, natifMin', m['natifMin'])"
