# 📱 ORION — Couche native (iOS & Android)

Ce guide décrit comment l'app web ORION devient une **vraie app mobile** (Play Store / App
Store) via **Capacitor**, et comment chaque fonctionnalité native demandée est câblée, en
tenant compte des **nouveautés Apple & Android récentes**.

> L'app web (dossier `frontend/`) reste la source unique : Capacitor l'emballe sans réécriture.

## 1. État actuel : les deux apps existent

| | Android | iOS |
|---|---|---|
| Projet | `frontend/android` (Gradle) | `frontend/ios/App` (Xcode, Swift Package Manager) |
| Capacitor | 8.6 | 8.6 |
| Cible | Android 16, API 36 (minimum Android 7, API 24) | SDK iOS 26 / Xcode 26 (minimum iOS 15) |
| Identifiant | `ci.orion.app` | `ci.orion.app` |
| Version | 1.0.0 (code 1) | 1.0.0 (build 1) |
| Orientation | portrait | portrait, iPhone uniquement |
| Autorisations déclarées | Internet, caméra (facultative) | caméra, photothèque (phrases en français) |

**Principe : ne déclarer que ce que l'app utilise vraiment.** Apple et Google refusent une app
qui demande une autorisation sans s'en servir. Le tableau §2 liste les autorisations à
ajouter **au moment où** la fonctionnalité correspondante arrive (GPS chauffeur, notifications…).

Déjà câblé :
- **Bouton retour Android** : revient à l'écran parent (estimation → accueil, profil →
  paramètres…), ferme d'abord le SOS ou la fenêtre d'annulation, et met l'app en arrière-plan
  depuis l'accueil (`App.tsx`, `@capacitor/app`).
- **Photo de profil** : selfie en direct (caméra frontale) ou galerie ; si la caméra est
  absente, l'app propose la galerie.
- **Icônes et écran de démarrage** générés depuis `frontend/assets/` :
  `npx @capacitor/assets generate --iconBackgroundColor '#04100b' --splashBackgroundColor '#04100b'`.
- **Réseau** : HTTPS obligatoire en production ; le HTTP local (`localhost`, `10.0.2.2`)
  n'est autorisé que dans la version de test Android et via `NSAllowsLocalNetworking` sur iOS.

### Compiler
```bash
cd frontend
VITE_API_URL=https://orion-backend.onrender.com npm run build   # adresse du serveur
npx cap sync

# Android : APK de test, puis bundle signé pour le Play Store
cd android && ./gradlew assembleDebug        # app/build/outputs/apk/debug/app-debug.apk
./gradlew bundleRelease                      # nécessite la clé de signature (Android Studio)

# iOS (Mac + Xcode 26) : ouvrir, choisir l'équipe Apple, puis Product → Archive
npx cap open ios
```

Le serveur doit accepter les origines des apps : `CORS_ORIGIN` contient
`capacitor://localhost` (iPhone) et `https://localhost` (Android).

### Compilation et démonstration automatiques (GitHub Actions)
Le workflow **« Applications mobiles »** (`.github/workflows/mobile.yml`) :
1. compile l'**APK Android** et l'**app iOS pour simulateur** à chaque modification du front ;
2. sur demande (`[demo-mobile]` dans le message de commit, ou lancement manuel), démarre le
   serveur ORION, **installe l'app sur un émulateur Android et un simulateur iPhone**, l'ouvre
   depuis son icône et réalise **l'inscription complète** (nom, numéro, code, photo depuis la
   galerie, autorisations, accueil, profil), en filmant l'écran.

Les scénarios sont écrits avec Maestro dans `mobile/maestro/` ; les vidéos et les APK sont
téléchargeables dans l'onglet *Actions* du dépôt (rubrique *Artifacts*).

Publication sur les stores : voir [`store/README.md`](store/README.md).

## 1 bis. ORION Chauffeur : l'app native des chauffeurs

Les chauffeurs ont **leur propre application**, distincte de l'app cliente sur les stores
(fiche, icône et identifiant à part), construite à partir de la même app web (`driver.html`).

| | Android | iOS |
|---|---|---|
| Projet | `frontend/chauffeur/android` | `frontend/chauffeur/ios/App` |
| Identifiant | `ci.orion.chauffeur` | `ci.orion.chauffeur` |
| Nom affiché | ORION Chauffeur | ORION Chauffeur |
| Version | 1.0.0 (code 1) | 1.0.0 (build 1) |
| Orientation | portrait | portrait, iPhone uniquement |
| Autorisations | Internet, **position (pendant l'utilisation)**, caméra (facultative) | **position pendant l'utilisation**, caméra, photothèque (phrases en français) |
| Langues | les 8 de l'app (même choix que l'app cliente) | 8 langues déclarées (`CFBundleLocalizations`) |

Une seule configuration Capacitor (`frontend/capacitor.config.ts`) sert les deux apps :
avec `ORION_APP=chauffeur`, l'identifiant, le nom, l'app web (`dist-chauffeur`, où
`driver.html` devient `index.html`) et les dossiers natifs (`chauffeur/android`,
`chauffeur/ios`) basculent sur l'app chauffeur. Le script
`frontend/scripts/construire-app-chauffeur.mjs` fait tout d'un coup :

```bash
cd frontend
VITE_API_URL=https://orion-backend.onrender.com npm run cap:chauffeur:android   # ou :ios
cd chauffeur/android && ./gradlew assembleDebug    # APK de test
./gradlew bundleRelease                            # bundle signé pour le Play Store
# iOS : ORION_APP=chauffeur npx cap open ios, puis Product → Archive dans Xcode
```

Déjà câblé :
- **Position** : demandée à la mise en ligne (offres autour du chauffeur, **navigation guidée
  dans l'app** sur la vraie carte, tracé de la course, SOS localisé). Le guidage vocal utilise la
  synthèse vocale du téléphone (sans autorisation supplémentaire). Pas de localisation en arrière-plan : Google Play
  et l'App Store exigent une justification dédiée — à ajouter (§2) le jour où le suivi écran
  éteint sera branché.
- **Bouton retour Android** : ferme les notifications, revient à l'accueil, puis met l'app en
  arrière-plan ; il ne fait jamais quitter une course en cours (`driver/Driver.tsx`).
- **Appels et navigation** : clavier du téléphone pour appeler le passager ou le chef
  d'équipe (pas de permission `CALL_PHONE`), ouverture de Google Maps et Waze.
- **Icônes et écran de démarrage** dédiés (feuille ORION et volant), sources dans
  `frontend/chauffeur/assets/`.
- **CI** : l'APK *ORION Chauffeur* est compilé à chaque modification du front (artefact
  `orion-chauffeur-android-apk`) ; l'app iOS pour simulateur est compilée sur demande
  (`[demo-mobile]` ou lancement manuel, artefact `orion-chauffeur-ios-simulateur`).

Le serveur accepte déjà ces origines (`capacitor://localhost`, `https://localhost`) : elles
sont communes aux deux apps.

## 2. Permissions à ajouter avec les fonctionnalités à venir
Modèles prêts à fusionner, **ligne par ligne, seulement pour ce qui est utilisé** :
[`mobile/ios/Info.plist.snippet.xml`](mobile/ios/Info.plist.snippet.xml) et
[`mobile/android/AndroidManifest.permissions.xml`](mobile/android/AndroidManifest.permissions.xml).

| Besoin | iOS | Android | Plugin |
|--------|-----|---------|--------|
| **Localisation** (chauffeurs, suivi) | `NSLocationWhenInUse…` / `Always` | `ACCESS_FINE/COARSE/BACKGROUND_LOCATION` | `@capacitor/geolocation` |
| **Notifications** + **badges/poinçons** | APNs + `badge` | `POST_NOTIFICATIONS` (13+) + badges | `@capacitor/push-notifications` |
| **Microphone** | `NSMicrophoneUsageDescription` | `RECORD_AUDIO` | natif / WebRTC |
| **Caméra** | `NSCameraUsageDescription` | `CAMERA` | `@capacitor/camera` |
| **Stockage** (reçus) | `NSPhotoLibraryAdd…` | `READ_MEDIA_IMAGES` | `@capacitor/filesystem` |
| **Superposition** (bulle de suivi) | PiP / Live Activity | `SYSTEM_ALERT_WINDOW` | plugin overlay |
| **Arrière-plan** | `UIBackgroundModes` | `FOREGROUND_SERVICE(_LOCATION)` | background runner |
| **Alarme course programmée** | notifications + `UNCalendarTrigger` | `SCHEDULE_EXACT_ALARM` | `@capacitor/local-notifications` |

L'**écran d'autorisations in-app** (déjà présent : `PermissionsScreen`) explique chaque
accès avant la demande système — recommandé par Apple et Google (meilleur taux d'acceptation).

## 3. Suivi sur l'écran de verrouillage (itinéraire épuré)
- **iOS** : **Live Activities + Dynamic Island** (`ActivityKit`) — widget de course épuré
  (chauffeur, ETA, mini-itinéraire) sur l'écran de verrouillage, mis à jour via push
  (`NSSupportsLiveActivitiesFrequentUpdates`).
- **Android** : **notification persistante (foreground service)** de type *ongoing* avec
  *custom layout* (ETA + tracé), + **bulle/overlay** optionnelle (`SYSTEM_ALERT_WINDOW`).
- Les positions arrivent déjà du backend via WebSocket (`/ws/rides/:id`) ; il suffit de les
  relayer au widget/notification.

## 4. OTP via WhatsApp
- Le bouton « Recevoir le code via WhatsApp » est présent à l'inscription.
- Backend : intégrer l'**API WhatsApp Business** (modèle d'authentification) en plus du SMS ;
  même endpoint OTP, canal au choix de l'utilisateur. Repli SMS automatique.

## 5. Synchronisation en arrière-plan
- **iOS** : `BGAppRefreshTask` / `BGProcessingTask` (déclaré dans `UIBackgroundModes`).
- **Android** : **WorkManager** (périodique) + foreground service pendant une course active.
- Sert à : maj de la course, file d'attente hors-ligne, état du wallet.

## 6. Graphismes & performance (taux de rafraîchissement adaptatif)
- **iOS ProMotion** (jusqu'à 120 Hz) : la clé `CADisableMinimumFrameDurationOnPhone = true`
  est posée dans `Info.plist`. Sans elle, iOS bride les animations des apps à 60 images
  par seconde.
- **Android** : taux adaptatif (90/120/144 Hz) géré par le système ; on peut demander le mode
  haute fréquence via `WindowManager.LayoutParams.preferredDisplayModeId`.
- **Adaptation à la qualité du téléphone** : `@capacitor/device` fournit le modèle/RAM ; l'app
  expose un réglage **Qualité graphique : Auto / Élevée / Standard** (réduit flous/anim. sur
  appareils modestes, `prefers-reduced-motion` respecté).
- Carte **photoréaliste** : activer Google Maps (tuiles réelles) via clé API (cf. `DEPLOIEMENT.md`).

## 7. Thème clair / sombre / automatique
- Géré côté app (`ThemeProvider`) : `light` / `dark` / `system` (suit le téléphone en temps réel).
- Natif : `@capacitor/status-bar` aligne la barre d'état ; `colorScheme` synchronisé.

## 8. Bouton « Appeler » : le clavier du téléphone

Un toucher sur « Appeler » ouvre **le clavier téléphonique du portable**, avec le numéro
de l'autre personne déjà composé. Il ne reste qu'à appuyer sur la touche d'appel :
l'app n'appelle jamais à la place de l'utilisateur.

| Où | Numéro composé |
|---|---|
| App client, suivi de course | le chauffeur de la course |
| App chauffeur, course en cours | le passager |
| Console (SOS, Mon poste, télématique, équipes) | l'usager, le contact d'urgence, le locataire, le chef d'équipe |

- **Le numéro vient du serveur** (`GET /rides/:id/contact`). Il n'est remis qu'aux deux
  participants de la course, et seulement pendant la course : après, il faut passer par
  le support. Chaque remise de numéro est journalisée.
- **Format composable** : espaces retirés et indicatif +225 ajouté à un numéro local à
  10 chiffres (`frontend/src/telephone.ts`, même règle que le serveur). Un touriste avec
  un téléphone étranger peut donc composer le numéro.
- **Android** : `<queries>` déclare le clavier (`DIAL`) et les SMS (`SENDTO`). Il n'y a
  **pas** de permission `CALL_PHONE` : Google Play la réserve aux applications de
  téléphonie.
- **iOS** : `LSApplicationQueriesSchemes` (`tel`, `telprompt`, `sms`). iOS affiche sa
  fenêtre d'appel avec le numéro.
- **Ordinateur** (console) : le lien `tel:` ouvre l'application d'appel associée (Teams,
  Skype, téléphone relié). Un lien WhatsApp s'ouvre dans un nouvel onglet, sans quitter
  la console.
- **Preuve automatique sur émulateur** : `mobile/maestro/android/03-course-et-appeler.yaml`
  commande une course, touche « Appeler » et photographie l'application Téléphone
  d'Android.

L'ancien écran d'« appel internet » était simulé : aucun appel ne partait. Il est retiré.
Un vrai appel par internet, avec numéros masqués, demandera un fournisseur de téléphonie
(WebRTC avec un serveur TURN, ou numéros relais type Twilio Proxy). Ce n'est pas branché.

## 9. Détection de choc / SOS
- Accéléromètre (`DeviceMotion`) → endpoint `/safety/sensor` (déjà codé) → alerte SAMU (185).
- Notifications **critiques** iOS (entitlement Apple requis) pour percer le mode silencieux.

## Mises à jour à chaud (sans nouvelle APK)

Depuis la version 1.9.0 (versionCode 25), les apps ORION client, chauffeur et console se
mettent à jour depuis le serveur ORION, sans réinstaller d'APK :

1. La direction publie la nouvelle application web d'une app :
   `ORION_SERVEUR=https://… ORION_JETON_ADMIN=<session direction> frontend/scripts/publier-mise-a-jour.sh <client|chauffeur|console> <version>`
   (le paquet est construit sans la clé Google, signé par le serveur, annoncé en direct).
2. Chaque téléphone vérifie la signature (clé publique dans `frontend/src/miseAJourSignature.ts`,
   celle de `GET /apps/cle-publique`), puis l'empreinte SHA-256 du paquet, le télécharge et
   l'installe au bon moment : à l'ouverture de l'app ou après deux minutes sans geste, jamais
   pendant une course, une offre ou une saisie. Si la nouvelle version ne démarre pas, le
   téléphone revient seul à la précédente.

Une nouvelle APK reste nécessaire seulement pour un changement natif (permission, module
Android/iOS) : publier alors le paquet avec un `natifMin` égal au nouveau versionCode, les
téléphones plus anciens l'ignorent. La clé de signature est créée et gardée par le serveur
sur son disque persistant (`/var/data/paquets/cle-signature.pk8`) ; si ce disque était perdu,
le serveur en créerait une autre et il faudrait de nouvelles APK portant sa clé publique.
Projets iOS : lancer `npx cap sync ios` sur un Mac pour y ajouter le module de mise à jour.
