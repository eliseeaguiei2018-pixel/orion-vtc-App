# 🚀 Mettre ORION en ligne — guide pas à pas

Objectif : obtenir un **lien internet** que tu peux envoyer à des testeurs à Abidjan,
puis (plus tard) une **app installable** sur téléphone.

> Rappel : 2 morceaux à mettre en ligne — le **backend** (moteur) et le **frontend** (l'app).

---

## ⭐ Le plus simple : un lien démo à partager (sans backend)

L'app fonctionne en **mode démo** (données simulées) : il suffit de publier le **frontend**
pour obtenir un **lien cliquable** que tes connaissances peuvent ouvrir sur leur téléphone.

### Option 1 — GitHub Pages (gratuit, sur ton propre dépôt, automatique)
J'ai déjà ajouté le workflow `.github/workflows/deploy-pages.yml`. Une seule action de ta part :
1. Sur GitHub, va dans **Settings → Pages**.
2. **Build and deployment → Source** : choisis **« GitHub Actions »**.
3. (Si besoin) onglet **Actions** → ouvre « Deploy demo to GitHub Pages » → **Run workflow**.
4. Après ~2 min, ton lien est prêt :
   **`https://eliseeaguiei2018-pixel.github.io/orion-vtc-App/`** ← partage-le ! 🎉

> Le workflow se relance à chaque mise à jour. Si le déploiement est bloqué car la branche
> n'est pas `main`, fusionne la PR dans `main` (ou dis-le-moi, je t'explique).

### Option 2 — Vercel (gratuit, ~5 clics, lien le plus rapide)
1. Va sur **https://vercel.com** → **Continue with GitHub**.
2. **Add New → Project** → choisis `orion-vtc-App` → **Import**.
3. **Root Directory** : choisis **`frontend`**.
4. **Deploy**. Au bout d'une minute tu obtiens un lien `https://orion-xxx.vercel.app` à partager.

> Aucune des deux options ne nécessite le backend : la démo tourne toute seule.

---

## Niveau 2 — Lien web partageable

### Étape A · Mettre le backend en ligne (Render — gratuit pour tester)
1. Crée un compte sur **https://render.com** (connexion avec GitHub).
2. **New → Blueprint**, choisis ton dépôt `orion-vtc-App`.
3. Render détecte le fichier **`render.yaml`** à la racine et crée le service `orion-backend`.
4. Lance le déploiement. À la fin tu obtiens une URL, ex. `https://orion-backend.onrender.com`.
5. Vérifie : ouvre `https://orion-backend.onrender.com/health/ready` → tu dois voir `{"status":"ready"}`.

### Étape B · Mettre le frontend en ligne (Vercel — gratuit)
1. Crée un compte sur **https://vercel.com** (connexion avec GitHub).
2. **Add New → Project**, choisis `orion-vtc-App`.
3. **Root Directory** : sélectionne le dossier **`frontend`**.
4. Variable d'environnement à ajouter :
   - `VITE_API_URL` = l'URL de ton backend (ex. `https://orion-backend.onrender.com`)
5. Déploie. Tu obtiens un lien, ex. `https://orion.vercel.app` → **c'est ton app en ligne** 🎉

### Étape C · Sécuriser (recommandé)
- Sur Render, change `CORS_ORIGIN` pour mettre **l'URL exacte de ton front** (au lieu de `*`).
  Si tu publies les apps mobiles, ajoute leurs origines : les apps Capacitor appellent le
  serveur depuis `capacitor://localhost` (iPhone) et `https://localhost` (Android). Exemple :
  `CORS_ORIGIN=https://orion.vercel.app,capacitor://localhost,https://localhost`.
- En production réelle, mets `SIMULATE_RIDES=false` (l'app chauffeur fournit désormais les vraies positions).
- **App chauffeur** : `DRIVER_JWT_SECRET` (généré automatiquement par le blueprint Render),
  puis, une fois l'opérateur SMS activé, `DRIVER_AUTH_STRICT=true`.
- **App cliente** : `CLIENT_JWT_SECRET` (généré automatiquement par le blueprint Render). Le
  compte client repose sur un numéro vérifié par code SMS, envoyé par l'opérateur SMS ; le
  code de test n'est renvoyé à l'app qu'en développement.
- **Opérateur SMS** (indispensable pour ouvrir l'app au public) : voir la section
  « Opérateur SMS » ci-dessous.
- **Revue Apple / Google** : `CLIENT_REVIEW_PHONE` et `CLIENT_REVIEW_CODE` réservent un numéro
  de démonstration qui reçoit toujours le même code (lui seul). Voir `store/README.md` §4.

### Opérateur SMS (codes de connexion)
Les clients et les chauffeurs se connectent avec un code reçu par SMS. Le serveur sait
l'envoyer par **Orange Côte d'Ivoire** (recommandé) ou par **Twilio** (secours).

1. Sur **https://developer.orange.com**, crée un compte, puis une application, et abonne-la
   à l'API **« SMS Côte d'Ivoire »** (achat d'un forfait de SMS).
2. Copie le **Client ID** et le **Client Secret** de l'application.
3. Demande à Orange la validation du nom d'expéditeur **ORION** (affiché à la place du
   numéro sur le téléphone du client).
4. Sur Render, renseigne : `SMS_PROVIDER=orange`, `ORANGE_SMS_CLIENT_ID`,
   `ORANGE_SMS_CLIENT_SECRET`. Redéploie.
5. Vérifie : `https://orion-backend.onrender.com/health/ready` doit afficher
   `"sms":{"fournisseur":"orange","actif":true}`. Puis inscris-toi avec ton propre numéro.

Protections intégrées : le code n'est jamais écrit dans les journaux ni renvoyé à l'app en
production ; 30 s minimum entre deux codes et 5 codes maximum par numéro et par heure ;
seuls les numéros `+225` reçoivent un SMS (`SMS_ALLOWED_PREFIXES`) ; si l'opérateur ne
répond pas, le client voit « Le SMS n'a pas pu être envoyé » et peut réessayer aussitôt.
Sans opérateur configuré, un serveur de production refuse poliment l'envoi du code au lieu
de laisser le client attendre.

Twilio : `SMS_PROVIDER=twilio`, `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN` et
`TWILIO_FROM` (ou `TWILIO_MESSAGING_SERVICE_SID`).

---

## Niveau 3 — Vraie app mobile (Play Store / App Store)

Les applications natives **existent déjà** dans le dépôt (Capacitor 8) :
`frontend/android` (Android Studio) et `frontend/ios` (Xcode 26). Elles embarquent l'app web
compilée et appellent le même serveur.

```bash
cd frontend
VITE_API_URL=https://orion-backend.onrender.com npm run build
npx cap sync          # copie l'app web dans les projets Android et iOS
npx cap open android  # Android Studio : Build → Generate Signed App Bundle
npx cap open ios      # Xcode : Product → Archive (Mac obligatoire)
```

- Détails techniques, permissions et compilation : [`NATIVE.md`](NATIVE.md).
- Textes des fiches, visuels, confidentialité et compte de revue : [`store/README.md`](store/README.md).
- Compilation automatique et démonstration sur émulateurs : workflow GitHub
  **« Applications mobiles »** (`.github/workflows/mobile.yml`).

> La publication sur les stores nécessite un compte développeur (Google Play : 25 $ une fois ;
> Apple : 99 $/an) et l'opérateur SMS activé sur le serveur (section « Opérateur SMS »).

---

## Console Admin & supervision SAMU

Le dashboard d'administration est une **page séparée** de l'app cliente :

- En local : `http://localhost:5173/admin.html` (dev) ou `/admin.html` après build.
- Fonctionnalités : KPIs (courses actives, chauffeurs en ligne, revenu/commission, alertes),
  **carte de supervision de la flotte** (positions temps réel), **file SAMU** (SOS/accidents
  avec prise en charge / résolution), tables Courses et Chauffeurs (KYC, état, note).
- **Écran de connexion** : à l'ouverture, la console demande un **identifiant + mot de passe**.
  Le backend vérifie les identifiants et renvoie une **session JWT signée** (expiration
  12 h par défaut), mémorisée sur le poste ; bouton **Déconnexion** dans l'en-tête. Une
  session expirée renvoie automatiquement à l'écran de connexion.
  - **Compte par défaut (dev)** : `ADMIN_USERNAME` / `ADMIN_PASSWORD` (défaut `admin` /
    `orion-admin-dev`) = compte **super_admin**. À changer impérativement en production.
  - **Secret de signature** : définir `ADMIN_JWT_SECRET` (secret fort) et, au besoin,
    `ADMIN_JWT_TTL_SECONDS` (durée de session).
  - **Couches d'accès par rôle** : définir les comptes via `ADMIN_USERS` (JSON, mots de
    passe **hachés** — jamais en clair), généré avec `npm run hash-password -- <user> <mdp> <role>`.
    Ex. `[{"username":"awa","name":"Awa (Finance)","role":"finance","salt":"…","hash":"…"}]`.
    Rôles : **direction** `ceo`, `dg`, `daa`, `coo` (accès total + approbation des virements),
    `super_admin` (technique), `cfo` (finance complète, virements **sur aval de la direction**),
    puis `ops`, `finance`, `support`, `viewer`. Chaque rôle ne voit/agit que sur ses sections.
  - **Trésorerie (double validation)** : le CFO soumet une demande de virement ; seul un
    dirigeant peut l'approuver (exécution) ou la rejeter — jamais sa propre demande.
  - **Anti-brute-force** : 5 échecs de connexion → compte verrouillé 15 minutes.
  - **2FA direction (TOTP)** : générer un secret avec `npm run totp-secret -- <username>`,
    l'ajouter au champ `totp` du compte dans `ADMIN_USERS`, scanner l'URL `otpauth://` dans
    Google/Microsoft Authenticator. `ADMIN_REQUIRE_2FA=true` pour l'imposer à toute la direction.
  - **Sessions actives** : la direction voit qui est connecté (IP, appareil, activité) et
    peut **révoquer** une session — déconnexion immédiate de l'employé.
  - **Automatisation / intégrations** : l'en-tête `x-admin-token` (variable `ADMIN_TOKEN`)
    reste accepté pour les scripts serveur-à-serveur, en complément du login JWT humain.
  - Sections de la console : Vue d'ensemble, Supervision SAMU, Courses, Chauffeurs,
    **Tarification** (augmenter/réduire les prix, effet immédiat), Rôles & accès.
- Sans backend joignable, la console bascule en **mode démo** (données simulées) pour la présentation.

### Mettre l'admin sur un sous-domaine dédié (recommandé)
1. Dans Vercel → **Domains**, ajoute `admin.tondomaine.ci` au projet frontend.
2. Dans `frontend/vercel.json`, remplace `admin.orion.ci` par ce domaine (règles `rewrites`
   déjà prêtes : sur ce sous-domaine, la racine sert `admin.html`).
3. Résultat : `tondomaine.ci` = app client ; `admin.tondomaine.ci` = console admin.
4. Sécurité en plus (optionnel) : mot de passe Vercel ou **liste d'IP** (bureau ORION).

> 🔒 En production : remplacer le jeton simple par une authentification forte (SSO/JWT + rôles)
> et un **audit log immuable** des actions admin.

## Carte réelle de Côte d'Ivoire et itinéraires routiers

La carte de l'app est une **vraie carte vectorielle** dessinée à partir d'OpenStreetMap :
routes, ponts (HKB, De Gaulle, Félix Houphouët-Boigny, Alassane Ouattara…), échangeurs,
**voies en construction** (en pointillés), quartiers et lagune. Les tuiles viennent
d'OpenFreeMap (gratuit, sans clé, données mises à jour chaque semaine) : un pont ou un
échangeur ajouté dans OpenStreetMap apparaît dans l'app la semaine suivante, sans mise à jour.

L'itinéraire suit les **vraies routes** : le serveur le calcule avec OSRM, le client voit le
tracé, le pont emprunté (« via Pont… »), et la voiture avance le long de la route.

| Variable | Où | Rôle |
|----------|----|------|
| `OSRM_URL` | Backend | Serveur d'itinéraires. Par défaut le serveur public OSRM ; en production, un serveur OSRM d'ORION chargé avec l'extrait OpenStreetMap de la Côte d'Ivoire (Geofabrik). |
| `VITE_MAP_TILES_URL` | Frontend | Serveur de tuiles vectorielles d'ORION (facultatif). |
| `VITE_MAP_GLYPHS_URL` | Frontend | Polices des libellés (facultatif). |
| `VITE_MAP_PROVIDER=stylise` | Frontend | Force la carte stylisée hors-ligne (démo sans réseau). |

> ℹ️ Sans réseau, ou si les tuiles ne répondent pas, l'app bascule seule sur la carte
> stylisée ; si OSRM ne répond pas, le trajet est tracé à vol d'oiseau. La course n'est
> jamais bloquée par la carte. Les crédits (© OpenStreetMap, OpenFreeMap, OSRM) sont
> affichés sur la carte et dans les mentions légales.

## ORION Assurance : dossiers de premiers secours

Les dossiers médicaux (identité, pièce, CMU, groupe sanguin, antécédents, allergies,
traitements, personne à prévenir) sont **chiffrés sur le serveur** (AES-256-GCM, une clé
dédiée, chaque dossier lié à son titulaire). Ils ne sont jamais stockés sur le téléphone.

1. Génère la clé **une seule fois** : `openssl rand -base64 32`.
2. Render → Environment → `MEDICAL_DATA_KEY` = cette valeur. Garde-la aussi dans le coffre
   de la direction : **perdue ou changée, tous les dossiers deviennent illisibles**.
3. Sans clé en production, l'inscription est simplement indisponible (le reste de l'app marche).

Accès console : permission `medical:read` (rôle opérations), **uniquement** pour l'agent qui a
pris en charge une alerte SOS en cours. Chaque ouverture est inscrite au journal d'audit et
signalée au client par un message ; toute tentative hors de ces conditions est refusée et journalisée.

## Messagerie ORION et contrôle de sécurité

La console (section **Messages clients**) écrit aux clients dans l'app : information,
consigne, ou contrôle de sécurité « votre course se passe-t-elle bien ? » avec réponses
rapides. L'app envoie aussi ce contrôle d'elle-même pendant chaque course, après
`SAFETY_CHECKIN_SECONDS` secondes (180 par défaut, 0 pour désactiver). La réponse
« Je ne me sens pas en sécurité » lève aussitôt une alerte dans la file SAMU.

## Activer Google Maps côté itinéraires (optionnel)
1. Obtiens une clé sur Google Cloud (APIs : Directions, Places, Maps JavaScript).
2. Backend : variable `GOOGLE_MAPS_API_KEY` (Render → Environment).
3. Frontend : variable `VITE_GOOGLE_MAPS_API_KEY` (Vercel → Environment).

Sans clé, ORION fonctionne avec sa carte stylisée et son calcul d'itinéraire interne.

---

## Aide
Un blocage ? Copie le message d'erreur (Render/Vercel affichent des logs) et envoie-le moi,
je te débloque.
