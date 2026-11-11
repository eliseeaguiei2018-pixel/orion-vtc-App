# Kit de publication ORION — App Store et Google Play

Tout ce qu'il faut pour remplir les fiches **App Store Connect** (Apple) et **Play Console**
(Google). Les visuels sont faits à partir de **captures réelles** de l'application, prises sur
le serveur ORION en fonctionnement (aucune maquette).

> Statut : l'application n'est **pas encore publiée**. Tant que les fiches ne sont pas
> validées par Apple et Google, elle n'apparaît dans aucune recherche des stores.

## 1. Contenu du dossier

| Fichier | Usage | Format exigé |
|---|---|---|
| `icone-app-store-1024.png` | Icône App Store | 1024×1024, PNG sans transparence |
| `icone-google-play-512.png` | Icône Play Store | 512×512, PNG 32 bits |
| `google-play-banniere-1024x500.png` | Bannière Play Store (obligatoire) | 1024×500 |
| `captures/app-store-iphone-6.9/*.png` | Captures iPhone (6 écrans) | 1320×2868 (iPhone 6,9") |
| `captures/google-play-telephone/*.png` | Captures téléphone Android (6 écrans) | 1080×1920 (9:16) |

Ordre conseillé des captures : accueil, prix, suivi, SOS, paramètres, historique.
L'app n'est déclarée que pour iPhone (pas d'iPad) : aucune capture iPad n'est demandée.

Les applications natives sont dans `frontend/ios` et `frontend/android` (voir `NATIVE.md`).
Identifiant des deux apps : **`ci.orion.app`**. Version **1.0.0**, build **1**.

## 2. Textes de la fiche (français)

**Nom** (30 car. max, les deux stores) : `ORION – VTC Abidjan`

**Sous-titre Apple** (30 max) : `Courses électriques, prix fixe`

**Description courte Google** (80 max) :
`VTC 100 % électrique à Abidjan : prix fixe, suivi en direct et SOS intégré.`

**Texte promotionnel Apple** (170 max, modifiable sans nouvelle version) :
`Nouveau : créez votre compte avec photo, retrouvez vos courses et annulations, et suivez en direct la réponse d’ORION à une alerte SOS.`

**Mots-clés Apple** (100 max, séparés par des virgules) :
`vtc,taxi,abidjan,course,chauffeur,électrique,livraison,coursier,moto,sos,mobile money,côte d’ivoire`
N'ajoutez jamais le nom d'un concurrent : Apple refuse la fiche.

**Description complète** (les deux stores, 4000 max) :

```
ORION, c'est la course VTC nouvelle génération à Abidjan : des véhicules 100 % électriques, un prix fixé avant de monter, et une équipe de supervision qui veille sur chaque trajet.

COMMANDER EN QUELQUES SECONDES
• Saisissez votre destination : le prix s'affiche en FCFA avant de confirmer, et c'est ce prix que vous payez.
• Course en voiture ou livraison par coursier moto.
• Paiement en espèces ou par mobile money.

SUIVRE SON CHAUFFEUR EN DIRECT
• Nom, photo, véhicule, plaque et matricule ORION du chauffeur.
• Position en temps réel jusqu'à la prise en charge, puis pendant tout le trajet.
• Partage du suivi avec un proche en un geste.

LA SÉCURITÉ AU CŒUR DU SERVICE
• Bouton SOS : l'alerte part immédiatement vers la supervision ORION, avec votre position.
• Échange discret avec un agent si vous ne pouvez pas parler.
• Si nécessaire, ORION sollicite le SAMU, la police ou les pompiers, et vous suivez l'intervention depuis l'application.

VOTRE COMPTE, EN TOUTE TRANSPARENCE
• Compte rattaché à votre numéro, vérifié par code SMS.
• Photo de profil, prise sur le moment ou choisie dans la galerie : votre chauffeur vous reconnaît à la prise en charge.
• Historique de toutes vos courses et annulations, avec le motif et les éventuels frais.
• Annulation gratuite tant qu'aucun chauffeur n'est en route, puis pendant 2 minutes après l'acceptation.
• Suppression du compte à tout moment, depuis les paramètres.

ORION est disponible à Abidjan, Côte d'Ivoire. Application en français, anglais, espagnol, italien, allemand, arabe, chinois et russe.
```

**Catégorie** : Apple « Voyages » (secondaire « Navigation ») ; Google « Cartes et navigation ».

## 3. Adresses web à renseigner

Elles sont servies par le site web de l'app (déploiement Vercel ou GitHub Pages, voir
`DEPLOIEMENT.md`). Remplacez `https://VOTRE-DOMAINE` par l'adresse réelle.

| Champ | Adresse |
|---|---|
| Politique de confidentialité (les deux stores, obligatoire) | `https://VOTRE-DOMAINE/confidentialite.html` |
| Suppression de compte (Google, obligatoire) | `https://VOTRE-DOMAINE/suppression-compte.html` |
| Assistance / site marketing (Apple) | `https://VOTRE-DOMAINE/` |

La page de suppression appelle le serveur ORION : elle doit être déployée avec
`VITE_API_URL` pointant sur le backend (Vercel). La version GitHub Pages en mode
démonstration n'a pas de serveur et ne peut pas supprimer de compte.

## 4. Compte de démonstration pour les équipes de revue

Apple et Google testent l'app avec un compte fourni. La connexion ORION se fait par code SMS :
on réserve donc **un numéro de revue** qui reçoit toujours le même code, et lui seul.

Sur le serveur de production (Render) :

```
CLIENT_REVIEW_PHONE=+225 01 00 00 00 01   # numéro réservé à la revue
CLIENT_REVIEW_CODE=424242                 # 6 chiffres, à changer
```

À indiquer dans **App Store Connect → Informations pour la revue** et **Play Console →
Accès à l'application** :

```
Connexion par numéro de téléphone :
1. Ouvrir l'app, toucher « Commencer ».
2. Nom : Revue ORION. Téléphone : 01 00 00 00 01.
3. Code reçu : 424242 (code fixe réservé à ce numéro de test).
4. La photo de profil est facultative (« Plus tard »).
Attention : les boutons 185, 170 et 180 de l'écran SOS composent les vrais numéros
d'urgence de Côte d'Ivoire. Merci de ne pas les utiliser pendant la revue.
```

Le code fixe ne vaut que pour ce numéro : un test automatique le vérifie
(`backend/tests/compte-revue-stores.test.ts`). En production, aucun autre code n'est jamais
renvoyé par le serveur.

## 5. Confidentialité : réponses aux questionnaires

**Apple — « Confidentialité de l'app »** (toutes les données sont liées à l'utilisateur,
utilisées pour le fonctionnement de l'app, **aucun suivi publicitaire**) :

| Catégorie Apple | Donnée ORION |
|---|---|
| Coordonnées : nom, numéro de téléphone, adresse e-mail | compte client (e-mail facultatif) |
| Contenu utilisateur : photos | photo de profil (facultative) |
| Contenu utilisateur : service client | messages échangés avec l'agent pendant un SOS |
| Localisation précise | points de départ et d'arrivée des courses, position partagée pendant un SOS |
| Achats : historique d'achats | courses et frais d'annulation |
| Identifiants : identifiant utilisateur | identifiant du compte ORION |

**Google — « Sécurité des données »** :
- Données collectées : nom, adresse e-mail, ID utilisateur, numéro de téléphone, photos,
  position (adresses de course), historique d'achats, autres messages (échanges SOS).
- **Partage avec des tiers : non.** La transmission au chauffeur (nom, photo, point de prise
  en charge) et aux secours lors d'un SOS découle d'une action de l'utilisateur, ce que
  Google exclut de la notion de partage.
- Chiffrement en transit : **oui** (HTTPS).
- Suppression sur demande : **oui**, dans l'app et via la page web ci-dessus.

**Chiffrement (Apple)** : l'app n'utilise que le chiffrement standard HTTPS ; c'est déjà
déclaré dans `Info.plist` (`ITSAppUsesNonExemptEncryption = NO`), aucune question à l'envoi.

**Classification** : aucun contenu sensible (violence, jeux d'argent, achats intégrés).
Au questionnaire Google (IARC), répondre **oui** à « l'app partage la position de
l'utilisateur » (le point de prise en charge est transmis au chauffeur). Public cible
Google : **18 ans et plus**.

## 6. Ce qu'il reste à faire de votre côté, dans l'ordre

1. **Activer l'opérateur SMS** : le serveur est branché sur l'API SMS d'Orange Côte
   d'Ivoire (et Twilio en secours). Il reste à ouvrir le compte Orange Developer et à saisir
   ses identifiants sur Render (`DEPLOIEMENT.md`, « Opérateur SMS »). C'est **bloquant** :
   sans cela, les vrais clients ne reçoivent pas leur code.
2. **Comptes développeur** : Apple Developer Program (99 USD par an) et Google Play Console
   (25 USD, une fois). Un compte « organisation » demande un numéro D-U-N-S, gratuit.
3. **Signature** : certificat de distribution Apple, et clé d'importation Android à garder
   précieusement (sa perte empêche toute mise à jour).
4. **Serveur de production** : `CORS_ORIGIN` doit contenir les origines des apps natives
   `capacitor://localhost,https://localhost` en plus du domaine web (voir `DEPLOIEMENT.md`).
5. **Compiler les versions de publication** (voir `NATIVE.md`, section « Publier »).
6. **Tests fermés** : Apple via TestFlight. Google impose aux nouveaux comptes personnels un
   test fermé avec **au moins 12 testeurs pendant 14 jours** avant la production.
7. **Envoyer en revue** avec les textes, visuels et le compte de démonstration ci-dessus.
   Délai habituel : 1 à 3 jours chez Apple, quelques heures à 7 jours chez Google.

## 7. Exigences techniques déjà respectées

| Exigence | ORION |
|---|---|
| Google : cible Android 16 (API 36) pour les nouvelles apps | `targetSdkVersion 36`, minimum Android 7 (API 24) |
| Apple : compilation avec Xcode 26 / SDK iOS 26 | projet Capacitor 8, iOS 15 minimum |
| Apple : suppression du compte dans l'app | Paramètres → Mon compte → Supprimer mon compte |
| Google : suppression du compte sans l'app | `suppression-compte.html` |
| Phrases d'autorisation (caméra, photothèque) | `Info.plist`, en français |
| Bouton retour Android | géré écran par écran (retour à l'écran parent) |
| Pas de connexion tierce (Google, Facebook) | « Se connecter avec Apple » non exigé |
| Pas de trafic en clair en production | HTTP local autorisé uniquement en version de test |
