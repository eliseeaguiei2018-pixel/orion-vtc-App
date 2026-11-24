#!/usr/bin/env bash
# Prépare l'app iPhone OFFICIELLE (App Store / TestFlight) d'ORION ou d'ORION Pro, sur un Mac.
#
#   VITE_GOOGLE_MAPS_API_KEY=<clé> scripts/construire-ios.sh <client|chauffeur> [serveur]
#
# Même app web que les APK officielles : serveur de production, mises à jour à chaud activées
# (les paquets publiés avec scripts/publier-mise-a-jour.sh valent aussi pour l'iPhone), carte
# Google seule. Ensuite : Xcode › Product › Archive, puis envoi sur App Store Connect.
# La clé Google vient de l'environnement, jamais du dépôt ; dans Google Cloud, ajouter
# capacitor://localhost/* aux sites autorisés de la clé (origine des apps iPhone).
set -euo pipefail
APP="${1:?app : client ou chauffeur}"
SERVEUR="${2:-https://orion-backend-lrkl.onrender.com}"
: "${VITE_GOOGLE_MAPS_API_KEY:?clé Google manquante (variable VITE_GOOGLE_MAPS_API_KEY)}"
cd "$(dirname "$0")/.."
# Un .env.local de développement pointe vers un serveur local : on l'écarte le temps du build.
if [ -f .env.local ]; then mv .env.local .env.local.ecarte; trap 'mv .env.local.ecarte .env.local' EXIT; fi
export VITE_API_URL="$SERVEUR" VITE_MISES_A_JOUR=1 VITE_MAP_GOOGLE_SEUL=1 VITE_MAP_DONNEES_URL='./carte/'
case "$APP" in
  client)
    npx vite build --emptyOutDir --logLevel error
    npx cap sync ios
    echo "Ouvrir : npx cap open ios" ;;
  chauffeur)
    node scripts/construire-app-chauffeur.mjs ios
    echo "Ouvrir : ORION_APP=chauffeur npx cap open ios" ;;
  *) echo "App inconnue : $APP" >&2; exit 1 ;;
esac
