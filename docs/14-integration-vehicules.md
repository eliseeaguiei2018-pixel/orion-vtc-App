# 14. App Chauffeur sur l'écran du véhicule, HarmonyOS, intégration constructeurs

L'app Chauffeur ORION ne vit pas que sur le téléphone. Elle s'ouvre aussi sur l'écran
large de la voiture, et les constructeurs de la flotte ORION peuvent l'héberger dans
leur propre système embarqué.

## Mode écran de véhicule

La **même** application (aucune réécriture) passe en mode paysage plein écran, pensé pour
les dalles embarquées (1920×720 ultra-larges, 2560×1600) et les tablettes de bord :
grandes cibles tactiles, gros texte, navigation guidée en grand, et le cadre « téléphone »
retiré.

- Page dédiée : **`vehicule.html`** (ou n'importe quelle page de l'app avec `?ecran=vehicule`).
- Le chauffeur ne saisit jamais ses identifiants sur l'écran de la voiture, que d'autres
  pourraient voir. Il **appaire** l'écran avec un code.

### Appairage téléphone ↔ écran de véhicule

1. Sur son téléphone (app Chauffeur → Profil → **« Connecter un écran de véhicule »**), le
   chauffeur obtient un **code à six chiffres**.
2. Il saisit ce code sur l'écran de la voiture (`vehicule.html`).
3. L'écran reçoit une session chauffeur.

Le code est **à usage unique**, valable **trois minutes**, lié au chauffeur qui l'a
demandé, et les essais sont **limités** (anti-force brute, par adresse et globalement).
Chaque appairage est journalisé. C'est le même principe que « caster » un écran : le
consentement vient du téléphone déjà authentifié. Vérifié de bout en bout
(`backend/tests/appairage-vehicule.test.ts`).

## Trois façons d'intégrer, de la plus simple à la plus poussée

1. **WebView / navigateur embarqué (recommandé).** Le système du véhicule ouvre
   `https://chauffeur.orion.ci/vehicule.html` dans sa vue web. Rien à maintenir côté
   constructeur : une correction publiée sur ORION arrive au prochain démarrage. Marche
   sur Android Automotive (WebView), HarmonyOS (ArkWeb), et tout tableau de bord doté d'un
   navigateur.
2. **Application hôte native.** Le constructeur empaquette une application qui héberge
   cette page. Le dépôt fournit un **scaffold HarmonyOS** prêt à ouvrir dans DevEco Studio
   (voir `harmony/`).
3. **Intégration native directe (API).** Pour parler au serveur ORION sans vue web, la
   spec **OpenAPI** `docs/api/orion-chauffeur.openapi.yaml` décrit les points utiles :
   appairage, session, course en cours, position GPS, configuration.

### Transmettre l'API aux constructeurs

Les développeurs d'un constructeur reçoivent `docs/api/orion-chauffeur.openapi.yaml`
(importable dans Swagger/Postman) et l'adresse du serveur ORION. Ils n'ont **pas** besoin
d'un secret pour l'appairage : la session naît du code affiché sur le téléphone du
chauffeur. Une clé partenaire séparée (hors de ce document) reste possible pour des
intégrations serveur à serveur.

## HarmonyOS (Huawei)

Beaucoup de véhicules Huawei tournent sous HarmonyOS. Le dossier **`harmony/`** contient un
projet **ArkTS** minimal qui héberge l'app Chauffeur dans le moteur **ArkWeb** (composant
`Web`) : position accordée à l'ouverture, thème sombre automatique, stockage de session.
Pointer l'adresse vers `driver.html` (téléphone/tablette) ou `vehicule.html` (écran
embarqué).

L'app est aussi prévue pour être **publiée sur AppGallery** (la boutique HarmonyOS), à
côté de l'App Store et de Google Play.

**Limite franche :** ce scaffold ne se compile pas dans cet environnement. Il faut
**DevEco Studio**, le SDK HarmonyOS et un **compte développeur Huawei** pour le signer et
le publier sur AppGallery. Le code ArkTS est fourni complet et commenté ; il s'ouvre et se
lance tel quel dans DevEco.

## Fluidité : 120 Hz et plus

- **Android** (app cliente et app Chauffeur) : l'application **demande** le mode d'écran le
  plus rapide à la définition courante (`preferredDisplayModeId` / `preferredRefreshRate`),
  pour profiter des dalles 90/120/144 Hz et LTPO. Le système reste maître et redescend pour
  la batterie (`frontend/.../MainActivity.java`).
- **iOS** : la clé `CADisableMinimumFrameDurationOnPhone` est posée (ProMotion jusqu'à
  120 Hz). Voir `NATIVE.md`.
- **HarmonyOS / écran embarqué** : le taux dépend de la dalle du véhicule ; ArkWeb suit le
  compositeur du système.

**Limite franche :** un vrai 144 Hz ne se prouve pas sur un serveur sans écran. Le code
demande le meilleur taux ; la fréquence réellement obtenue dépend de l'appareil et de ses
arbitrages d'énergie.
