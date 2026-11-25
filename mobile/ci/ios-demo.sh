#!/usr/bin/env bash
# Démonstration iPhone filmée (simulateur) : iPhone en français, installation de l'app,
# ouverture depuis l'icône et inscription complète. Lancé par .github/workflows/mobile.yml
# (le serveur ORION tourne déjà sur le port 3000, partagé avec le simulateur).
set -uo pipefail
APP="$1"
SORTIE="$2"
RACINE="$(cd "$(dirname "$0")/../.." && pwd)"
mkdir -p "$SORTIE/captures"
JALONS="$SORTIE/jalons.txt"
jalon() { echo "$(date +%s) $*" >> "$JALONS"; echo "== $*"; }

# L'iPhone le plus récent disponible (modèle Pro de préférence).
UDID=$(xcrun simctl list devices available -j | python3 -c '
import json, sys
d = json.load(sys.stdin)["devices"]
c = [(rt, x) for rt, l in d.items() if ".iOS-" in rt for x in l if x["name"].startswith("iPhone")]
def cle(t):
    rt, x = t
    v = [int(n) for n in rt.split("iOS-")[1].split("-")]
    return (v, "Pro" in x["name"] and "Max" not in x["name"], x["name"])
c.sort(key=cle)
print(c[-1][1]["udid"])
')
echo "Simulateur : $(xcrun simctl list devices | grep "$UDID" | sed 's/ (.*//' | xargs) ($UDID)"

jalon "iPhone en français (Côte d'Ivoire)"
xcrun simctl boot "$UDID"
xcrun simctl bootstatus "$UDID" -b > /dev/null
xcrun simctl shutdown "$UDID"
PREFS="$HOME/Library/Developer/CoreSimulator/Devices/$UDID/data/Library/Preferences/.GlobalPreferences.plist"
plutil -replace AppleLanguages -json '["fr-CI","fr"]' "$PREFS"
plutil -replace AppleLocale -string fr_CI "$PREFS"
xcrun simctl boot "$UDID"
xcrun simctl bootstatus "$UDID" -b > /dev/null
sleep 10

xcrun simctl status_bar "$UDID" override --time "09:41" --dataNetwork 4g --cellularMode active \
  --cellularBars 4 --wifiMode active --wifiBars 3 --operatorName "Orange CI" \
  --batteryState charged --batteryLevel 100 || true
xcrun simctl addmedia "$UDID" "$RACINE/mobile/maestro/medias/portrait-aya.jpg"

# Pilote Maestro installé avant le tournage.
maestro hierarchy > /dev/null 2>&1 || true
sleep 3

jalon "Début du tournage"
xcrun simctl io "$UDID" recordVideo --codec=h264 --force "$SORTIE/ios-brut.mp4" > "$SORTIE/enregistrement.log" 2>&1 &
FILM=$!
sleep 5

jalon "Installation de l'app"
xcrun simctl install "$UDID" "$APP"
jalon "App installée"
sleep 4

# Contrôle du démarrage : l'app s'ouvre-t-elle et affiche-t-elle sa première page ?
# (lisible directement dans le journal de la CI, sans télécharger les artefacts)
jalon "Contrôle du démarrage"
xcrun simctl launch "$UDID" ci.orion.app || echo "(lancement refusé)"
sleep 45
echo "== Démarrage : textes visibles à l'écran"
maestro hierarchy 2> /dev/null | python3 -c '
import json, sys
try: arbre = json.load(sys.stdin)
except Exception: sys.exit("(hiérarchie illisible)")
vus = []
def parcourir(n):
    a = n.get("attributes", {})
    for k in ("text", "accessibilityText"):
        v = (a.get(k) or "").strip()
        if v and v not in vus: vus.append(v)
    for e in n.get("children", []): parcourir(e)
parcourir(arbre)
print("\n".join(vus[:60]) or "(écran vide)")
' || true
echo "== Démarrage : messages de l'app (Capacitor, erreurs JavaScript)"
xcrun simctl spawn "$UDID" log show --last 2m --style compact --predicate 'process == "App"' 2> /dev/null \
  | grep -aE "⚡️|rror|xception|WebContent|CapacitorUpdater" | tail -n 60 || true
xcrun simctl io "$UDID" screenshot "$SORTIE/demarrage.png" > /dev/null 2>&1 || true

cd "$SORTIE/captures"
jalon "Ouverture et inscription"
maestro test "$RACINE/mobile/maestro/ios/02-ouvrir-et-inscrire.yaml"
STATUT=$?
jalon "Fin du scénario (code $STATUT)"
# Échec : ce que montre l'écran à cet instant, lisible directement dans le journal de la CI.
if [ "$STATUT" -ne 0 ]; then
  echo "== Diagnostic : textes visibles à l'écran"
  maestro hierarchy 2> /dev/null | python3 -c '
import json, sys
try: arbre = json.load(sys.stdin)
except Exception: sys.exit("(hiérarchie illisible)")
vus = []
def parcourir(n):
    a = n.get("attributes", {})
    for k in ("text", "accessibilityText", "hintText", "resource-id"):
        v = (a.get(k) or "").strip()
        if v and v not in vus: vus.append(v)
    for e in n.get("children", []): parcourir(e)
parcourir(arbre)
print("\n".join(vus[:120]) or "(écran vide)")
' || true
  xcrun simctl io "$UDID" screenshot "$SORTIE/echec.png" > /dev/null 2>&1 || true
fi
sleep 5

kill -INT "$FILM" 2> /dev/null || true
wait "$FILM" 2> /dev/null || true

xcrun simctl spawn "$UDID" log show --last 20m --style compact \
  --predicate 'process == "App"' > "$SORTIE/journal-app.txt" 2>&1 || true
cp -r "$HOME/.maestro/tests" "$SORTIE/maestro-debug" 2> /dev/null || true
if [ "$STATUT" -ne 0 ]; then
  echo "== Diagnostic : journal de l'app (erreurs, messages de Capacitor)"
  grep -aE "⚡️|rror|xception|rash|Terminating|WebContent|WKWebView|CapacitorUpdater|Updater" "$SORTIE/journal-app.txt" | tail -n 80 || true
  echo "== Diagnostic : dernières lignes du journal"
  tail -n 40 "$SORTIE/journal-app.txt" || true
fi
ls -la "$SORTIE"
exit $STATUT
