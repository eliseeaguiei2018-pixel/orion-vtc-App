# Sécurité Google Cloud d'ORION

Six services Google, chacun appliqué au besoin de l'application qui lui correspond.

| Besoin de l'application | Service Google | Ce que fait le code | Mise en place |
|---|---|---|---|
| Les secrets du serveur (signature des sessions client, chauffeur et console, jeton d'administration, identifiants de l'opérateur SMS, clé de chiffrement des dossiers médicaux, jeton des boîtiers de véhicules) ne doivent être écrits nulle part | **Secret Manager** | Une variable `sm://nom` est remplacée au démarrage par la valeur du secret, avant la lecture de la configuration. Secret illisible : le serveur ne démarre pas. `backend/src/modules/gcp/secrets.ts`, `backend/src/server.ts` | `securite.sh secrets` |
| La clé Google Maps est dans l'application : quiconque la copie pourrait l'utiliser aux frais d'ORION | **API Keys** | Restriction de la clé à quatre API et à l'origine de l'application ; contrôle des clés non restreintes par le serveur (`npm run gcp:controle`). `backend/src/modules/gcp/cles.ts` | `securite.sh cles` |
| Des robots peuvent demander des codes SMS à la chaîne (chaque SMS est payé) ou essayer des mots de passe sur la console | **reCAPTCHA Enterprise** | L'application joint un jeton à la demande de code (client, chauffeur) et à la connexion console ; le serveur le fait évaluer par Google et refuse sous le seuil. `backend/src/modules/gcp/recaptcha.ts`, `frontend/src/securiteGoogle.ts` | `securite.sh recaptcha` |
| L'API ne doit répondre qu'aux applications ORION, avec un plafond d'appels | **API Gateway** | Clé d'application sur chaque appel (`x-api-key`), quota, identité de la passerelle vérifiée par le serveur, qui refuse les appels directs. `api-gateway/openapi.yaml`, `backend/src/modules/gcp/securite.ts` | `securite.sh passerelle` |
| Un compte client = un numéro de téléphone réellement vérifié | **Identity Platform** | Google envoie et contrôle le code SMS (vers la Côte d'Ivoire uniquement) ; le serveur vérifie le jeton d'identité signé par Google et ouvre le compte ORION du numéro. `backend/src/modules/gcp/identite.ts`, route `POST /clients/auth/identity` | `securite.sh identite` |
| Attaques web (injections, robots d'exploration) et saturation du serveur | **Cloud Armor** | Politique devant l'équilibreur : règles contre les attaques connues, 10 demandes de connexion par minute et par adresse, plafond général, détection des saturations | `securite.sh armor` |

## Parcours d'une requête

```
application cliente / chauffeur ──► API Gateway ──► équilibreur + Cloud Armor ──► serveur ORION (Cloud Run)
        (clé d'application)         (clé, quota)      (pare-feu, plafonds)        (jeton de la passerelle vérifié,
                                                                                  session ORION, reCAPTCHA, secrets)
suivi en direct, console, tableau de bord ───────────► équilibreur + Cloud Armor ──► serveur ORION
```

Cloud Run n'accepte que l'équilibreur (`--ingress internal-and-cloud-load-balancing`) : personne
n'atteint le serveur sans passer par Cloud Armor.

## Ordre de mise en place

```bash
export PROJET=<identifiant du projet>  DOMAINE=api.orion.ci
deploy/gcp/securite.sh apis          # API et comptes de service
deploy/gcp/securite.sh secrets       # affiche les lignes VARIABLE=sm://… à donner au serveur
deploy/gcp/securite.sh recaptcha     # clé de site
deploy/gcp/securite.sh identite      # connexion par téléphone, SMS vers la Côte d'Ivoire seulement
deploy/gcp/securite.sh armor         # puis BACKEND=<service d'arrière-plan> deploy/gcp/securite.sh armor
deploy/gcp/securite.sh passerelle    # publie l'API
CLE_MAPS_ID=<identifiant> deploy/gcp/securite.sh cles
deploy/gcp/securite.sh controle
```

## Réglages

Serveur (`backend/.env.example`) :

| Variable | Rôle |
|---|---|
| `CLIENT_JWT_SECRET=sm://orion-client-jwt-secret` (et les autres secrets) | Secret Manager |
| `GCP_PROJECT_ID` | projet (inutile sur Cloud Run pour les secrets ; requis pour Identity Platform) |
| `RECAPTCHA_MODE` (`off`, `observe`, `enforce`), `RECAPTCHA_SITE_KEY`, `RECAPTCHA_MIN_SCORE` | reCAPTCHA Enterprise |
| `IDENTITY_PLATFORM=true`, `IDENTITY_PLATFORM_TENANT` | Identity Platform |
| `GCP_GATEWAY_SERVICE_ACCOUNT`, `GCP_GATEWAY_AUDIENCE`, `GCP_GATEWAY_REQUIRED`, `GCP_GATEWAY_EXEMPT` | API Gateway |
| `TRUST_PROXY_HOPS` | nombre de relais devant le serveur, pour que le limiteur de débit voie l'adresse du client |

Applications (variables de construction, `frontend/.env.example`) : `VITE_RECAPTCHA_SITE_KEY`,
`VITE_ORION_API_KEY`, `VITE_IDENTITY_PLATFORM_KEY`, `VITE_WS_URL`.

Rien n'est actif sans ces réglages : hors de Google Cloud, le serveur et les applications
fonctionnent comme avant.

## Ce qui est vérifié, ce qui ne l'est pas

- **Vérifié par les tests du dépôt** (Google simulé, aucun appel réseau) : chargement des secrets,
  identification du serveur, évaluations reCAPTCHA (accepté, score bas, mauvaise action, panne),
  vérification des jetons Identity Platform (signature, projet, dates, falsification), ouverture
  de compte par jeton, reconnaissance et obligation de la passerelle, contrôle des clés, et
  couverture de toutes les routes du serveur par la configuration de la passerelle.
  `backend/tests/securite-google*.test.ts`, `backend/tests/passerelle-couverture.test.ts`.
- **Pas encore vérifié** : rien n'a été exécuté sur un projet Google réel — l'atelier de
  développement n'a aucun accès au projet. `securite.sh` et `openapi.yaml` sont à lancer d'abord
  sur un projet d'essai ; `gcloud` valide la configuration de la passerelle à sa création.
  Le parcours Identity Platform côté application (envoi et contrôle du code par Google) suit
  l'API REST documentée mais n'a pas été joué contre Google. `TRUST_PROXY_HOPS` se règle en
  observant l'adresse vue par le serveur une fois l'équilibreur en place.
- **Limites à connaître** : la clé Maps d'une application à vue web ne peut être restreinte que
  par origine (`https://localhost/*`) et par API, pas par signature de l'application ; ses quotas
  journaliers restent à fixer dans la console Google. Le quota de la passerelle porte sur la clé
  de l'application, pas sur chaque utilisateur : la limite par personne reste celle du serveur et
  de Cloud Armor.
