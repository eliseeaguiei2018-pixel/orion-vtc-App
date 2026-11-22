#!/usr/bin/env bash
# APK DE TEST « TEMPS RÉEL » — installées À PART des apps officielles (voir src/tempsReel.ts) :
#   - ORION Test (ci.orion.test.client) : toute l'app client, avec le trafic réel de Google
#     sur la carte et dans le prix, et l'approche réelle du chauffeur ;
#   - ORION Console test (ci.orion.test.console) : la mini console qui joue le chauffeur.
# Les deux partagent un registre de test sur le téléphone (fournisseur de l'app ORION Test).
#
#   VITE_GOOGLE_MAPS_API_KEY=<clé> ANDROID_HOME=<sdk> scripts/construire-apk-test.sh <sortie>
#
# La clé Google vient de l'environnement : elle n'est jamais écrite dans le dépôt.
# GRADLE=<chemin> permet d'utiliser un Gradle installé à la place de ./gradlew.
set -euo pipefail
: "${VITE_GOOGLE_MAPS_API_KEY:?clé Google manquante (variable VITE_GOOGLE_MAPS_API_KEY)}"
SORTIE=$(realpath -m "$1"); mkdir -p "$SORTIE"
cd "$(dirname "$0")/.."
GRADLE_CMD=${GRADLE:-./gradlew}
if [ -f .env.local ]; then mv .env.local .env.local.ecarte; trap 'mv .env.local.ecarte .env.local' EXIT; fi
export VITE_API_URL= VITE_MAP_GOOGLE_SEUL=1 VITE_TEMPS_REEL=1 VITE_MAP_DONNEES_URL='./carte/'

# 1. App client de test
npx vite build --outDir dist-test-client --emptyOutDir --logLevel error
ORION_APP=test-client npx cap sync android > /dev/null
(cd test/client/android && $GRADLE_CMD assembleDebug --no-daemon -q)
cp test/client/android/app/build/outputs/apk/debug/app-debug.apk "$SORTIE/ORION-test-client-1.6.0.apk"

# 2. Mini console de test (une seule page, qui devient l'accueil de l'application)
ORION_APP=test-console npx vite build --outDir dist-test-console --emptyOutDir --logLevel error
mv dist-test-console/console-test.html dist-test-console/index.html
ORION_APP=test-console npx cap sync android > /dev/null
(cd test/console/android && $GRADLE_CMD assembleDebug --no-daemon -q)
cp test/console/android/app/build/outputs/apk/debug/app-debug.apk "$SORTIE/ORION-console-test-1.6.0.apk"

ls -la "$SORTIE"/ORION-test-client-1.6.0.apk "$SORTIE"/ORION-console-test-1.6.0.apk
