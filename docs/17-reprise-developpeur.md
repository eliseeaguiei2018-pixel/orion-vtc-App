# 17 — Guide de reprise pour un développeur (version 2.6)

Ce guide est le point de départ d'un développeur qui reprend ORION. Il dit **où se trouve
quoi**, **comment lancer et vérifier le projet**, **comment livrer** (serveur, mises à jour à
chaud, APK) et **quels accès lui ouvrir**. Il complète `HANDOVER.md` (plus ancien) et les
documents 01 à 16 de ce dossier.

> **Règle d'or des accès.** Le développeur travaille avec **ses propres comptes**. On ne lui
> donne jamais le compte GitHub, le mot de passe ou les clés du fondateur : on l'**invite**
> sur chaque service avec les droits nécessaires, et on les lui retire à son départ.

---

## 1. Ce qu'est ORION, en une page

| Brique | Rôle | Où |
|---|---|---|
| Serveur | API Fastify 5 (Node 22, TypeScript), WebSocket temps réel, SQLite, tarification, dispatch, paiements, SMS | `backend/` |
| App client | Commander une course ou une livraison (moto express, cargo), suivi, paiement | `frontend/index.html` → `frontend/src/App.tsx` |
| ORION Pro | App des chauffeurs et livreurs (offres, navigation, colis, encaissement) | `frontend/driver.html` → `frontend/src/driver/` |
| Console | Poste de travail de chaque employé (Mon poste, SAMU, finances, flotte, simulateur de flotte du PDG…) | `frontend/admin.html` → `frontend/src/admin/` |
| Tableau de bord | Pilotage temps réel de la direction | `frontend/dashboard.html` |
| Apps natives | Capacitor 8 : Android (`frontend/android`, `frontend/chauffeur/android`), iOS (`frontend/ios`) | |
| Bureau | Console et tableau de bord pour Windows et macOS (Electron) | `bureau/` |

Production : serveur sur **Render** (service `orion-backend`, Francfort, disque persistant
`orion-donnees`), décrit par `render.yaml`.

**À lire en premier :** `docs/01-vue-densemble.md`, `docs/05-architecture-scalabilite.md`,
`docs/06-modele-de-donnees.md`, `docs/07-cote-divoire-securite-temps-reel.md`,
`docs/11-console-sessions.md`, `docs/16-rapport-audit.md`, puis `DEPLOIEMENT.md` et `SECURITY.md`.

---

## 2. Lancer le projet sur sa machine

Prérequis : Node 22, npm. Pour les apps natives : Android Studio (JDK 21) et, sur Mac, Xcode.

```bash
# Serveur (port 3100, console locale autorisée en CORS)
cd backend && npm ci
PORT=3100 NODE_ENV=development CORS_ORIGIN=http://localhost:5199 npx tsx src/server.ts

# Interfaces (autre terminal)
cd frontend && npm ci
VITE_API_URL=http://localhost:3100 npx vite --port 5199
```

Puis ouvrir `http://localhost:5199/` (client), `/driver.html` (ORION Pro), `/admin.html`
(console). En développement uniquement, la console accepte l'identifiant `admin` et le mot de
passe `orion-admin-dev` ; en production, les comptes viennent des variables du serveur.
Le serveur de développement crée des chauffeurs de démonstration (dont des motos et un cargo).

---

## 3. Vérifier avant de livrer

```bash
cd backend && npm run typecheck && npm test        # ≈ 495 tests, tous verts
cd frontend && npm run typecheck && npm run check:langues
```

La CI GitHub (`.github/workflows/ci.yml`) refait tout cela à chaque envoi : backend, frontend,
navigateurs (Firefox, Safari/WebKit) ; `apk-client.yml` construit une APK ; `mobile.yml`
les apps natives ; `bureau.yml` les apps de bureau.

**Règles de travail**
- Une branche et une **PR par changement**, CI verte avant toute fusion dans `main`
  (activer la protection de `main` : PR obligatoire, CI obligatoire, relecture).
- **Langues** : chaque texte visible existe en 8 langues. App client : `frontend/src/i18n/`
  (ordre fr, en, es, it, de, ar, zh, ru). ORION Pro : `frontend/src/driver/langues/`
  (ordre fr, en, es, it, ar, zh, de, ru). `npm run check:langues` refuse un texte manquant.
- **Prix** : le serveur fait foi. Les aperçus des apps (`frontend/src/tarifServeur.ts`,
  `frontend/src/api.ts`) reprennent exactement ses règles ; toute modification se fait des
  deux côtés, avec un test serveur.
- **Aucun secret dans le dépôt** (clés, mots de passe, jetons, fichiers `.env.local`).

---

## 4. Livrer

### 4.1 Serveur (Render)
Déploiement depuis le tableau de bord Render (bouton *Manual Deploy* sur le bon commit), ou par
l'API Render avec une clé personnelle du développeur. Les données sont sur le disque
persistant : un déploiement ne les efface pas.

### 4.2 Mises à jour à chaud (sans nouvelle APK)
Les apps installées téléchargent leurs nouveaux écrans depuis le serveur ORION.

```bash
cd frontend
ORION_SERVEUR=https://<serveur> ORION_JETON_ADMIN=<jeton de session direction> \
  bash scripts/publier-mise-a-jour.sh <client|chauffeur|console> <X.Y.Z-AAMMJJHHMM> 25 "notes"
```

Le dernier nombre (25) est la version native minimale. Le script refuse tout paquet qui
contiendrait une clé Google.

### 4.3 APK Android
1. Monter `versionCode` et `versionName` dans `frontend/android/app/build.gradle` et
   `frontend/chauffeur/android/app/build.gradle` (le `versionCode` augmente à chaque APK).
2. Client : `bash scripts/construire-client-google.sh dist`, `npx cap sync android`, puis
   `./gradlew assembleDebug` dans `android/`. ORION Pro : construction `ORION_APP=chauffeur`,
   puis `chauffeur/android`.
3. Publier sur le serveur (les téléphones proposent la mise à jour) :
   `scripts/publier-apk.sh <client|chauffeur> <fichier.apk> <version> <versionCode> "notes"`.

**Clé de signature.** Toutes les APK distribuées jusqu'ici (2.6.0 comprise) sont signées avec
la **même clé**, conservée par le fondateur (empreinte SHA-256 `DE:10:EE:F9:…:0B:F7:DC`).
Android n'installe une mise à jour que si elle porte cette clé : la perdre oblige chaque
utilisateur à désinstaller puis réinstaller. Elle n'est jamais dans le dépôt.
⚠️ C'est une clé de type *debug* : **Google Play la refusera**. Avant la publication sur le
Play Store, créer une vraie clé de publication (Play App Signing) ; les testeurs actuels
devront réinstaller une fois.

### 4.4 iOS
Projets dans `frontend/ios` ; voir `NATIVE.md` et `scripts/construire-ios.sh`. Publication via
le compte Apple Developer d'ORION.

---

## 5. Où vivent les secrets (noms seulement)

| Où | Quoi |
|---|---|
| Variables d'environnement Render | `ADMIN_JWT_SECRET`, `DRIVER_JWT_SECRET`, `CLIENT_JWT_SECRET`, `ADMIN_PASSWORD` / `ADMIN_ACCOUNTS`, `GOOGLE_MAPS_API_KEY`, `MEDICAL_DATA_KEY`, `OTA_SIGNING_KEY`, `TELEMATIQUE_TOKEN`, SMS (`ORANGE_SMS_*`, `TWILIO_*`), WhatsApp (`META_WHATSAPP_*`), Google Cloud (`GCP_*`, `RECAPTCHA_*`), `REDIS_URL` |
| Google Cloud (projet ORION) | clés API (cartes, voix), Secret Manager |
| Secrets GitHub Actions | `GOOGLE_MAPS_API_KEY` (construction des APK en CI) |
| Coffre du fondateur | clé de signature des APK, accès Render, Google Cloud, stores |

La liste complète des réglages du serveur est dans `backend/src/config/index.ts`.

---

## 6. Accès à ouvrir au développeur (et à retirer à son départ)

| Service | Comment | Droit conseillé |
|---|---|---|
| GitHub | dépôt → Settings → Collaborators → *Add people* | Write (pas Admin) |
| Render | inviter dans l'espace Render | membre (pas propriétaire) |
| Google Cloud | IAM → ajouter son adresse | rôle limité au besoin |
| Console ORION | *Personnel & accès* → nouvel identifiant à son nom | rôle technique, jamais le compte PDG |
| Google Play / App Store | inviter comme utilisateur | publication seulement si nécessaire |

Prévoir aussi un **contrat** avec confidentialité et **cession des droits** sur le code : le
code reste la propriété d'ORION.

---

## 7. Premières tâches conseillées
1. Lancer le projet, faire passer les tests, lire les documents de la section 1.
2. Commander une course et une livraison de bout en bout en local (client, ORION Pro, console).
3. Mettre en place la clé de publication Play Store et la protection de `main`.
4. Brancher les passerelles de paiement réelles (Orange Money, Wave, MTN, Moov) et l'opérateur SMS.
