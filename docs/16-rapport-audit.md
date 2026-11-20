# Rapport d'audit ORION — novembre 2026

**Périmètre** : application client (iOS, Android, web), application chauffeur (téléphone,
tablette, écran de véhicule, HarmonyOS), console d'administration et tableau de bord
(Windows, macOS, navigateur, tablette), serveur (API, temps réel, configuration de
production).

**Méthode** : relecture du code et de la configuration, tests automatisés, tests réels
dans un navigateur piloté (vraies interfaces, vrai serveur, vraie carte), contrôle
automatique de mise en page et d'accessibilité sur 10 formats d'écran, test de bout en bout
client ↔ chauffeur ↔ console ↔ tableau de bord, contrôle croisé du contenu entre les
interfaces.

**Référentiels** : WCAG 2.2 niveau AA (accessibilité), OWASP ASVS 4 et MASVS 2 (sécurité
serveur et mobile), règles de revue App Store (5.1.1 données et autorisations) et Google
Play (autorisations sensibles), recommandations Apple / Google sur les cibles tactiles
(44 pt / 48 dp), typographie française (Imprimerie nationale).

**Échelle de gravité** : *Critique* (sécurité des personnes, fuite de données, refus
assuré en boutique) · *Majeure* (fonction promise qui ne marche pas, donnée fausse
affichée) · *Moyenne* · *Mineure*.

---

## 1. Synthèse

| | Constats | Corrigés | Restant |
|---|---:|---:|---:|
| Critiques | 8 | 8 | 0 |
| Majeurs | 14 | 14 | 0 |
| Moyens | 9 | 9 | 0 |
| Mineurs | 4 | 3 | 1 (conservé, justifié : A10) |

Le constat le plus grave : **toutes les courses partaient du Plateau**, affiché
« Position actuelle », quelle que soit la position réelle du client. Un chauffeur aurait
été envoyé à la mauvaise adresse, jusqu'à plusieurs kilomètres. Corrigé et vérifié de bout
en bout : la course enregistrée par la console part désormais à **0 m** de la position du
téléphone.

Réserves à lever hors code (section 6) : traduction assermentée des textes médicaux et
juridiques, essais sur appareils physiques Huawei (HarmonyOS), clés de production.

---

## 2. Sécurité (serveur et applications)

| # | Gravité | Constat | Correction | Preuve |
|---|---|---|---|---|
| S1 | Critique | Les boîtiers télématiques des véhicules de location envoyaient leur position sans authentification : une fausse position pouvait masquer un vol ou déclencher la coupure moteur. | Jeton partagé obligatoire (comparaison à temps constant) ; refus de démarrer en production sans jeton. | test S1 |
| S2 | Critique | ~20 routes client (profil, abonnement, courses, locations, mariage, support, suivi SOS) répondaient sans vérifier la session : les données d'un client inscrit étaient lisibles et modifiables par un tiers. | Contrôle du titulaire sur chaque route ; un passager invité reste servi ; un SOS se déclenche toujours, même sans session. | tests S2 (×4) |
| S3 | Critique | Le serveur démarrait en production avec les secrets publics du dépôt ; la configuration d'hébergement n'en générait pas. | Refus de démarrer si un secret est absent, par défaut ou trop court ; secrets générés à l'hébergement. | test S3 |
| S4 | Moyenne | Positions des chauffeurs acceptées sans jeton en production. | Contrôle strict activé par défaut en production. | configuration |
| S5 | Mineure | Identifiant d'invité tiré par `Math.random`. | Générateur cryptographique. | api.ts |
| S6 | Moyenne | Android : sauvegarde automatique dans le nuage et transfert d'appareil actifs ; la session (jeton) aurait été restaurée sur un autre téléphone sans code SMS (MASVS-STORAGE). | Sauvegarde et transfert désactivés (client et chauffeur). | APK compilés en CI |
| S7 | Majeure | HarmonyOS : la position était accordée à **n'importe quel site** chargé dans l'app ; aucune restriction de navigation ; accès fichiers et contenu mixte non verrouillés. | Position réservée à l'origine ORION, liens externes ouverts hors de l'app, fichiers et contenu HTTP bloqués. | Index.ets |
| S8 | — | Electron (Windows, macOS) : isolation, bac à sable, permissions et navigation contrôlées. | Conforme, aucun écart. | 4/4 tests de règles |

## 3. Fonctionnel

| # | Gravité | Constat | Correction | Preuve |
|---|---|---|---|---|
| F1 | Critique | Point de prise en charge codé en dur (Plateau) affiché « Position actuelle ». | Vraie position GPS ; point choisi par le client ; sans position connue, départ « à confirmer » et commande bloquée tant qu'il ne l'est pas. | test réel GPS accordé / refusé (19/19) ; bout en bout : 0 m |
| F2 | Critique | Recherche d'adresse = filtre d'une liste fixe de 15 lieux. | Recherche serveur (répertoire + OpenStreetMap) ; **458 quartiers du Grand Abidjan** extraits d'OpenStreetMap, disponibles hors ligne ; choix du point exact sur la carte. | tests serveur (5/5) |
| F3 | Critique | Écran « Autorisations » décoratif : 5 interrupteurs sans effet, dont micro, notifications et stockage, jamais utilisés (refus assuré App Store 5.1.1) ; localisation absente de l'Info.plist et du manifeste Android. | Vraie demande de position ; appareil photo expliqué ; textes système iOS et permissions Android ajoutés. | capture 01-autorisations |
| F4 | Majeure | « Ajouter un arrêt » ajoutait un lieu imposé (PISAM, Sococé, gare). | L'arrêt est cherché et choisi par le client, et retirable. | test réel (arrêt Angré) |
| F5 | Majeure | HarmonyOS : le bouton « Appeler » ne pouvait pas fonctionner (aucun traitement des liens `tel:`), malgré le commentaire qui l'affirmait ; pas de bouton retour. | Clavier téléphonique du système ; retour arrière dans l'app. | Index.ets |
| F6 | Majeure | HarmonyOS sur écran de voiture : chargeait l'app « téléphone » (cadre étroit au centre de l'écran). | Sur un appareil de type voiture, le mode écran de véhicule s'ouvre directement ; sur un écran embarqué Android/web, l'app le propose. | capture voiture-1024×600 |
| F7 | — | Bout en bout : client (GPS Riviéra 2) → offre reçue par la chauffeure (quartier réel affiché) → acceptation → client voit sa chauffeure → console : départ à 0 m → tableau de bord : +1 commande, 1 course en direct → arrivée et code de prise en charge. | Conforme. | 12/12, 0 erreur JS |
| F8 | — | Règle d'attribution stricte par gamme (une course Bronze n'est pas proposée à un véhicule Or). | Conforme à la règle commerciale ; à confirmer par la direction si un surclassement doit être permis. | bout en bout |

## 4. Contenu

| # | Gravité | Constat | Correction |
|---|---|---|---|
| C1 | Critique | App chauffeur en **italien** : le SAMU traduit « 118 » (numéro italien) au lieu du 185 de Côte d'Ivoire. | Traduction corrigée ; contrôle des numéros d'urgence de toutes les langues : 185 / 170 / 111 / 180 partout. |
| C2 | Majeure | « Récents : Domicile Cocody / Bureau Plateau » montrés à tout nouveau client (fausses données personnelles ; risque de commander vers le domicile d'un inconnu). | Domicile et bureau enregistrés par le client ; vrais trajets récents. |
| C3 | Majeure | 122 textes affichés en français dans les 6 autres langues, dont la consigne « ne montez qu'après vérification du code ». | Textes opérationnels traduits ; contrôle de couverture ajouté à la CI (650 textes × 8 langues). |
| C4 | Majeure | Textes médicaux (ORION Assurance) et juridiques en français sans avertissement pour un client arabophone, sinophone… | Avis dans la langue du client : « version française qui fait foi, traduction en validation ». Traduction assermentée : réserve R1. |
| C5 | Moyenne | Typographie : « : » rejeté seul en début de ligne sur petit écran. | Espaces insécables avant « : ; ? ! » dans les apps client et chauffeur. |
| C6 | Mineure | Coquille « Huawey » dans l'hôte HarmonyOS. | Corrigée. |
| C7 | Majeure | Console : carte tactique SAMU schématique au lieu de la ville réelle ; vitesse absurde (726 km/h) sur saut GPS ; « zone inconnue » dans le suivi des véhicules. | Vraie carte d'Abidjan (SAMU, vue d'ensemble, dossier SOS, suivi véhicules) ; vitesse plafonnée ; quartier le plus proche. |
| C8 | Majeure | Livrables : planches console et tableau de bord prises en mode démonstration ; vidéo 7 contradictoire. | Refaites en mode réel. |

## 5. Mise en page et accessibilité (WCAG 2.2 AA)

Contrôle automatique sur **iPhone SE, iPhone 15 Pro Max, Android compact (360 px),
Pixel 7, iPad, PC 1366×768 et 1920×1080, écrans de voiture 1280×720, 1920×720 et
1024×600** : débordement horizontal, éléments hors écran, cibles tactiles, textes rognés,
textes trop petits, règles WCAG (axe-core), erreurs JavaScript.

**Débordement horizontal : 0 sur tous les écrans de toutes les interfaces. Erreurs
JavaScript : 0.**

| # | Gravité | Constat | Correction |
|---|---|---|---|
| A1 | Critique | Zoom bloqué (`user-scalable=no`) dans les apps client et chauffeur (WCAG 1.4.4). | Zoom rétabli ; champs en 16 px pour éviter le zoom automatique d'iOS à la saisie. |
| A2 | Majeure | 11 interrupteurs sans nom accessible (assurance, biométrie, partage, options de location, décoration ; 6 dans la console). | `role="switch"`, état et libellé sur chacun. |
| A3 | Majeure | Console (tablette, téléphone) : menu replié poussé hors écran mais toujours atteignable au clavier et lu par les lecteurs d'écran (80 éléments invisibles). | Masqué réellement une fois fermé. |
| A4 | Majeure | Console en mode clair : vert et orange des textes sous le contraste 4,5:1 (WCAG 1.4.3). | Teintes foncées pour le texte en mode clair. |
| A5 | Moyenne | Champs de saisie touchables sur 20 px de haut seulement (WCAG 2.5.8 : 24 px). | Toute la hauteur du champ (44 px) est touchable. |
| A6 | Moyenne | Liens « Pourquoi activer ? » et « Politique de confidentialité » de 14–16 px de haut ; case à cocher de 20 px. | Cibles portées à 24 px minimum. |
| A7 | Moyenne | Texte d'alerte « départ à confirmer » en jaune sur blanc (2,1:1). | Teinte foncée dédiée (6:1). |
| A8 | Moyenne | Écrans tactiles : boutons compacts de 30–34 px (console, tableau de bord). | 44 px sur écran tactile. |
| A9 | Mineure | Étiquettes de 8 à 10,5 px (« BIENTÔT », tuiles de raccourcis). | 9,5 à 11,5 px. |
| A10 | Mineure | Graphiques du tableau de bord : graduations en 10,5 px. | **Conservé** (lisible sur écran de bureau, doublé par les valeurs au survol). |
| A11 | Majeure | Console, Supervision SAMU : 9 champs sans étiquette (numéros des contacts, message à l'usager, rapport d'incident, numéro libre) — un lecteur d'écran annonçait « zone de saisie » sans plus. | Étiquette accessible sur chaque champ. |
| A12 | Majeure | Console, Location : montants en vert clair (2,6:1) et 2 listes de filtres sans nom. | Variables de couleur dédiées au texte en mode clair (toute la console) ; listes nommées. |
| A13 | Moyenne | Console sur téléphone : tableaux défilant horizontalement non atteignables au clavier (WCAG 2.1.1). | Zone de défilement nommée et focalisable dès qu'elle déborde. |
| A14 | Moyenne | Bandeau « mode véhicule » (nouveau) : texte blanc sur vert (contraste insuffisant). | Texte foncé. |

## 6. Réserves (hors code)

| # | Réserve | Responsable |
|---|---|---|
| R1 | Faire traduire et valider par un traducteur assermenté les textes médicaux (ORION Assurance) et juridiques dans les 6 langues non validées. | Direction juridique |
| R2 | Essais sur appareils physiques Huawei (téléphone HarmonyOS et écran de véhicule) : l'hôte ArkTS ne peut pas être compilé sans DevEco Studio. | Équipe mobile |
| R3 | Clés de production (secrets serveur, jeton des boîtiers, opérateur SMS) à saisir dans l'hébergeur. | Exploitation |
| R4 | Règle d'attribution par gamme (F8) : décider si un véhicule de gamme supérieure peut prendre une course de gamme inférieure. | Direction des opérations |

## 7. Tests en place

- Serveur : 353 tests (351 réussis, 2 ignorés hors base de données réelle), dont les tests
  d'audit S1–S3 et la recherche de lieux.
- Traductions : contrôle CI des apps client et chauffeur (8 langues).
- **Nouveau** : test de fumée multi-navigateurs en CI — Safari/WebKit (Linux et macOS),
  Firefox, **Microsoft Edge sous Windows** — sur les 5 interfaces.
- Émulateur Android et simulateur iPhone (Maestro) : scénarios mis à jour pour la vraie
  demande de position et la recherche d'adresse.
- Applications de bureau : règles de sécurité Electron (4 tests) ; installateurs Windows et
  macOS construits par la CI.
