#!/usr/bin/env bash
# Démonstration Android filmée : téléphone en français, installation de l'APK,
# ouverture depuis l'icône et inscription complète. Lancé par .github/workflows/mobile.yml
# une fois l'émulateur démarré (le serveur ORION tourne déjà sur le port 3000).
set -uo pipefail
APK="$1"
SORTIE="$2"
RACINE="$(cd "$(dirname "$0")/../.." && pwd)"
mkdir -p "$SORTIE/captures"
JALONS="$SORTIE/jalons.txt"
jalon() { echo "$(date +%s.%N) $*" >> "$JALONS"; echo "== $*"; }

android_pret() {
  for _ in $(seq 1 150); do
    if [ "$(adb shell getprop sys.boot_completed 2> /dev/null | tr -d '\r')" = "1" ] \
      && adb shell pm path android > /dev/null 2>&1; then return 0; fi
    sleep 2
  done
  echo "L'émulateur ne répond pas"
  return 1
}

jalon "Téléphone en français, heure d'Abidjan"
adb root > /dev/null 2>&1 || true
sleep 3
adb wait-for-device
adb shell "setprop persist.sys.locale fr-FR; setprop persist.sys.timezone Africa/Abidjan; setprop sys.boot_completed 0; stop; sleep 3; start"
sleep 15
adb wait-for-device
android_pret || exit 1
sleep 25
echo "Langue du téléphone : $(adb shell getprop persist.sys.locale | tr -d '\r')"

# Écran allumé, déverrouillé, barre d'état propre (mode démonstration Android).
adb shell input keyevent KEYCODE_WAKEUP
adb shell wm dismiss-keyguard || true
adb shell svc power stayon true || true
adb shell settings put global sysui_demo_allowed 1
demo() { adb shell am broadcast -a com.android.systemui.demo -e command "$@" > /dev/null; }
demo enter
demo clock -e hhmm 0941
demo battery -e level 100 -e plugged false
demo network -e mobile show -e datatype 4g -e level 4
demo network -e wifi show -e level 4
demo notifications -e visible false

# Le serveur ORION de la machine est joignable depuis le téléphone sur localhost:3000.
adb reverse tcp:3000 tcp:3000

# Un portrait dans la galerie du téléphone (dessin, personnage fictif).
adb push "$RACINE/mobile/maestro/medias/portrait-aya.jpg" /sdcard/Pictures/portrait-aya.jpg
adb shell am broadcast -a android.intent.action.MEDIA_SCANNER_SCAN_FILE \
  -d file:///sdcard/Pictures/portrait-aya.jpg > /dev/null 2>&1 || true
adb shell content call --uri content://media/ --method scan_volume --arg external_primary > /dev/null 2>&1 || true

# Maestro installe son pilote avant le tournage, pour qu'il n'apparaisse pas dans la vidéo.
maestro hierarchy > /dev/null 2>&1 || true
adb shell input keyevent KEYCODE_HOME
sleep 3

jalon "Début du tournage"
rm -f "$SORTIE/.fin"
(
  i=0
  while [ ! -f "$SORTIE/.fin" ]; do
    adb shell screenrecord --bit-rate 8000000 --time-limit 170 "/sdcard/orion-$i.mp4" > /dev/null 2>&1 || sleep 1
    i=$((i + 1))
  done
) &
FILM=$!
sleep 4

cd "$SORTIE/captures"
jalon "Liste des applications"
maestro test "$RACINE/mobile/maestro/android/01-ecran-accueil.yaml" || echo "(liste des applications : échec non bloquant)"
sleep 2

jalon "Installation de l'APK"
adb install -r "$APK"
jalon "APK installé"
sleep 4

jalon "Ouverture et inscription"
maestro test "$RACINE/mobile/maestro/android/02-ouvrir-et-inscrire.yaml"
STATUT=$?
jalon "Fin du scénario (code $STATUT)"
sleep 5

if [ "$STATUT" = "0" ]; then
  jalon "Course et bouton Appeler (clavier du téléphone)"
  maestro test "$RACINE/mobile/maestro/android/03-course-et-appeler.yaml" || echo "(appel : échec non bloquant, voir maestro-debug)"
  sleep 3
fi

touch "$SORTIE/.fin"
adb shell pkill -INT screenrecord > /dev/null 2>&1 || adb shell killall -INT screenrecord > /dev/null 2>&1 || true
sleep 4
wait "$FILM" 2> /dev/null || true
for f in $(adb shell ls /sdcard/ | tr -d '\r' | grep '^orion-.*\.mp4$'); do
  adb pull "/sdcard/$f" "$SORTIE/$f" > /dev/null
done

# Journaux utiles au diagnostic.
adb logcat -d -s Capacitor Capacitor/Console chromium > "$SORTIE/logcat-app.txt" 2>&1 || true
cp -r "$HOME/.maestro/tests" "$SORTIE/maestro-debug" 2> /dev/null || true
ls -la "$SORTIE"
exit $STATUT
