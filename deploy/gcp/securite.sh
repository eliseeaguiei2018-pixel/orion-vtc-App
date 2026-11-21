#!/usr/bin/env bash
# SÉCURITÉ GOOGLE CLOUD D'ORION — mise en place, besoin par besoin.
#
#   deploy/gcp/securite.sh <étape>
#
#   apis        active les API nécessaires et crée les deux comptes de service
#   secrets     Secret Manager : crée les secrets du serveur (valeurs saisies, jamais affichées)
#   cles        API Keys : restreint la clé Google Maps de l'application, crée la clé de la passerelle
#   recaptcha   reCAPTCHA Enterprise : crée la clé de site (connexion par SMS, console)
#   identite    Identity Platform : connexion par téléphone, SMS limités à la Côte d'Ivoire
#   passerelle  API Gateway : publie l'API des applications (clé d'application, quotas)
#   armor       Cloud Armor : pare-feu applicatif et anti-saturation devant l'équilibreur
#   controle    relit les réglages (clés non restreintes, secrets, politique Cloud Armor)
#
# Réglages (variables d'environnement) :
#   PROJET   identifiant du projet Google Cloud (obligatoire)
#   REGION   région Cloud Run et API Gateway (défaut : europe-west1)
#   SERVICE  nom du service Cloud Run du serveur ORION (défaut : orion-api)
#   DOMAINE  nom de domaine public de l'API, derrière l'équilibreur (ex. api.orion.ci)
#
# À lancer par une personne qui a les droits d'administration du projet, depuis un poste où
# `gcloud` est connecté (gcloud auth login). Chaque étape peut être relancée sans dégât.
# Ces commandes n'ont PAS été exécutées sur un projet réel depuis l'atelier de développement
# (aucun accès au projet) : lancer d'abord sur un projet d'essai.
set -euo pipefail
: "${PROJET:?PROJET manquant : export PROJET=<identifiant du projet Google Cloud>}"
REGION=${REGION:-europe-west1}
SERVICE=${SERVICE:-orion-api}
DOMAINE=${DOMAINE:-}
ICI=$(cd "$(dirname "$0")" && pwd)
G() { gcloud --project "$PROJET" --quiet "$@"; }
SERVEUR="orion-api@${PROJET}.iam.gserviceaccount.com"        # identité du serveur (Cloud Run)
PASSERELLE="orion-passerelle@${PROJET}.iam.gserviceaccount.com" # identité de la passerelle
existe() { "$@" >/dev/null 2>&1; }

etape_apis() {
  G services enable run.googleapis.com secretmanager.googleapis.com apikeys.googleapis.com \
    recaptchaenterprise.googleapis.com identitytoolkit.googleapis.com apigateway.googleapis.com \
    servicemanagement.googleapis.com servicecontrol.googleapis.com compute.googleapis.com
  existe G iam service-accounts describe "$SERVEUR" || G iam service-accounts create orion-api --display-name "Serveur ORION"
  existe G iam service-accounts describe "$PASSERELLE" || G iam service-accounts create orion-passerelle --display-name "Passerelle ORION (API Gateway)"
  # Le serveur demande des évaluations reCAPTCHA ; il ne reçoit aucun autre droit sur le projet.
  G projects add-iam-policy-binding "$PROJET" --member "serviceAccount:$SERVEUR" --role roles/recaptchaenterprise.agent --condition None >/dev/null
  echo "API actives, comptes de service prêts : $SERVEUR, $PASSERELLE"
}

# Secrets du serveur : nom du secret = variable d'environnement en minuscules, préfixée « orion- ».
SECRETS_GENERES="ADMIN_JWT_SECRET DRIVER_JWT_SECRET CLIENT_JWT_SECRET ADMIN_TOKEN TELEMATIQUE_TOKEN"
SECRETS_SAISIS="ADMIN_PASSWORD ORANGE_SMS_CLIENT_ID ORANGE_SMS_CLIENT_SECRET GOOGLE_MAPS_API_KEY"
nom_secret() { echo "orion-$(echo "$1" | tr 'A-Z_' 'a-z-')"; }

creer_secret() { # $1 = variable, valeur lue sur l'entrée standard
  local nom; nom=$(nom_secret "$1")
  existe G secrets describe "$nom" || G secrets create "$nom" --replication-policy automatic >/dev/null
  G secrets versions add "$nom" --data-file=- >/dev/null
  # Seul le serveur lit ce secret.
  G secrets add-iam-policy-binding "$nom" --member "serviceAccount:$SERVEUR" --role roles/secretmanager.secretAccessor >/dev/null
  echo "  $1=sm://$nom"
}

etape_secrets() {
  echo "Variables à donner au serveur (elles ne contiennent que le NOM des secrets) :"
  for v in $SECRETS_GENERES; do
    existe G secrets describe "$(nom_secret "$v")" && { echo "  $v=sm://$(nom_secret "$v")   (déjà créé, conservé)"; continue; }
    openssl rand -base64 48 | tr -d '\n' | creer_secret "$v"
  done
  # Clé de chiffrement des dossiers médicaux (ORION Assurance) : 32 octets en base64.
  existe G secrets describe "$(nom_secret MEDICAL_DATA_KEY)" && echo "  MEDICAL_DATA_KEY=sm://$(nom_secret MEDICAL_DATA_KEY)   (déjà créé, conservé)" \
    || { openssl rand -base64 32 | tr -d '\n' | creer_secret MEDICAL_DATA_KEY; }
  for v in $SECRETS_SAISIS; do
    existe G secrets describe "$(nom_secret "$v")" && { echo "  $v=sm://$(nom_secret "$v")   (déjà créé, conservé)"; continue; }
    # Saisie masquée : la valeur n'apparaît ni à l'écran ni dans l'historique du terminal.
    read -rsp "Valeur de $v (Entrée pour passer) : " valeur </dev/tty; echo >/dev/tty
    [ -n "$valeur" ] && printf %s "$valeur" | creer_secret "$v"
    unset valeur
  done
  echo "Remplacer une valeur plus tard : printf %s '<valeur>' | gcloud secrets versions add <nom> --data-file=-  puis redéployer le serveur."
}

etape_cles() {
  # 1) Clé Google Maps de l'application cliente. Elle est dans l'APK : sa protection est sa restriction.
  #    L'application affiche Google Maps dans une vue web dont l'origine est https://localhost.
  : "${CLE_MAPS_ID:?CLE_MAPS_ID manquant : identifiant de la clé Maps (gcloud services api-keys list --project $PROJET)}"
  G services api-keys update "$CLE_MAPS_ID" \
    --allowed-referrers="https://localhost/*" \
    --api-target=service=maps-backend.googleapis.com \
    --api-target=service=places.googleapis.com \
    --api-target=service=routes.googleapis.com \
    --api-target=service=geocoding-backend.googleapis.com
  echo "Clé Maps restreinte à quatre API et à l'origine de l'application."
  # 2) Clé de l'application pour API Gateway (créée une fois la passerelle publiée, étape « passerelle »).
  local api_gere; api_gere=$(G api-gateway apis describe orion --format 'value(managedService)' 2>/dev/null || true)
  if [ -n "$api_gere" ]; then
    G services enable "$api_gere"
    G services api-keys create --display-name "ORION applications (API Gateway)" --api-target=service="$api_gere"
    echo "Clé de passerelle créée : sa valeur (keyString) va dans VITE_ORION_API_KEY à la construction des applications."
  else
    echo "Passerelle pas encore publiée : relancer « cles » après l'étape « passerelle » pour créer la clé de l'application."
  fi
}

etape_recaptcha() {
  # Clé à score (sans case à cocher), pour l'application (origine localhost) et la console.
  local domaines="localhost${DOMAINE:+,$DOMAINE}${DOMAINE_CONSOLE:+,$DOMAINE_CONSOLE}"
  G recaptcha keys create --display-name "ORION connexion" --web --integration-type score --domains "$domaines"
  echo "Reporter l'identifiant de la clé dans RECAPTCHA_SITE_KEY (serveur) et VITE_RECAPTCHA_SITE_KEY (applications)."
  echo "Commencer par RECAPTCHA_MODE=observe, lire les scores dans les journaux, puis passer à enforce."
}

etape_identite() {
  # Identity Platform s'active une première fois dans la console (Identity Platform > Activer).
  local jeton; jeton=$(gcloud auth print-access-token)
  # Connexion par téléphone activée ; SMS autorisés vers la Côte d'Ivoire seulement : un robot ne
  # peut pas faire envoyer des SMS surtaxés vers l'étranger aux frais d'ORION.
  curl -sS -X PATCH -H "Authorization: Bearer $jeton" -H "X-Goog-User-Project: $PROJET" -H 'Content-Type: application/json' \
    "https://identitytoolkit.googleapis.com/admin/v2/projects/$PROJET/config?updateMask=signIn.phoneNumber.enabled,smsRegionConfig" \
    -d '{"signIn":{"phoneNumber":{"enabled":true}},"smsRegionConfig":{"allowlistOnly":{"allowedRegions":["CI"]}}}' | head -c 600; echo
  echo "Serveur : IDENTITY_PLATFORM=true et GCP_PROJECT_ID=$PROJET. Applications : VITE_IDENTITY_PLATFORM_KEY=<clé web du projet>."
}

etape_passerelle() {
  : "${DOMAINE:?DOMAINE manquant : nom public de l'API derrière l'équilibreur (ex. api.orion.ci)}"
  local config="orion-$(date +%Y%m%d-%H%M%S)" spec; spec=$(mktemp --suffix .yaml)
  sed -e "s|__ADRESSE__|https://$DOMAINE|g" "$ICI/api-gateway/openapi.yaml" > "$spec"
  existe G api-gateway apis describe orion || G api-gateway apis create orion --display-name "ORION — API des applications"
  # La passerelle s'identifie auprès du serveur avec le compte orion-passerelle.
  G api-gateway api-configs create "$config" --api orion --openapi-spec "$spec" --backend-auth-service-account "$PASSERELLE"
  if existe G api-gateway gateways describe orion --location "$REGION"; then
    G api-gateway gateways update orion --location "$REGION" --api orion --api-config "$config"
  else
    G api-gateway gateways create orion --location "$REGION" --api orion --api-config "$config"
  fi
  rm -f "$spec"
  echo "Passerelle : https://$(G api-gateway gateways describe orion --location "$REGION" --format 'value(defaultHostname)')"
  echo "Serveur : GCP_GATEWAY_SERVICE_ACCOUNT=$PASSERELLE  GCP_GATEWAY_AUDIENCE=https://$DOMAINE  GCP_GATEWAY_REQUIRED=true"
  echo "Applications : VITE_API_URL=<adresse de la passerelle>  VITE_WS_URL=https://$DOMAINE  VITE_ORION_API_KEY=<clé créée par l'étape cles>"
}

etape_armor() {
  local p=orion-armor
  existe G compute security-policies describe $p || G compute security-policies create $p --description "ORION : pare-feu applicatif et anti-saturation"
  regle() { local prio=$1; shift; existe G compute security-policies rules describe "$prio" --security-policy $p || G compute security-policies rules create "$prio" --security-policy $p "$@"; }
  # Attaques connues (injections SQL, scripts, lecture de fichiers, exécution de code, robots d'exploration).
  local n=1000
  for jeu in sqli-v33-stable xss-v33-stable lfi-v33-stable rfi-v33-stable rce-v33-stable scannerdetection-v33-stable protocolattack-v33-stable; do
    regle $n --expression "evaluatePreconfiguredWaf('$jeu', {'sensitivity': 1})" --action deny-403 --description "WAF $jeu"
    n=$((n + 10))
  done
  # Demandes de code SMS et connexions : 10 par minute et par adresse, puis 10 minutes de refus.
  # XFF-IP : l'adresse d'origine du client, y compris quand l'appel arrive par la passerelle.
  regle 2000 --expression "request.path.matches('^/(clients|drivers)/auth/') || request.path.matches('^/admin/login')" \
    --action rate-based-ban --rate-limit-threshold-count 10 --rate-limit-threshold-interval-sec 60 \
    --ban-duration-sec 600 --conform-action allow --exceed-action deny-429 --enforce-on-key XFF-IP \
    --description "Connexions : anti-essais en série"
  # Tout le reste : 600 requêtes par minute et par adresse (une application en fait quelques dizaines).
  regle 3000 --src-ip-ranges "*" --action throttle --rate-limit-threshold-count 600 --rate-limit-threshold-interval-sec 60 \
    --conform-action allow --exceed-action deny-429 --enforce-on-key XFF-IP --description "Plafond général par adresse"
  # Détection automatique des attaques par saturation (niveau applicatif).
  G compute security-policies update $p --enable-layer7-ddos-defense
  if [ -n "${BACKEND:-}" ]; then
    G compute backend-services update "$BACKEND" --global --security-policy $p
    echo "Politique $p attachée au service d'arrière-plan $BACKEND."
  else
    echo "Politique $p prête. L'attacher à l'équilibreur : BACKEND=<service d'arrière-plan> $0 armor"
  fi
  echo "Cloud Run ne doit accepter que l'équilibreur : gcloud run services update $SERVICE --region $REGION --ingress internal-and-cloud-load-balancing"
}

etape_controle() {
  echo "— Clés d'API (une clé sans restriction est une alerte) :"
  G services api-keys list --format 'table(displayName, uid, restrictions.apiTargets[].service.list():label=API, restrictions.browserKeyRestrictions.allowedReferrers.list():label=SITES, restrictions.androidKeyRestrictions.allowedApplications[].packageName.list():label=ANDROID)'
  echo "— Secrets :"; G secrets list --filter 'name~orion-' --format 'table(name.basename(), createTime)'
  echo "— Cloud Armor :"; G compute security-policies rules list --security-policy orion-armor --format 'table(priority, action, description)' 2>/dev/null || echo "  politique orion-armor absente"
  echo "Contrôle par le serveur lui-même (API Keys API) : cd backend && npm run gcp:controle"
}

case "${1:-}" in
  apis|secrets|cles|recaptcha|identite|passerelle|armor|controle) "etape_$1" ;;
  *) sed -n '2,24p' "$0"; exit 1 ;;
esac
