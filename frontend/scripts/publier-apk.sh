#!/usr/bin/env bash
# PUBLIER UNE NOUVELLE APK d'une app ORION (client, chauffeur ou console) SUR LE SERVEUR.
#
#   ORION_SERVEUR=https://… ORION_JETON_ADMIN=… scripts/publier-apk.sh <app> <fichier.apk> <version> <versionCode> [notes] [obligatoire]
#
# Plus d'APK envoyée à la main : le serveur l'héberge et l'annonce en direct. À l'ouverture, l'app
# installée (si son versionCode est plus ancien) affiche « Nouvelle version de l'application » et
# la télécharge depuis le serveur ; Android propose alors « Mettre à jour » et garde les données.
# Lien court pour une première installation : $ORION_SERVEUR/telecharger/<client|pro|console>.
#
# Android n'installe la mise à jour que si l'APK est signée avec LA MÊME CLÉ que l'app en place :
# si ORION_CERT_SHA256 est fourni, le script vérifie l'empreinte du certificat avant d'envoyer.
# Les mises à jour d'écrans et de règles passent par scripts/publier-mise-a-jour.sh (sans APK).
set -euo pipefail
APP="${1:?app : client, chauffeur ou console}"
APK="${2:?fichier APK}"
VERSION="${3:?version, par exemple 2.1.0}"
CODE="${4:?versionCode Android (doit augmenter à chaque APK)}"
NOTES="${5:-}"
OBLIGATOIRE="${6:-0}"
: "${ORION_SERVEUR:?adresse du serveur ORION (ORION_SERVEUR)}"
: "${ORION_JETON_ADMIN:?jeton de session de la direction (ORION_JETON_ADMIN)}"
[ -f "$APK" ] || { echo "APK introuvable : $APK" >&2; exit 1; }

# Contrôles avec les outils Android quand ils sont là : versionCode et clé de signature.
OUTILS=$(ls -d "${ANDROID_HOME:-/nonexistent}"/build-tools/*/ 2>/dev/null | sort -V | tail -1 || true)
if [ -n "$OUTILS" ] && [ -x "$OUTILS/aapt2" ]; then
  LU=$("$OUTILS/aapt2" dump badging "$APK" 2>/dev/null | sed -n "s/.*versionCode='\([0-9]*\)'.*/\1/p" | head -1)
  [ "$LU" = "$CODE" ] || { echo "Refus : l'APK porte le versionCode $LU, pas $CODE." >&2; exit 1; }
fi
if [ -n "${ORION_CERT_SHA256:-}" ] && [ -n "$OUTILS" ] && [ -x "$OUTILS/apksigner" ]; then
  CERT=$("$OUTILS/apksigner" verify --print-certs "$APK" 2>/dev/null | sed -n 's/.*SHA-256 digest: //p' | head -1 | tr -d ':' | tr 'A-F' 'a-f')
  ATTENDU=$(echo "$ORION_CERT_SHA256" | tr -d ':' | tr 'A-F' 'a-f')
  [ "$CERT" = "$ATTENDU" ] || { echo "Refus : APK signée avec une autre clé ($CERT) ; Android refuserait la mise à jour." >&2; exit 1; }
fi

ENC=$(python3 -c "import sys,urllib.parse; print(urllib.parse.quote(sys.argv[1]))" "$NOTES")
echo "APK $APP $VERSION (code $CODE) : $(du -h "$APK" | cut -f1)"
curl -sS --fail-with-body -X PUT \
  -H "authorization: Bearer $ORION_JETON_ADMIN" -H 'content-type: application/vnd.android.package-archive' \
  --data-binary @"$APK" \
  "$ORION_SERVEUR/admin/mises-a-jour/$APP/apk?version=$VERSION&versionCode=$CODE&notes=$ENC&obligatoire=$OBLIGATOIRE" \
  | python3 -c "import json,sys; v=json.load(sys.stdin)['apk']; print('Publiée :', v['app'], v['version'], 'code', v['versionCode'], v['taille'], 'octets ->', v['chemin'])"
