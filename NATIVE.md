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
- **iOS ProMotion** (jusqu'à 120 Hz) : actif automatiquement ; pour les animations
  `requestAnimationFrame` plein débit, ajouter la clé `CADisableMinimumFrameDurationOnPhone = true`.
- **Android** : taux adaptatif (90/120/144 Hz) géré par le système ; on peut demander le mode
  haute fréquence via `WindowManager.LayoutParams.preferredDisplayModeId`.
- **Adaptation à la qualité du téléphone** : `@capacitor/device` fournit le modèle/RAM ; l'app
  expose un réglage **Qualité graphique : Auto / Élevée / Standard** (réduit flous/anim. sur
  appareils modestes, `prefers-reduced-motion` respecté).
- Carte **photoréaliste** : activer Google Maps (tuiles réelles) via clé API (cf. `DEPLOIEMENT.md`).

## 7. Thème clair / sombre / automatique
- Géré côté app (`ThemeProvider`) : `light` / `dark` / `system` (suit le téléphone en temps réel).
- Natif : `@capacitor/status-bar` aligne la barre d'état ; `colorScheme` synchronisé.

## 8. Appel chauffeur ↔ client via internet (VoIP)

Le client peut **appeler le chauffeur sans unités** (data uniquement) via **WebRTC** :
- L'app établit un appel audio peer-to-peer chiffré (DTLS-SRTP).
- **Signaling** : via le WebSocket existant (`/ws/rides/:id`) — échange offre/réponse/ICE.
- **TURN/STUN** : serveur TURN requis pour traverser les NAT (ex. coturn) ; l'app récupère
  les credentials ICE via un endpoint backend `/calls/ice` (à brancher, court-lived).
- Numéros masqués : ni le client ni le chauffeur ne voient le vrai numéro de l'autre.
- Repli : appel cellulaire classique si l'utilisateur le préfère.
- L'écran d'appel in-app (minuteur, muet, haut-parleur) est déjà présent (`CallOverlay`).

## 9. Détection de choc / SOS
- Accéléromètre (`DeviceMotion`) → endpoint `/safety/sensor` (déjà codé) → alerte SAMU (185).
- Notifications **critiques** iOS (entitlement Apple requis) pour percer le mode silencieux.
