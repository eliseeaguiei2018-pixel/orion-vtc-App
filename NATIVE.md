# 📱 ORION — Couche native (iOS & Android)

Ce guide décrit comment l'app web ORION devient une **vraie app mobile** (Play Store / App
Store) via **Capacitor**, et comment chaque fonctionnalité native demandée est câblée, en
tenant compte des **nouveautés Apple & Android récentes**.

> L'app web (dossier `frontend/`) reste la source unique : Capacitor l'emballe sans réécriture.

## 1. Mise en place
```bash
cd frontend
npm i @capacitor/core @capacitor/cli
npm i @capacitor/geolocation @capacitor/push-notifications @capacitor/local-notifications \
      @capacitor/camera @capacitor/filesystem @capacitor/preferences @capacitor/haptics \
      @capacitor/device @capacitor/network @capacitor/status-bar
npx cap init   # appId: ci.orion.app, appName: ORION (déjà dans capacitor.config.ts)
npm run build && npx cap add ios && npx cap add android
```
Fusionner ensuite :
- iOS : [`../mobile/ios/Info.plist.snippet.xml`](mobile/ios/Info.plist.snippet.xml) → `Info.plist`
- Android : [`../mobile/android/AndroidManifest.permissions.xml`](mobile/android/AndroidManifest.permissions.xml) → `AndroidManifest.xml`

## 2. Permissions (demandées à l'exécution)
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
