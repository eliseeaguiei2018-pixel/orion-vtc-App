#!/bin/sh
# Démarrage du conteneur : le disque persistant (Render, Docker…) est monté au nom de root.
# On rend son dossier au compte « node », puis on lance le serveur SANS les droits root
# (su de BusyBox, déjà présent dans l'image : rien à installer).
set -e
if [ "$(id -u)" = "0" ]; then
  if [ -n "$DB_PATH" ] && [ "$DB_PATH" != ":memory:" ]; then
    dossier=$(dirname "$DB_PATH")
    mkdir -p "$dossier"
    chown -R node:node "$dossier" 2>/dev/null || true
  fi
  exec su -p -s /bin/sh node -c 'exec "$0" "$@"' -- "$@"
fi
exec "$@"
