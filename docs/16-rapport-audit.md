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
| Majeurs | 18 | 18 | 0 |
| Moyens | 12 | 12 | 0 |
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
| F2 | Critique | Recherche d'adresse = filtre d'une liste fixe de 15 lieux. | Recherche serveur (répertoire + OpenStreetMap) ; **449 lieux du Grand Abidjan** vérifiés et dédoublonnés (section 8), disponibles hors ligne ; choix du point exact sur la carte. | tests serveur (9/9) |
| F3 | Critique | Écran « Autorisations » décoratif : 5 interrupteurs sans effet, dont micro, notifications et stockage, jamais utilisés (refus assuré App Store 5.1.1) ; localisation absente de l'Info.plist et du manifeste Android. | Vraie demande de position ; appareil photo expliqué ; textes système iOS et permissions Android ajoutés. | capture 01-autorisations |
| F4 | Majeure | « Ajouter un arrêt » ajoutait un lieu imposé (PISAM, Sococé, gare). | L'arrêt est cherché et choisi par le client, et retirable. | test réel (arrêt Angré) |
| F5 | Majeure | HarmonyOS : le bouton « Appeler » ne pouvait pas fonctionner (aucun traitement des liens `tel:`), malgré le commentaire qui l'affirmait ; pas de bouton retour. | Clavier téléphonique du système ; retour arrière dans l'app. | Index.ets |
| F6 | Majeure | HarmonyOS sur écran de voiture : chargeait l'app « téléphone » (cadre étroit au centre de l'écran). | Sur un appareil de type voiture, le mode écran de véhicule s'ouvre directement ; sur un écran embarqué Android/web, l'app le propose. | capture voiture-1024×600 |
| F7 | — | Bout en bout : client (GPS Riviéra 2) → offre reçue par la chauffeure (« Riviéra 2, Cocody → Zone 4, Marcory ») → acceptation → client voit sa chauffeure → console : départ à 0 m, colonne Trajet → tableau de bord : +1 commande à Cocody → arrivée, code de prise en charge, paiement. | Conforme. | 17/17, 0 erreur JS |
| F8 | — | Règle d'attribution stricte par gamme (une course Bronze n'est pas proposée à un véhicule Or). | Conforme à la règle commerciale ; à confirmer par la direction si un surclassement doit être permis. | bout en bout |
| F9 | Majeure | Paiement : quand le chauffeur déclarait les espèces encaissées (ou que l'opérateur confirmait le mobile money), le client restait bloqué sur « Payer ». | Passage à « payée » publié en temps réel sur le canal de la course ; l'écran du client passe seul à la notation. Libellé et consigne propres aux espèces (8 langues). | captures client 22–23 |
| F10 | Moyenne | Carte de l'écran de paiement centrée sur le Plateau (reste du départ codé en dur). | Centrée sur le lieu d'arrivée. | capture client 21 |
| F11 | Moyenne | iPhone (simulateur, CI) : toucher la carte au-dessus du formulaire d'inscription ne retirait pas le focus du champ ; le clavier restait ouvert et masquait le champ du numéro. | Toucher la carte ferme le clavier (inscription et code SMS) ; la touche « Suivant » du clavier passe au champ suivant. | essai navigateur tactile ; scénario iPhone |

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
| C9 | Majeure | Données GPS : doublons OpenStreetMap (« Angré » proposé deux fois, « Kouté / Kouté village », « Cité Star 5 / Cité Stars 5 »…) et commune fausse (Angré classé à Abobo : la commune était devinée au centre le plus proche). | 709 entrées brutes recoupées → 449 lieux uniques avec leur niveau ; commune tirée des limites communales OSM (section 8). |
| C10 | Majeure | Trajet invisible : aucune colonne départ / arrivée dans le tableau des courses de la console ; l'offre et la course du chauffeur ne donnaient que la commune, ou des coordonnées. | « Riviéra 2, Cocody → Zone 4, Marcory » dans l'offre et la course du chauffeur, la colonne Trajet de la console et l'historique du client. |
| C11 | Moyenne | Console, dossier SOS : la position n'était donnée qu'en coordonnées. | Lieu en clair d'abord (« Riviéra 2, Cocody »), à dicter aux secours, puis les coordonnées. |

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
| A15 | Majeure | Notation de fin de course : étoiles en simples zones cliquables, inaccessibles au clavier et muettes pour un lecteur d'écran (WCAG 2.1.1, 4.1.2). | Vrais boutons nommés (« Notez 4/5 »), état annoncé. |

## 6. Réserves (hors code)

| # | Réserve | Responsable |
|---|---|---|
| R1 | Faire traduire et valider par un traducteur assermenté les textes médicaux (ORION Assurance) et juridiques dans les 6 langues non validées. | Direction juridique |
| R2 | Essais sur appareils physiques Huawei (téléphone HarmonyOS et écran de véhicule) : l'hôte ArkTS ne peut pas être compilé sans DevEco Studio. | Équipe mobile |
| R3 | Clés de production (secrets serveur, jeton des boîtiers, opérateur SMS) à saisir dans l'hébergeur. | Exploitation |
| R4 | Règle d'attribution par gamme (F8) : décider si un véhicule de gamme supérieure peut prendre une course de gamme inférieure. | Direction des opérations |

## 7. Tests en place

- Serveur : tests d'audit S1–S3, recherche de lieux (aucun doublon, 12 communes de
  référence, libellés quartier + commune) ; suite complète verte en CI.
- Traductions : contrôle CI des apps client et chauffeur (8 langues).
- **Nouveau** : test de fumée multi-navigateurs en CI — Safari/WebKit (Linux et macOS),
  Firefox, **Microsoft Edge sous Windows** — sur les 5 interfaces.
- Émulateur Android et simulateur iPhone (Maestro) : scénarios mis à jour pour la vraie
  demande de position et la recherche d'adresse. Android : inscription complète avec photo
  réussie ; la fenêtre système de localisation est désormais reconnue par l'identifiant de
  son bouton. iPhone : app compilée et installée ; le blocage de l'inscription (F11) est
  corrigé.
- Applications de bureau : règles de sécurité Electron (4 tests) ; installateurs Windows et
  macOS construits par la CI.

## 8. Données GPS : quartiers d'Abidjan (OpenStreetMap)

Vérification demandée : OpenStreetMap mélange-t-il les niveaux (Riviéra, Riviéra 2,
Riviéra Palmeraie, villages comme Anono ou M'Pouto), enregistre-t-il un même quartier deux
fois (point et polygone), et peut-on se fier au nombre brut de quartiers ? **Les quatre
remarques sont fondées** ; elles ont été vérifiées sur les données réelles puis appliquées.

| Étape | Lieux |
|---|---:|
| Entrées brutes : tuiles OpenFreeMap (OSM) + export HOT publié sur HDX | 709 (600 + 109) |
| Lieux habités du Grand Abidjan (hors district et noms de commune écartés) | 656 |
| Doublons fusionnés (même nom normalisé à moins de 1,5 km) | 207 |
| **Lieux uniques retenus** | **449** |

- **Niveaux** : 57 quartiers, 289 sous-quartiers, 72 villages, 27 hameaux, 4 îles. Le
  quartier passe avant ses subdivisions dans la recherche (« Zone 4 » avant « Zone 4A »).
- **Doublons** : « Angré » quartier + sous-quartier à 591 m, « Kouté / Kouté village »,
  « Abobo Doumé / Abobo Doumé village », « Gobelet / Gobelet village », « Cité Star 5 /
  Cité Stars 5 »… Un test bloque tout nouveau doublon.
- **Communes** : limites administratives OSM (niveau 8) au lieu du centre de commune le
  plus proche, qui classait Angré à Abobo. 12 lieux de référence contrôlés.
- **Répartition** : 10 communes centrales, 328 lieux (Cocody 107, Yopougon 104,
  Attécoubé 26, Abobo 21, Port-Bouët 20, Marcory 17, Adjamé 12, Koumassi 11,
  Treichville 9, Plateau 1) ; Bingerville 68, Songon 28, Anyama 25. Le repère de l'Agence
  d'urbanisme d'Abidjan cité par la direction (environ 357 quartiers en 114 secteurs pour
  les 10 communes centrales) est du même ordre ; il n'a pas pu être vérifié à la source et
  les deux découpages ne se recouvrent pas exactement.
- **Recoupements** : les 100 villages et hameaux HDX du Grand Abidjan sont retrouvés ;
  3 absents des tuiles (Ouhoua, M'Brago 1, Attinguié) ajoutés. Overpass Turbo était
  injoignable depuis l'environnement d'audit : recoupement à refaire depuis un poste qui y
  a accès.
- **Mise à jour** : OSM change chaque semaine ; procédure en trois commandes dans
  `backend/scripts/lieux-osm/README.md`, à refaire chaque mois.
- **Quatre interfaces** (résolveur unique `src/modules/maps/lieux.ts`) : recherche et
  position du client ; offre et course du chauffeur ; colonne Trajet, dossiers SOS et
  télématique de la console ; statistiques par commune du tableau de bord. Vérifié en
  temps réel par une course de bout en bout (F7, 17/17).

## 9. Design : passe « unslop » (20 novembre)

Skill unslop (Damir Sokolovsky, CC BY 4.0) copié dans `.claude/skills/unslop`. Audit selon sa
grille : ~190 emoji en guise d'icônes ou de décor (dont les 37 entrées du menu de la console),
~160 dégradés de teinte, une trentaine de halos colorés, du texte en dégradé, des titres en
graisse 800–900, des libellés en capitales espacées, des boucles d'animation décoratives,
des salutations avec emoji et des points d'exclamation. Corrigé sur les quatre interfaces
sans toucher aux fonctions : icônes au trait du jeu du projet, aplats, en-têtes sur fond
neutre, un seul accent vert, texte foncé sur l'accent (4,5:1), graisses 600 au plus, casse
normale, aucun interlettrage sur l'arabe, accueil titré « Où allez-vous aujourd'hui ? ».
Les captures du rapport partagé précèdent cette passe.

## 10. Application Android à installer

APK de l'app client compilé et vérifié (Android 7 et plus ; signature v2) : fonctionne sans
serveur (courses simulées) avec la vraie carte d'Abidjan, le GPS du téléphone et la
recherche des 449 lieux, livrés dans l'app. Workflow `apk-client.yml` prêt pour le publier
dans une release du dépôt.

**Intégration continue** : depuis le 20 novembre vers 13 h, GitHub Actions n'attribue plus
de machine (macOS et Windows d'abord, puis Linux) : chaque tâche s'arrête en quelques
secondes, sans journal. Cause probable : quota de minutes du compte épuisé (les
simulateurs iPhone sur macOS comptent dix fois). À vérifier dans les réglages de
facturation GitHub ; les essais iPhone et Android sont à relancer ensuite.

## 11. APK complet : chaque bouton répond, carte et recherche d'Abidjan (20 novembre, soir)

Retour du client sur le premier APK : carte pauvre (ni commerces, ni banques, ni lieux de
culte, ni rues précises ; « Riviera Golf » introuvable), profil invisible, ORION Assurance
inaccessible, SOS et Partager sans effet. Cause commune : sans serveur, l'app court-circuitait
ces fonctions (« mode démonstration »). Corrigé :

- **Serveur local** (`frontend/src/serveurLocal.ts`) : sans `VITE_API_URL`, l'app répond
  elle-même aux routes qu'elle appelle, avec les formats du serveur, et garde les données sur
  le téléphone : compte vérifié par un code affiché à l'écran (aucun SMS sans serveur),
  profil et photo, historique des courses terminées, alertes SOS, aide, abonnement (forfaits
  du serveur, facture, paiement, résiliation), locations, messages ORION, dossier ORION
  Assurance, portefeuille et cotisations. Dès qu'un serveur est configuré, il n'est plus utilisé.
- **SOS** : le suivi s'ouvre (position, messages, appel direct du 185, 170, 180) avec la
  mention claire qu'en démonstration aucune alerte n'est transmise ; `delivered` reste faux.
- **Partager** : vraie feuille de partage du téléphone (`@capacitor/share`), sinon partage du
  navigateur, sinon copie du texte et du lien de position.
- **Profil** à côté de l'icône Paramètres ; **Colis** ouvre la livraison moto ; services à
  venir avec « Me prévenir » ; **portefeuille** réel (il affichait un solde inventé).
- **Finitions** : pastilles « Bientôt » remplacées par une mention discrète, icônes SVG à la
  place des symboles façon emoji (drapeaux, ✓, ✕, ★, ⬇), pastilles des raccourcis neutres
  (plus de filets verts), filigrane décoratif de l'accueil retiré.
- **Carte** : pictogrammes et noms des commerces, banques, restaurants, maquis, supermarchés,
  marchés, églises, mosquées, écoles, santé, hôtels, culture et loisirs, colorés par famille ;
  toutes les rues nommées ; numéros ; quartiers et sous-quartiers. Les 860 tuiles du district
  (Anyama, Bingerville, Songon, Grand-Bassam compris) sont livrées dans l'APK et servent hors
  connexion ; au-delà, la carte passe aux tuiles en ligne.
- **Recherche hors ligne** : 31 341 lieux (25 924 lieux nommés, 5 388 tronçons de rues, 29
  quartiers d'usage) en plus des 449 quartiers vérifiés. « pharmacie », « mosquée »,
  « banque »… donnent les plus proches ; chaque résultat indique son quartier et sa commune.
- **Quartiers d'usage** absents d'OpenStreetMap (Riviéra Golf, Riviéra Palmeraie, Riviéra
  Faya, Angré Château, Abobo Gare…) : placés à la médiane des lieux qui portent leur nom,
  retenus seulement si au moins trois concordent à moins de 1,2 km.

Outils : `frontend/scripts/carte-hors-ligne/` (téléchargement, indexation, construction).

**Vérification.** Un robot (Playwright, téléphone 412 × 892) a parcouru 31 écrans de l'app
autonome en touchant chacun de leurs boutons, à partir d'un même état (compte créé) ; il
classe l'effet de chaque toucher : navigation, changement à l'écran, ouverture externe
(téléphone, partage) ou rien. Il a relevé et fait corriger : la réservation mariage qui
annonçait « confirmée » sans rien enregistrer (désormais `/wedding/reserve`, date du
mariage, liste des réservations) ; la bannière SOS réduite qui affirmait « reçue par la
supervision » en démonstration et masquait profil et paramètres ; l'alerte de démonstration
impossible à clore ; les boutons − et + sans nom ; « Envoyer » actif sur un message vide ;
la feuille de commande trop transparente sur la carte dense. Les touchers restants « sans
effet » sont des options déjà sélectionnées. Un parcours de bout en bout (inscription avec
mauvais puis bon code, profil, messages, recherche « Riviera Golf », course, partage, SOS
et sa clôture, paiement, note, historique, ORION Assurance, abonnement, portefeuille, aide,
location, mariage, « Me prévenir », suppression du compte) passe ses 20 étapes sans erreur
JavaScript.

**APK 1.1.0** (versionCode 2, même certificat que la 1.0.0 : s'installe par-dessus) :
24,7 Mo, Android 7 et plus, SHA-256
`bd464e64bcfcc18c00d262353e0656068c1f102361b82520eece2f6ae3a809dc`.

**Reste à faire côté serveur** : ajouter les quartiers d'usage (Riviéra Golf…) au répertoire
du serveur (`backend/scripts/lieux-osm`) pour que la recherche en ligne les connaisse aussi.

**Consommation GitHub Actions réduite (20 novembre, nuit).** Chaque push lançait la CI deux
fois (push et pull request), dont Edge sous Windows (minutes comptées double) et Safari sous
macOS (comptées dix fois), plus deux compilations Android. Désormais : CI une seule fois par
modification et sur Linux seulement ; Windows et macOS, applications mobiles et démonstrations
filmées à la demande (onglet Actions → Run workflow). Les applications Windows et macOS de la
console restent dans le projet : seuls leurs tests automatiques sont devenus manuels.

## 12. Version 1.2 : centre de contrôle, trois gammes, carte comblée, design en volume (21 novembre)

Demande du client après l'APK 1.1 : un rendu « digne d'une application premium » (fond
blanc pur, sans transparence ni teinte verte, icônes réalistes), une carte plus complète,
trois gammes au lieu de quatre, des locations moins chères, un SOS où ce n'est pas au
client d'appeler les secours, un bouton Appeler qui ouvre le téléphone, et un serveur.

### Gammes et prix
- **Trois gammes** : Argent, Or, Diamant. L'Argent reprend la grille de l'ancien Bronze ;
  l'Or coûte **700 F** de plus que l'Argent, le Diamant **1 000 F** de plus que l'Or — un
  écart fixe, toutes taxes comprises, indépendant de la distance (réglable dans la
  console). Une demande « bronze » venue d'un ancien client est servie en Argent ; un
  barème enregistré avec quatre gammes est migré au démarrage.
- **Location Signature** : de **60 000 à 300 000 F la journée** (la console ne peut plus
  sortir de ces bornes). Forfait mensuel remisé : −30 % dès le premier mois, −35 % dès 3,
  −40 % dès 6, −45 % dès 12. **Entreprise : forfait mensuel uniquement, six mois minimum,
  renouvelable ou non** ; particuliers : heure, journée, week-end, semaine ou mois. Le devis
  affiche la mensualité, le total du forfait et le gain ; la caution porte sur un mois.

### SOS : le centre de contrôle prévient les secours
- **Agent ORION automatique** (`agent-sos.ts`, identique sur le serveur et dans
  l'application — un test échoue si les deux copies divergent). Il répond dès l'alerte,
  qualifie la situation (malaise, accident, agression, incendie, chauffeur dangereux,
  harcèlement, panne, objet oublié), donne les gestes qui protègent et **demande au centre**
  de prévenir le bon service. Le client n'a aucun appel à passer.
- La console affiche la synthèse et les demandes dans le dossier SOS (`Appeler`,
  `Marquer fait`) ; le client voit l'avancement réel : transmise, appel en cours, joint.
- Silence : relance à 30 s, rappel et police par précaution à 75 s. Fausse manœuvre
  confirmée : clôture automatique, sauf si la personne peut être sous contrainte (agression,
  harcèlement, chauffeur signalé) — alors un opérateur confirme de vive voix.
- **Contrôle de sécurité en course** (« Votre course se passe-t-elle bien ? ») : envoyé par
  le serveur, et désormais aussi par l'application sans serveur ; « Je ne me sens pas en
  sécurité » ouvre la conversation avec le centre.
- **Confidentialité, trouvée en chemin** : la conversation SOS et les messages ORION →
  client étaient diffusés sur le canal de la course, que l'app du chauffeur écoute. Une
  passagère signalant son chauffeur voyait ses messages partir vers lui. Ils ne passent
  plus que par le canal de l'alerte, réservé à son auteur.
- Les numéros 185 / 170 / 180 ne s'affichent plus qu'en dernier recours : alerte non
  transmise, démonstration, ou centre muet depuis trois minutes.

### Appel et serveur
- **Appeler** est un vrai lien `tel:` dans tous les cas : relié au serveur, il porte le
  numéro du chauffeur ; sans serveur (chauffeur simulé), un numéro fictif non attribué,
  avec la mention à l'écran. L'APK 1.1 n'affichait qu'un message.
- **Paramètres → Serveur ORION** : l'adresse du serveur se règle dans l'application, est
  testée (serveur ORION, https) puis retenue. Le même APK passe de l'autonomie au serveur
  sans réinstallation. Le serveur lui-même se déploie avec `render.yaml` (voir
  `DEPLOIEMENT.md`) : il demande un compte d'hébergement, que seul le client peut ouvrir.

### Carte
- Index des lieux : **31 341 → 48 924** (+56 %), tous affichés sur la carte. Sources
  ouvertes : OpenStreetMap complet (export HOT), bâtiments et voies nommés, Overture Maps.
  Détail et commandes : `frontend/scripts/carte-hors-ligne/README.md`.
- Riviéra Bonoumin : 286 → 456 lieux dans un rayon de 800 m ; Plateau : 342 → 684.
- Google Maps n'est pas utilisé : ses conditions interdisent de copier ses données.

### Design
- Direction : **sûr, net, chaleureux**. Fond blanc pur, gris neutres (plus aucune teinte
  verte), aucune surface translucide ni floutée ; plan de ville en gris neutres.
- Accents francs : vert `#00B85C`, bleu `#1463FF`, orange `#FF6A00` en aplat ; une teinte
  plus profonde quand l'accent sert d'encre sur fond blanc (lisibilité 4,5:1).
- **Objets en volume** : véhicules (berline, SUV, limousine, par gamme et par teinte),
  scooter de livraison, vues de dessus pour la carte et les neuf objets des services sont
  modélisés et rendus avec Blender (`frontend/scripts/rendus-3d/`), en vert, blanc et
  violet. L'accueil les présente sur des tuiles gris clair, le nom dessous.
- **Icônes en volume dans toute l'application** (demande du 21 novembre) : 32 objets de plus —
  couronnes d'argent et d'or et diamant des packs, mallette de premiers secours (SAMU), insigne
  (police), extincteur (pompiers), engrenage des paramètres, bouclier d'ORION Assurance, horloge
  de l'historique, bouton d'alerte SOS, portefeuille, maison, mallette, banque, avion, et les
  objets des lieux de la recherche (école, église, mosquée, hôtel, station, bus…). Les
  pictogrammes au trait ne restent que pour les gestes de l'interface.
- **Mode sombre neutre** : les fonds sombres étaient teintés par l'accent (vert-noir, brun,
  bleu nuit). Ils sont désormais d'un même graphite pour les trois accents — pages, feuilles,
  cartes, sélections, pastilles et plan de ville. L'accent ne reste que sur les boutons, le texte
  d'action et l'itinéraire.
- **Drapeaux en couleur** : langues et pays ont leur drapeau dessiné en vectoriel, identique
  sur tous les téléphones (les drapeaux « emoji » dépendent du système). L'arabe porte le
  drapeau des Émirats arabes unis.
- **Polices livrées avec l'application** : Sora et Inter ne sont plus téléchargées chez Google
  au lancement ; sans réseau, la typographie reste exactement la même (les quatre interfaces).
- **Packs d'abonnement** : Pack Argent, Pack Or, Pack Diamant — plus de « Bronze » ni de
  « Gold ». Prix, quotas et plafonds inchangés ; les identifiants enregistrés ne bougent pas.
- **Suivi de course** : le code de prise en charge est sur un aplat plein, « Annuler la
  course » est un bouton discret, plus aucun halo coloré autour des cartes sélectionnées.
- **Accueil réagencé** : « Mes courses » et « Aide » ont rejoint les paramètres, au même
  format de tuile. Les sept services restants tiennent sur deux rangées pleines — trois, puis
  quatre — sous Course et Livraison ; « Vos lieux » remonte dans le premier écran.
- **Objets animés** : sur l'accueil, la voiture et le scooter arrivent chacun de son côté,
  les objets entrent l'un après l'autre puis flottent doucement, chacun à son rythme. Vérifié
  par mesure : les neuf objets bougent ; aucun ne bouge quand le téléphone demande moins
  d'animations.
- **Icône de l'application en volume** : la feuille du logo en relief sur une dalle verte
  laquée, rendue comme les autres objets et déclinée pour toutes les densités Android (icône
  adaptative, ronde, carrée). La même image sert de logo dans l'application.
- **Un défaut trouvé en vérifiant** : la règle qui interdit tout flou d'arrière-plan
  disparaissait à la compilation (seule la forme préfixée survivait, que Chrome et Android
  ignorent). Le voile du contrôle de sécurité restait donc flouté. Corrigé et vérifié dans le
  fichier compilé.

### Vérifications de la version 1.2

| Contrôle | Résultat |
|---|---|
| Tests du serveur (`npm test`) | 383 réussis, 0 échec, 2 ignorés |
| Traductions (`npm run check:langues`) | 739 textes couverts dans les 8 langues |
| Scénario SOS et contrôle de sécurité (navigateur piloté) | 9 étapes sur 9, aucune erreur JavaScript |
| Parcours complet sur le contenu exact de l'APK | 20 étapes sur 20 : inscription, course, partage, SOS, paiement, historique, assurance, abonnement, portefeuille, aide, location, mariage, suppression du compte |
| Animations de l'accueil | 9 objets en mouvement ; 0 quand le téléphone demande moins d'animations |
| Application reliée à un vrai serveur local | liaison depuis les paramètres, course, numéro du chauffeur, SOS, reprise par un opérateur (passé avant la refonte graphique, non rejoué depuis) |
| APK `ORION-client-1.2.0.apk` | version 1.2.0 (code 3), 26,4 Mo, même certificat que la version précédente ; SHA-256 `a503ec01728e2c48e2ad03e77b65d10eb3b128754fee65a9cf893a3496643f51` |

Non rejoué sur cette version : le robot qui touche chaque bouton (dernier passage sur la
version 1.1). L'intégration continue GitHub reste à l'arrêt (facturation du compte).

Limites à connaître : le serveur n'est pas hébergé (il faut un compte chez un hébergeur,
voir `DEPLOIEMENT.md`) ; tant que l'application n'y est pas reliée, les courses sont
simulées et le SOS ne prévient aucun secours réel — il l'écrit à l'écran. Les données de
Google Maps ne sont pas utilisées (conditions d'utilisation).

## 13. Lien partageable : l'application ne s'ouvrait pas (21 novembre)

**Constat.** Depuis la page partagée, « Ouvrir l'app client » menait à un écran vide. Les
quatre autres interfaces aussi.

**Cause.** La version web appelait ses fichiers par chemin absolu (`/assets/…`). Or la
page partagée n'est pas servie à la racine d'un domaine mais dans un sous-dossier
(`/_f/<version>/demo/`) : à la racine, ces fichiers n'existent pas, tout répondait 404 et
rien ne démarrait. Les essais précédents servaient la même version à la racine d'un
serveur local, où le défaut ne se voit pas.

**Corrections.**

| Fichier | Changement |
|---|---|
| `frontend/vite.config.ts` | Base **relative** par défaut pour toute version publiée (`./assets/…`) : la même construction s'ouvre à la racine, en sous-dossier, dans l'app Android/iOS et dans une page partagée. `VITE_BASE` reste possible (GitHub Pages). |
| `frontend/src/stockageSur.ts` | Chargé en premier par les cinq points d'entrée. Si le navigateur refuse le stockage local dans un cadre (navigation privée, blocage des cookies tiers), la lecture de `localStorage` levait une erreur avant tout affichage : il est alors remplacé par une mémoire le temps de la visite. Sinon, rien n'est touché. |
| `frontend/src/pwa.tsx` | L'enregistrement du service worker ne peut plus interrompre le démarrage dans un cadre isolé. |
| `frontend/src/api.ts` | Après un refus du calcul d'itinéraire public, pas de nouvelle tentative pendant 30 s : le tracé de repli s'affiche tout de suite. |
| `frontend/scripts/fumee-navigateurs.mjs` | 2e passe du test de fumée (CI, tous navigateurs) : les cinq interfaces servies **en sous-dossier, dans un cadre, stockage refusé**. Toute réapparition d'un chemin absolu fait échouer la CI. |

**Vérifications.**

- Panne reproduite à l'identique sur la version publiée avant correction (404 sur tous
  les fichiers, écran vide), dans une copie du cadre : même sous-chemin, même politique
  de sécurité (CSP), mêmes interdictions (géolocalisation).
- Après correction, dans ce même cadre : clic sur « Ouvrir l'app client », inscription,
  accueil (9 tuiles, 15 objets en volume), recherche « Riviera Golf », gammes et prix ;
  puis app chauffeur, console, tableau de bord et écran de véhicule. Aucune erreur, avec
  le stockage autorisé comme refusé.
- Sur l'adresse réelle de la page republiée : les 52 fichiers appelés par les cinq pages
  répondent 200, aucun chemin absolu.
- Parcours complet de l'app client : 20 étapes sur 20.
- Contre-épreuve : le nouveau test échoue bien sur une construction en chemins absolus.

**Limite qui reste.** Dans la page partagée, le trajet est tracé en ligne droite : la
page n'a pas le droit d'interroger le calcul d'itinéraire. Dans l'application installée,
avec une connexion, il suit les routes. La page partagée l'indique.

**Non vérifié.** L'ouverture dans la visionneuse elle-même, depuis un téléphone : cet
environnement ne peut pas la charger (contrôle anti-robot). La vérification porte sur
l'adresse qui sert les fichiers et sur une copie du cadre.

## 14. Version 1.3 : menu à trois traits, bulle GPS, Google Maps, recherche côté serveur (21 novembre)

**Demandes.** Une icône sur la carte pour actualiser la position GPS avant et pendant la
course ; la vraie carte Google Maps dans l'APK, pour les essais ; trois traits à la place
des trois icônes en haut à droite, ouvrant le profil et toutes les rubriques ; des icônes
de menu minimalistes, en traits noirs, dans des bulles, sur le modèle de la capture
fournie ; un nouvel APK.

### App cliente

| Sujet | Ce qui a été fait |
|---|---|
| Trois traits | `App.tsx` : les trois boutons de l'en-tête (messages, avatar, engrenage) sont remplacés par un bouton à trois traits, de la couleur du texte. La pastille des messages non lus y est reportée. |
| Menu | `CompteScreens.tsx` : avatar, nom, numéro vérifié ; quatre bulles (Mes courses, Aide, Adresses, Paramètres) ; trois groupes de lignes (icône, titre, explication, chevron). Les réglages eux-mêmes passent dans un écran « Paramètres », la sécurité et les adresses dans les leurs. |
| Icônes | Traits noirs, fond transparent, ni ombre ni dégradé (`icons.tsx`, épaisseur 1,9). Les icônes secondaires de toute l'application sont posées dans des bulles translucides (`.bulle`). Le menu et ses écrans n'emploient plus la couleur d'accent : noir sur gris clair, clair sur graphite en mode sombre. |
| Bulle GPS | `OrionMap.tsx`, `gpsCarte.ts`, `lieux.ts` : une bulle ronde sur la carte relit la position du téléphone (lecture fraîche, sans cache). **Avant la course**, le point de départ suit la nouvelle position et le prix est recalculé. **Pendant la course**, un repère « vous êtes ici » se déplace ; la course n'est pas modifiée. Refus de l'autorisation, GPS indisponible et position hors zone ont chacun leur message. |
| Google Maps | `carteGoogle.ts`, `CarteGoogle.tsx`, `CarteFondScreen.tsx` : le moteur officiel de Google (Maps JavaScript API), pas une copie de ses images. Itinéraire, véhicule, départ, arrivée et repère GPS ORION sont posés dessus. Menu → Carte : choix du fond, saisie de la clé, **aperçu en direct** de la carte Google. |

**Pourquoi une clé.** Google n'affiche sa carte dans une application qu'avec une clé
d'API rattachée à un compte Google Cloud. Sans clé, il sert une carte assombrie marquée
« For development purposes only ». Récupérer ses images sans passer par ce service est
interdit par ses conditions d'utilisation : ce n'est pas fait. La clé n'est écrite ni
dans le dépôt ni dans l'APK : le client la colle dans Menu → Carte, elle reste sur son
téléphone (ou elle est fournie à la construction par `VITE_GOOGLE_MAPS_API_KEY`).

**Clé refusée.** Sur un téléphone, il n'y a pas de console pour lire l'erreur de Google.
L'écran Carte l'affiche donc en clair : clé inconnue ou expirée, service « Maps
JavaScript API » non activé, clé limitée à d'autres sites (l'application Android charge
la carte depuis `https://localhost/`), facturation non activée. Dans tous ces cas
l'application repasse d'elle-même sur la carte ORION : la course n'est jamais bloquée
par le fond de carte.

### Serveur : recherche de lieux sur l'index enrichi

L'app cliente, l'app chauffeur, la console et le tableau de bord cherchaient déjà dans
l'index de 48 924 lieux livré avec elles. Le serveur, lui, ne connaissait que les
communes et 449 quartiers : un client de l'API (écran de véhicule, constructeur,
partenaire) n'obtenait pas les mêmes résultats.

| Fichier | Changement |
|---|---|
| `backend/data/lieux-index.json.gz` | Le même index que celui des applications (0,7 Mo compressé). `npm run index-lieux` le recopie ; un test échoue si les deux copies divergent. |
| `backend/src/modules/maps/index-lieux.ts` | Lecture unique, à la première recherche. Index absent ou illisible : la recherche garde communes et quartiers. |
| `backend/src/modules/maps/geocodage.ts` | Le répertoire cherche aussi dans l'index. Un nom de catégorie (« pharmacie », « banque », « mosquée ») donne les lieux de cette catégorie les plus proches. Chaque résultat porte sa catégorie et son quartier ; 12 résultats au plus, sans doublon à moins de 300 m. |
| `backend/Dockerfile` | L'image du serveur embarque l'index. |

### Vérifications

- Serveur : 391 tests, 389 réussis, 0 échec (2 tests SQLite ignorés, comme avant). 6
  nouveaux tests sur la recherche.
- App cliente, sur le contenu exact de l'APK : parcours complet 20 étapes sur 20 ;
  parcours 1.3 (trois traits, menu, bulles, écrans du menu, bulle GPS avant et pendant
  la course) 9 étapes sur 9 en clair sur la carte ORION, en clair et en sombre sur
  Google Maps ; écran Carte 5 étapes sur 5 (aperçu Google, clé refusée avec son motif,
  retour à la carte ORION, clé effacée).
- Test de fumée des cinq interfaces : 12 passages sur 12, dont l'ouverture en
  sous-dossier, dans un cadre, stockage refusé.
- Textes : 783 clés, toutes traduites dans les huit langues.
- APK 1.3.0 : `ci.orion.app`, version 4, même signature que les précédents (il s'installe
  par-dessus). Les 39 fichiers web qu'il contient sont identiques, octet pour octet, à
  la version testée. Aucune clé Google dedans.

### Limites

- **Google Maps avec une vraie clé n'a pas été vérifié.** Les essais ont porté sur la
  carte sans clé (celle que Google marque « For development purposes only ») et sur une
  clé volontairement fausse. L'affichage net dépend d'une clé valide, que seul le
  titulaire du compte Google Cloud peut créer.
- **Rien n'a été essayé sur un téléphone.** Les parcours tournent dans le moteur de
  Chrome, celui de l'application Android, pas sur un appareil.
- **Position du client pendant la course.** Elle est actualisée sur le téléphone du
  client. Reliée à un serveur, l'application ne la transmet pas encore au chauffeur ni
  au centre de contrôle.
- **Google Maps ne fonctionne qu'avec une connexion.** Sans réseau, la carte ORION,
  livrée dans l'application, prend le relais.

## 15. Version 1.4 : Google Maps, seule carte de l'app cliente (21 novembre)

**Demande.** Le client a fourni sa clé Google (service « Maps JavaScript API ») et
demandé que la carte de l'application soit celle de Google, et elle seule ; il souhaite
aussi que les autres services de son compte Google Cloud soient mis à profit.

### Ce que la clé permet (sonde depuis l'adresse de l'application Android)

Une page de sonde, servie à l'adresse `https://localhost` (celle de l'application
Android), a interrogé chaque service de Google Maps avec cette clé.

| Service | Résultat |
|---|---|
| Maps JavaScript API (affichage de la carte) | **Accepté.** Carte nette, sans filigrane. |
| Street View (inclus dans la carte) | Accepté. |
| Places API (New) : recherche et détail de lieux | Refusé : service non activé sur le projet. |
| Routes API : itinéraire avec trafic | Refusé : service non activé. |
| Geocoding API : adresse d'une position | Refusé : service non activé. |
| Places, Directions, Distance Matrix (anciennes versions), Elevation | Refusés : non activés. |

La clé est acceptée depuis n'importe quelle adresse : elle n'a aucune restriction
d'application. L'accès Google Cloud ouvert dans Claude est un connecteur BigQuery
(requêtes SQL) ; il ne permet ni de voir ni d'activer les services du projet.

### Ce qui a été fait

| Fichier | Changement |
|---|---|
| `frontend/src/carteGoogle.ts` | Construction « Google seul » (`VITE_MAP_GOOGLE_SEUL=1` avec une clé) : `fondCarte()` répond toujours Google ; la clé de la construction prime sur toute clé saisie avec une version précédente ; `reessayerGoogle()` relance le chargement. |
| `frontend/src/components/OrionMap.tsx`, `ChoixLieu.tsx` | Plus de repli sur la carte ORION dans cette construction. Si Google ne répond pas ou refuse la clé, un panneau le dit, donne le motif et propose « Réessayer ». La recherche, les prix et la commande restent utilisables. |
| `frontend/src/components/CarteFondScreen.tsx` | Menu → Carte n'offre plus ni choix ni saisie de clé : une ligne « Google Maps », l'aperçu de la carte en service, son état. |
| `frontend/src/components/CarteGoogle.tsx`, `index.css` | La carte s'arrête exactement au bord de la feuille du bas. Le logo et les mentions de Google passaient dessous : ils sont maintenant entièrement visibles, comme ses conditions l'exigent. |
| `frontend/scripts/construire-client-google.sh` | Construit l'app cliente « Google seul ». La clé vient de l'environnement ; elle n'est écrite nulle part dans le dépôt. Les tuiles et polices de la carte ORION ne sont plus livrées. |
| `.github/workflows/apk-client.yml` | Avec un secret `GOOGLE_MAPS_API_KEY`, l'APK compilé par GitHub est lui aussi « Google seul » ; sans ce secret, il garde la carte ORION. |
| `frontend/android/app/build.gradle` | Version 1.4.0 (code 5). |

**Ce qui ne change pas.** La recherche d'adresses reste celle d'ORION (48 924 lieux
livrés avec l'application) et l'itinéraire reste celui du calcul ORION, tracé sur la
carte Google : Places et Routes ne sont pas activés sur le projet. L'app chauffeur, la
console, le tableau de bord et la version web de démonstration gardent la carte ORION.

### Vérifications (avec la vraie clé)

Tous les parcours tournent sur le contenu exact de l'APK 1.4.0, avec la clé du client.

- **Google seul**, en clair puis en sombre, 7 étapes sur 7 chaque fois : Menu → Carte
  (une seule ligne, aperçu de la vraie carte, sans filigrane) ; choix du véhicule,
  commande et suivi sur Google Maps avec les repères ORION ; bulle GPS avant et pendant
  la course ; choix d'un point sur la carte ; logo et mentions de Google visibles
  au-dessus de la feuille sur les trois écrans ; Google coupé → panneau « Google Maps ne
  répond pas », trois gammes toujours proposées ; « Réessayer » → la carte revient.
- Aucune tuile ni police de la carte ORION n'est demandée pendant ces parcours.
- Une clé fausse et un choix « carte ORION » laissés par la version 1.3 sur le téléphone
  sont ignorés : la carte Google s'affiche.
- Parcours du menu (trois traits, bulles, écrans, GPS) : 9 étapes sur 9.
- Parcours complet (inscription, course, partage, SOS, paiement, assurance, abonnement,
  location, mariage, suppression du compte) : 20 étapes sur 20.
- Textes : 789 clés, toutes traduites dans les huit langues.
- APK 1.4.0 : `ci.orion.app`, code 5, même signature que les précédents ; 10,7 Mo au lieu
  de 26,6 ; ses 140 fichiers web sont identiques à la version testée ; aucune tuile ni
  police de la carte ORION dedans. La clé y figure (c'est voulu) ; elle ne figure ni dans
  le dépôt ni dans son historique.

### Page partageable

La page d'audit est republiée à la même adresse, en version 1.4 :

- les 30 captures de l'app client sont celles de l'APK 1.4.0, sur Google Maps, avec la
  clé du client ; les 40 captures de l'app chauffeur, de la console et du tableau de bord
  sont refaites après leur alignement graphique, sans serveur (données d'exemple) ;
- la démonstration web est la version 1.4 sans clé : elle garde la carte ORION, la page
  n'ayant pas le droit de charger Google Maps. Aucune clé n'est publiée ;
- la section Android donne les trois réglages qui protègent la clé et les trois services
  à activer pour aller plus loin.

Vérifications : dans une copie du cadre de partage (même sous-chemin, même politique de
sécurité), les cinq interfaces s'ouvrent, stockage autorisé comme refusé ; l'app client
y passe l'inscription, la recherche, la bulle GPS (position refusée, dite à l'écran), le
menu et l'écran Carte (Google injoignable, dit à l'écran). Sur l'adresse réelle, les 502
fichiers de la page répondent 200 et les anciens ne sont plus servis. L'ouverture dans
la visionneuse elle-même, depuis un téléphone, reste non vérifiée d'ici.

### Limites

- **Rien n'a été essayé sur un téléphone.** Les parcours tournent dans le moteur de
  Chrome, celui de l'application Android, à la même adresse (`https://localhost`).
- **La clé est dans l'APK**, comme toute clé de carte affichée côté client : qui possède
  le fichier peut la lire. Elle doit être restreinte dans Google Cloud (services
  autorisés, adresse `https://localhost/*`) et son quota plafonné.
- **Sans connexion, plus de carte** : c'est la conséquence de « Google seul ». L'écran
  le dit ; la recherche et la commande restent possibles.
- **Les lieux de Google ne sont pas encore dans la recherche** : il faut activer
  « Places API (New) » sur le projet. De même « Routes API » pour un itinéraire tenant
  compte du trafic, et « Geocoding API » pour l'adresse exacte d'une position.

## 16. Version 1.5 : les lieux, les itinéraires et les adresses de Google ; accueil noir, gris et blanc ; icônes au trait (21 novembre)

**Demande.** Trois points : (1) hors de l'accueil, toutes les icônes de l'app cliente
dans le style des paramètres, sans couleur, le bouton SOS restant rouge ; (2) à
l'accueil, les neuf objets en volume refaits en noir, gris et blanc, plus réalistes, à
titre d'essai (la version en couleur doit pouvoir revenir) ; (3) la « vraie » carte
Google : dans l'APK 1.4, chercher « FAO » ne donnait rien alors que l'application Google
Maps en montre plusieurs.

### Pourquoi « FAO » ne sortait pas

La carte et la recherche sont deux services distincts chez Google. La clé de la version
1.4 n'autorisait que l'affichage de la carte : la recherche restait celle d'ORION. Le
client a depuis activé trois services sur son projet ; la sonde, relancée depuis
l'adresse de l'application Android, le confirme :

| Service | Version 1.4 | Aujourd'hui |
|---|---|---|
| Maps JavaScript API (carte) | Accepté | Accepté |
| Places API (New) : lieux | Refusé | **Accepté** |
| Routes API : itinéraire avec trafic | Refusé | **Accepté** |
| Geocoding API : adresse d'une position | Refusé | **Accepté** |
| Places, Directions, Distance Matrix (anciennes versions) | Refusés | Refusés (inutiles) |

### Ce qui a été fait

| Sujet | Changement |
|---|---|
| Recherche | Les suggestions viennent de Google (cinq au plus, règle de Google), suivies des lieux d'ORION. « Voir tous les lieux pour « FAO » » (ou la touche Entrée) donne la liste complète de Google, chaque lieu avec sa position. Le nom affiché reste celui que le client a touché. |
| Itinéraire | Sur la carte Google, le trajet est celui de Google : il suit ses routes et la pastille du haut donne la durée avec le trafic du moment, la distance par la route et la grande voie empruntée (« 12 min · 4,7 km · via Bd de France »). |
| Adresse | La position du téléphone et le point choisi sur la carte portent le nom de la rue, d'après Google, suivi du quartier d'ORION (« Rue Moro Bitty, Cité des Arts »). Les références de voirie (« C 20 ») sont écartées. Le SOS continue de transmettre le quartier. |
| Menu → Carte | Une rubrique « Services Google » dit, pour les lieux, les itinéraires et les adresses, si Google répond pour la clé, avec le motif en cas de refus et un bouton « Vérifier maintenant ». |
| Repli | Chaque service est indépendant. Refus (service non activé) ou silence de Google : la recherche, le tracé ou le quartier d'ORION prennent le relais, sans message d'erreur ni blocage. |
| Cadrage | La carte se recadre sur le trajet quand la feuille du bas change de hauteur : le départ ou l'arrivée ne glissent plus dessous. |
| Accueil | Neuf rendus refaits dans une palette noir laqué, graphite, gris perle, céramique et acier brossé (`public/rendus/nb/`, 187 ko). Le scooter de l'écran Livraison suit. |
| Icônes | Packs Argent, Or et Diamant, SAMU, police, pompiers, domicile, bureau, banque et tous les lieux des listes, assurance, historique, alertes SOS, portefeuille, abonnement, Wi-Fi : pictogrammes au trait, sans couleur. Le bouton SOS et l'écran SOS restent rouges. |
| Retour en arrière | Une ligne dans `src/main.tsx` : `accueil: 'couleur'` rétablit les objets vert, blanc et violet ; `icones: 'volume'` rétablit les icônes en volume. Les rendus en couleur sont toujours livrés. |

Fichiers : `src/servicesGoogle.ts` (état de chaque service), `src/lieuxGoogle.ts`,
`src/itineraireGoogle.ts`, `src/adressesGoogle.ts`, `src/lieux.ts`,
`src/components/{CarteGoogle,ChoixLieu,CarteFondScreen,Vehicules}.tsx`, `src/icons.tsx`,
`scripts/rendus-3d/{orion3d,rendre}.py`. Version 1.5.0 (code 6).

**Ce qui ne change pas.** Le prix d'une course reste calculé par ORION, sur la même
distance qu'avant : la durée et la distance de Google sont une information affichée sur
la carte, pas une base de facturation. Les véhicules des gammes (Argent, Or, Diamant) et
de la location gardent leur teinte, qui désigne la gamme. L'app chauffeur, la console et
le tableau de bord gardent la carte ORION et les objets en couleur.

### Vérifications (avec la vraie clé, sur le contenu exact de l'APK)

- **Services Google**, en clair puis en sombre, 8 étapes sur 8 : « FAO » → 13 lignes dont
  « FAO CI (bureau officiel) », « FAO CONSEIL », « FIDA » ; le lieu choisi est localisé
  par Google puis mène au choix du véhicule avec le trajet Google affiché ; « Voir tous
  les lieux » → 15 lieux pour « FAO », 30 pour « Sococé » ; Menu → Carte : lieux,
  itinéraires et adresses actifs, aucun texte coupé ; point choisi sur la carte nommé par
  sa rue ; neuf tuiles d'accueil en noir, gris et blanc, aucune image manquante ; aide et
  packs au trait, aucune icône en volume.
- **Google seul**, en clair puis en sombre, 7 étapes sur 7 : version 1.5.0 affichée, logo
  et mentions de Google visibles au-dessus de la feuille, Google coupé → panneau
  « Google Maps ne répond pas » et commande toujours possible, « Réessayer » → la carte
  revient. Aucune tuile ni police de la carte ORION demandée.
- Parcours du menu et de la bulle GPS : 9 étapes sur 9. Parcours complet (inscription,
  course, partage, SOS, paiement, assurance, abonnement, location, mariage, suppression
  du compte) : 20 étapes sur 20. Trente écrans capturés, aucune erreur JavaScript.
- Ce parcours complet a révélé un défaut, corrigé avant l'envoi : en touchant « Riviéra
  Golf », la destination prenait le nom « Riviéra 1 » renvoyé par Google.
- Textes : 808 clés, toutes traduites dans les huit langues.
- APK 1.5.0 : `ci.orion.app`, code 6, même signature que les précédents, 11,0 Mo ; ses
  149 fichiers web sont identiques à la version testée. La clé y figure (c'est voulu) ;
  elle ne figure ni dans le dépôt ni dans son historique.

### Limites

- **Rien n'a été essayé sur un téléphone.** Les parcours tournent dans le moteur de
  Chrome, celui de l'application Android, à la même adresse (`https://localhost`).
- **La recherche Google exige une connexion** ; sans réponse de Google, la recherche est
  celle d'ORION (48 924 lieux), sans que le client ait à le demander.
- **Google facture ces services à l'usage** au-delà de son quota gratuit mensuel. Une
  session ordinaire en appelle peu (quelques recherches, un trajet par itinéraire
  affiché, une adresse par position lue), mais la clé est dans l'APK et sans restriction :
  la limiter aux quatre services utilisés et à l'adresse `https://localhost/*`, et
  plafonner les quotas.
- **Le prix n'utilise pas la distance de Google** : le serveur et l'application calculent
  toujours sur la distance à vol d'oiseau entre les points. L'aligner sur la distance par
  la route est une décision tarifaire, non prise ici.
- **L'APK compilé par GitHub** garde la carte ORION tant que le secret
  `GOOGLE_MAPS_API_KEY` n'est pas ajouté au dépôt.
- **La page partageable** montre encore la version 1.4.

## 17. Version 1.5.1 : accueil sur tuiles translucides, objets aux couleurs naturelles (21 novembre)

**Demande.** Après essai de la version 1.5 : les neuf objets de l'accueil sont « trop noir
et blanc », et leur fond ne doit plus être blanc mais transparent, dans l'esprit des
interfaces Apple ; le rendu attendu est celui des applications de transport du type Uber.
Le client a joint un exemple d'appel au modèle Claude par Vertex AI (Google Cloud).

### Ce qui a été fait

| Sujet | Changement |
|---|---|
| Objets | Troisième palette de l'atelier 3D, « urbain » : base neutre (blanc cassé, anthracite, gris) et couleur des matières — sacs et carton en kraft, or de la carte, de la médaille et des alliances, cuir fauve de la selle et du porte-clés, pain doré, salade, tomate, pomme, bouteille verte, feux rouges. Berline et scooter en blanc nacré. Neuf rendus dans `public/rendus/urbain/`. |
| Tuiles | Le fond n'est plus un aplat clair : une plaque translucide, sans couleur, lue à son reflet en haut à gauche, à son bord plus dense en bas à droite et à l'ombre douce qu'elle pose. Même matière en clair et en sombre. |
| Retour en arrière | `accueil: 'nb'` ou `accueil: 'couleur'` dans `src/main.tsx` : les trois jeux de rendus sont livrés. |

**L'exemple Vertex AI n'a pas été utilisé.** Il appelle un modèle de texte : il n'aurait
produit aucune image. La session n'a par ailleurs ni identifiant de projet ni droits sur
le compte Google Cloud du client, et un appel serait facturé sur ce compte. Les objets
sont modélisés et rendus par l'atelier 3D du dépôt (Blender), ce qui garantit le fond
transparent et la cohérence des neuf images.

**Sur l'inspiration.** Le registre est repris (objets clairs et doux, base neutre, couleur
portée par la matière) ; aucun pictogramme d'une autre application n'est copié : les neuf
objets sont les modèles d'ORION.

### Vérifications (sur le contenu exact de l'APK 1.5.1)

- Accueil : neuf images de la palette urbaine, aucune manquante ; neuf tuiles dont le fond
  est translucide (dégradés à transparence, aucun aplat opaque), en clair et en sombre.
- Services Google (lieux, itinéraire, adresse, Menu → Carte) : 8 étapes sur 8. Google seul,
  en clair puis en sombre : 7 sur 7. Menu et bulle GPS : 9 sur 9. Parcours complet : 20
  sur 20. Aucune erreur JavaScript.
- APK 1.5.1 : `ci.orion.app`, code 7, même signature, 10,9 Mo ; ses 158 fichiers web sont
  identiques à la version testée. La clé n'est ni dans le dépôt ni dans son historique.

### Limites

- Sur une page blanche, une plaque translucide reste claire : elle se distingue par son
  reflet, son bord et son ombre, pas par une teinte. Elle prendrait la couleur de tout
  fond placé derrière elle.
- Aucun flou d'arrière-plan : rien ne passe derrière une tuile, il coûterait de la
  fluidité sans se voir.
- **Rien n'a été essayé sur un téléphone**, comme pour les versions précédentes.
- **La page partageable** montre encore la version 1.4.

## 18. Version 1.5.2 : prix sur le trajet par la route, carte Google fluide (21 novembre)

**Demande.** Après essai de la 1.5.1 : les prix ont paru trop bas depuis la carte Google ;
la carte « bugge » au démarrage et pendant la recherche de lieux ; l'accueil ne convenait
pas encore. Plusieurs pistes d'accueil ont été montrées en images (cartes à fond rouge
léger, puis rouge franc, puis de nouveau translucides avec le nom dans la carte et un
bandeau de marque) : le client a choisi de **revenir à l'interface de la 1.5.1**, telle
quelle. La feuille de style est celle de la 1.5.1, plus neuf lignes.

### Prix

La carte Google n'avait pas changé le calcul : depuis la première version, le prix était
calculé sur la distance **à vol d'oiseau**. La carte Google affiche désormais la distance
par la route, d'où l'écart devenu visible (4,7 km affichés, prix calculé sur 3,1 km).

| Où | Changement |
|---|---|
| App cliente | Le prix se calcule sur le trajet tracé sur la carte : itinéraire de Google s'il répond, sinon calcul routier d'ORION (`src/tarifTrajet.ts`). Sans trajet (hors connexion), 1,3 fois le vol d'oiseau. Un trajet invraisemblable est écarté. Le trafic est celui du trajet quand Google donne la durée avec et sans circulation. Tant que le trajet n'est pas connu, l'écran affiche « … » au lieu d'un montant provisoire. |
| Serveur | `distanceFacturee()` : même règle pour les courses et les livraisons ; la distance vient du module de routage (`routeMeters`), avec un délai de 1,8 s, sinon 1,3 fois le vol d'oiseau. |

Exemples mesurés depuis la Cité des Arts : FAO, 4,7 km par la route, Argent 1 150 F au
lieu de 950 F ; Sococé, 3,9 km, 1 050 F. Le barème lui-même (prise en charge, prix au
kilomètre et à la minute, suppléments de gamme) n'est pas modifié.

### Carte

Mesures dans le moteur de l'application, écran réduit pendant la saisie pour simuler le
clavier d'un téléphone :

| Mesure | 1.5.1 | 1.5.2 |
|---|---|---|
| Recentrages de la carte pendant la frappe de 13 lettres | 9 | 0 |
| Ouverture de la recherche → carte avec ses tuiles | 634 ms | 145 ms |
| Cartes Google créées sur un trajet complet (recherche → suivi) | 5 | 1 |
| Recadrages sur ce trajet | 28 | 14 |

Causes et corrections : la carte était recréée à chaque écran — elle est maintenant unique,
préparée dès l'accueil et déplacée d'écran en écran ; elle se recentrait à chaque
changement de hauteur de la feuille du bas (donc à chaque lettre, clavier ouvert) — elle
ne recadre plus que si le trajet change ou si la hauteur utile varie de plus de 40 px, et
jamais pendant la saisie.

### Rappel de la palette dans le thème

Dernière demande avant l'installation : la palette choisie (vert, bleu ou orange) doit se
retrouver dans le visuel, mêlée légèrement au blanc et au sombre. Elle teinte maintenant
le thème de quelques pour cent — pages, feuilles, surfaces et filets, en clair comme en
sombre — et pose une lueur derrière le titre et la recherche de l'accueil, éteinte avant
les tuiles. Un premier essai teintait aussi les tuiles translucides et posait une lueur
sous chaque objet : le client ne l'a pas retenu, **les tuiles ne sont pas modifiées**.
Cette règle revient sur celle de la version 1.2 (« aucune teinte dans les fonds »), à la
demande du client. L'APK garde le numéro 1.5.2 ; son code interne passe à 9 pour
s'installer par-dessus une 1.5.2 déjà posée.

### Vérifications (sur le contenu exact de l'APK 1.5.2)

- Accueil comparé à la capture de la 1.5.1 avant l'ajout de la teinte : identique, aux
  objets animés près. Accueil et menu vus dans les trois palettes, en clair et en sombre.
- Services Google et prix, en clair puis en sombre : 9 étapes sur 9, dont « la distance du
  détail du prix est celle affichée sur la carte ». Google seul : 7 sur 7 dans les deux
  thèmes. Menu et bulle GPS : 9 sur 9. Parcours complet : 20 sur 20. Aucune erreur JavaScript.
- Serveur : 395 tests, 393 réussis, 2 ignorés (SQLite) ; quatre tests nouveaux sur la
  distance facturée.
- APK 1.5.2 : `ci.orion.app`, code 9, même signature, 10,9 Mo ; ses 158 fichiers web sont
  identiques à la version testée. La clé n'est ni dans le dépôt ni dans son historique.

### Limites

- **Rien n'a été essayé sur un téléphone.** La fluidité est mesurée dans le moteur de
  Chrome sur une machine de test, pas sur l'appareil du client.
- **Vertex AI n'est pas utilisé.** La clé Maps du client y est refusée (« API keys are not
  supported by this API ») et l'API Gemini est refusée sur son projet : les objets 3D
  restent ceux de l'atelier du dépôt.
- **Les prix montent** d'environ 10 à 60 % selon le détour imposé par la route (ponts de
  la lagune) : c'est l'effet voulu, à surveiller sur les premiers trajets réels.
- **La page partageable** montre encore la version 1.4.

## 19. Version 1.5.3 : prix du serveur dans l'application, Côte d'Ivoire seule, couleurs plus vives, sécurité Google Cloud (21 novembre)

### Le prix affiché hors serveur est celui du serveur

Sans serveur relié, l'application calculait le prix avec le barème seul. Le serveur, lui, ajoute
le facteur de la commune de départ (Yopougon et Abobo 0,92 ; Treichville et Adjamé 0,95 ; Plateau
1,05 ; aéroport 1,10 ; secteurs résidentiels 1,08 à 1,18), les frais de prise en charge de ces
secteurs (100 à 250 F) et un trafic estimé selon l'heure **et** la densité des zones du trajet.
Ces règles sont désormais recopiées dans l'application (`frontend/src/tarifServeur.ts`) et
`backend/tests/prix-application.test.ts` demande le même devis aux deux : 108 devis de course
(12 trajets, 3 gammes, berline, SUV, arrêt) et 36 devis de livraison, identiques au franc près.
Le test échoue dès qu'un côté change sans l'autre.

Ce qui reste propre à un serveur relié : la majoration de forte demande (plafonnée à 1,3), les
réglages modifiés depuis la console et les codes promo. Conséquence pour le trafic : le prix suit
la règle du serveur (heure et zones) et non plus la circulation mesurée par Google ; la durée
affichée reste celle de l'itinéraire réel.

Repère, trajet de 20,5 km au départ de Yopougon, gamme Argent : 3 700 F la nuit, 4 050 F en
journée, 4 050 à 4 500 F aux heures de pointe ; avec la majoration maximale, 5 250 à 5 800 F.
Sur le même trajet, la capture Yango fournie affichait 6 600 à 8 900 F. Cas extrême où ORION
dépasserait le tarif le plus bas de cette capture : départ d'un secteur résidentiel à 1,18,
heure de pointe saturée et majoration maximale (environ 7 750 F).

### Pays

Seule la Côte d'Ivoire est affichée dans les paramètres ; Ghana, Sénégal, Togo, Bénin et Nigeria
(« Bientôt ») sont retirés.

### Couleurs plus vives, sans changement de teinte

Les objets de l'accueil sont ceux de la palette urbaine, plus saturés (`rendus/vif/`, produits
par `publier.py` avec `ORION_VIVACITE=1.6 ORION_CONTRASTE=1.06`) : voiture et scooter restent
blancs, sacs et panier anthracite ; le kraft, l'or, le cuir et les aliments sont plus francs.
La teinte de la couleur choisie dans les fonds est posée sur du blanc pur et un peu plus
soutenue. Icônes au trait, sélections et tuiles translucides : inchangées. Un premier essai qui
changeait les couleurs (voiture à la couleur choisie, panier rouge, icônes colorées) a été écarté.

### Sécurité Google Cloud

Six services, un besoin chacun : voir `deploy/gcp/README.md`. Code serveur dans
`backend/src/modules/gcp/`, inactif sans réglage ; 14 tests avec Google simulé. Rien n'a été
exécuté sur un projet Google réel (aucun accès depuis l'atelier) : les scripts sont à lancer sur
un projet d'essai avant la production.

### APK 1.5.3 et vérifications

`ORION-client-1.5.3.apk` : version 1.5.3, code 10, 11,1 Mo, même signature que les précédentes,
SHA-256 `ee2760d68a99e85c572f97f5b42f5b58502ceeb9ea7f58abad1ce3d8162198c7`. Ses 167 fichiers web
sont identiques, un à un, au contenu sur lequel les parcours ont tourné.

| Parcours (navigateur automatisé, vraie clé Google) | Résultat |
|---|---|
| Services Google, mode clair | 9 étapes sur 9 |
| Services Google, mode sombre | 9 étapes sur 9 |
| Application en « Google seul », clair puis sombre | 7 sur 7, deux fois |
| Parcours complet d'une course et des services | 20 sur 20 |
| Parcours client | 9 sur 9 |
| Fluidité de la carte | 1 carte créée, 1 recentrage, 14 recadrages (inchangé depuis la 1.5.2) |

Aucune erreur JavaScript. Serveur : 412 tests réussis, 2 ignorés (SQLite). Rien n'est testé sur
un téléphone réel.

### APK 1.5.4 : plus aucune trace des autres pays

Contrôle du contenu de l'APK 1.5.3 : l'écran des pays n'affichait bien que la Côte d'Ivoire,
mais deux restes invisibles subsistaient. Le texte inutilisé « Expansion sous-régionale à venir »
(huit langues) est retiré ; la route publique `/countries` du serveur ne publie plus que les pays
actifs (les autres restent dans le catalogue, en réserve) ; le README ne promet plus d'autres pays.

`ORION-client-1.5.4.apk` : version 1.5.4, code 11, même signature, SHA-256
`3e54b6bb20c7bbb61d1e60dc95ae0f0d0f58804c0e5fb0073a20b44cb69e2e3a`, 167 fichiers web identiques au
contenu testé. Mêmes parcours que la 1.5.3, tous réussis : services Google 9 sur 9 (clair et
sombre), « Google seul » 7 sur 7 (clair et sombre), parcours complet 20 sur 20, parcours client
9 sur 9, fluidité inchangée, aucune erreur JavaScript.

Après cette construction, le client d'exemple de la console « Ambassade du Ghana » a été renommé
« Groupe Ébrié Holding » : l'ancien nom figure encore dans les fichiers de l'APK 1.5.4 (données
de démonstration de la console, non affichées dans l'application cliente). Les noms de lieux
d'Abidjan qui citent un pays (ambassades, restaurants) sont conservés : ce sont des destinations.

### APK 1.5.5 : supplément fixe de 300 F par course

À la demande du fondateur, chaque course coûte 300 F TTC de plus (un premier réglage à 700 F a
été ramené à 300 F le même jour, sans changer de numéro de version). Le supplément s'ajoute après
l'arrondi, sur les trois gammes ; les écarts entre gammes ne changent pas (Or = Argent + 700 F,
Diamant = Argent + 1 700 F) et les livraisons à moto ne sont pas concernées. C'est un réglage de
tarification (`rideFee`), modifiable dans la console (Tarification, « Supplément par course »),
recopié dans le calcul de l'application : le test de parité application/serveur reste exact et
`backend/tests/prix-trajet.test.ts` vérifie les 300 F sur chaque gamme.

Repère, 20,5 km au départ de Yopougon : Argent 4 000 F la nuit, 4 350 F en journée (Or 4 700 et
5 050 F, Diamant 5 700 et 6 050 F), contre 6 600 à 8 900 F sur la capture Yango fournie.
Limite connue : l'écran « Pourquoi ce prix » n'a pas de ligne pour ce supplément, il est compris
dans le sous-total.

`ORION-client-1.5.5.apk` (construction à 300 F) : version 1.5.5, code 12, même signature, SHA-256
`273c5c057c05933aa3b14da73eaa5f81bfc3327d6bdfe8e9b1147c300b7c5765`, 167 fichiers web identiques au
contenu construit. Le client d'exemple renommé de la console y est aussi : plus aucune mention
d'un autre pays hors des noms de lieux d'Abidjan.

Parcours rejoués sur cette construction, tous réussis : services Google 9 sur 9 (clair et sombre),
« Google seul » 7 sur 7 (clair et sombre), parcours complet 20 sur 20, parcours client 9 sur 9,
fluidité inchangée (1 carte, 1 recentrage, 14 recadrages), aucune erreur JavaScript. Le supplément
s'y lit sur le trajet d'essai de 5,4 km : 1 800 F en Argent, 2 500 F en Or, 3 500 F en Diamant
(1 500, 2 200 et 3 200 F auparavant). Vérification automatique du dépôt verte sur l'envoi.

### APK 1.5.6 : supplément retiré

Le supplément fixe par course (essayé à 700 F puis à 300 F dans la 1.5.5) est entièrement
retiré à la demande du fondateur : le code du serveur, de l'application et de la console revient
à l'état de la 1.5.4, sans réglage `rideFee`. Les prix sont de nouveau ceux du barème et des zones :
20,5 km au départ de Yopougon, Argent 3 700 F la nuit et 4 050 F en journée (Or 4 400 et 4 750 F,
Diamant 5 400 et 5 750 F). Le test de parité application/serveur reste exact.

`ORION-client-1.5.6.apk` : version 1.5.6, code 13, même signature, SHA-256
`f2066b569c0a742ee703b6ec6f7c4e1bab40c10e43e957a74cfdd22e338a8fa6`, 167 fichiers web identiques au
contenu construit, aucune trace du supplément.


## 20. Version 1.5.7 : accueil réagencé, confirmation sous le pouce, empreinte ou visage réels (21 novembre)

Quatre demandes du fondateur, livrées ensemble. La 1.5.6 reste la version de repli.

### Accueil

- **En-tête refait sur le modèle fourni** (capture d'une application de transport) : en haut à
  gauche le point de départ (« Localisation actuelle » quand le téléphone est localisé, le nom
  du lieu s'il a été choisi à la main, « Point de départ » sinon ; un appui ouvre le choix du
  départ), en haut à droite la « Boîte de réception » (messages du centre ORION, avec le nombre
  de non lus). Dessous, le nom « Orion » en grand, centré ; les trois traits du menu restent à
  droite de cette ligne, sinon le profil et les paramètres ne seraient plus accessibles.
  Puis la recherche : une pilule blanche « Où allez-vous ? » avec, à droite, « Plus tard ».
- **« Plus tard » programme réellement une course** : la destination se choisit comme d'habitude,
  l'écran de confirmation demande la date et l'heure (au moins 15 minutes plus tard, règle du
  serveur). La course est envoyée à la route `/reservations` du serveur quand il est joint
  (la console suit ce calendrier), et dans tous les cas gardée sur le téléphone : elle apparaît
  dans « Mes courses », d'où on peut l'annuler (`frontend/src/programmees.ts`). Avant, le bouton
  « Programmer » affichait « Course programmée » sans rien enregistrer et promettait un rappel
  qui n'existait pas ; ce texte est remplacé.
- **Food, Achat & Vente et Supermarché ne sont plus affichés.** Rien n'est retiré du serveur :
  le réglage `services` (`food`, `shop`, `market`) et les neuf objets en volume restent en place.
  Il reste deux grands services (Course, Livraison) et une rangée de quatre (Colis, Abonnement,
  Location Signature, Mariage). Un nom de service ne se coupe plus au milieu d'un mot sur un
  petit écran.

### Confirmer sans faire défiler

Sur l'écran de confirmation, le prix et le bouton « Confirmer la course » sont dans un pied
collé en bas de la feuille : le reste (arrêts, assurance, paiement, code promo, détail du prix)
défile au-dessus. Mesuré sur un écran de 360 × 700 : la feuille contient 824 px pour 617 px
visibles, et le bouton est à l'écran sans aucun défilement. Le composant `Sheet` accepte pour
cela un `pied` ; le total n'est plus écrit deux fois.

### Empreinte digitale ou visage

Avant cette version, l'interrupteur « Déverrouillage biométrique » était décoratif : il
s'activait partout et le « déverrouillage » réussissait toujours, même sans capteur. Il est
remplacé par une vraie liaison avec le téléphone (module natif
`@capgo/capacitor-native-biometric`, fenêtre système `BiometricPrompt` sur Android, Touch ID et
Face ID sur iOS) :

1. Paramètres, ou Menu › Sécurité & confidentialité : l'application demande au téléphone ce
   qu'il sait faire (empreinte, visage, les deux, rien d'enregistré, pas de capteur) et l'écrit.
2. L'interrupteur ouvre une demande d'autorisation qui dit ce qui sera fait et ce qu'ORION ne
   reçoit pas (ni l'empreinte ni le visage : seulement « reconnu » ou non). « Autoriser » ouvre
   la fenêtre du téléphone ; la liaison n'est enregistrée que si le téléphone répond « reconnu ».
3. « Tester maintenant » redemande le capteur et affiche sa réponse avec l'heure à la seconde :
   reconnu, non reconnu, annulé, capteur bloqué après trop d'essais.
4. Une fois liée, l'empreinte ou le visage est demandé à chaque ouverture de l'application.
   Après un échec, le code du téléphone est proposé ; si le téléphone n'a plus ni capteur
   utilisable ni code, la liaison est levée plutôt que d'enfermer la personne dehors.

Côté Android, `USE_BIOMETRIC` est une permission « normale », accordée à l'installation : il n'y
a pas de fenêtre système d'autorisation, l'accord se donne dans l'application puis sur le
capteur. Côté iOS, le texte `NSFaceIDUsageDescription` est ajouté. Dans un navigateur (page de
démonstration), la liaison est annoncée comme indisponible : rien n'est simulé.

Limites à connaître : sur beaucoup de téléphones Android, le déverrouillage par le visage est
classé « confort » par le constructeur et n'est pas ouvert aux applications ; seule l'empreinte
est alors proposée. La liaison protège l'ouverture de l'application sur ce téléphone, elle
n'est pas encore une preuve d'identité envoyée au serveur. Aucun essai n'a pu être fait ici sur
un vrai capteur : le module, la permission et l'écran sont vérifiés dans l'APK, la
reconnaissance elle-même se constate sur le téléphone.

### APK 1.5.7 et vérifications

`ORION-client-1.5.7.apk` : version 1.5.7, code 14, même signature, SHA-256
`669257ce046dec24b694afb21a87f098d28a71de49f2232c3b3c5ae19938cc72`, 14,1 Mo (le module
d'empreinte et ses bibliothèques Android en ajoutent 3). 168 fichiers web identiques au contenu
construit ; les classes `ee.forgr.biometric.*`, l'activité `AuthActivity` et les permissions
`USE_BIOMETRIC` et `USE_FINGERPRINT` (Android 9 et antérieurs) sont dans l'APK. 847 textes
couverts dans les huit langues (40 nouveaux).

Parcours rejoués sur le contenu de cette APK, tous réussis et sans erreur JavaScript : services
Google 9 sur 9 (clair et sombre), « Google seul » 7 sur 7 (clair et sombre), parcours complet
20 sur 20, parcours client 9 sur 9, fluidité inchangée (1 carte, 1 recentrage, 14 recadrages).
Le contrôle « Service à venir : Me prévenir » est remplacé par celui du nouvel accueil : six
services, plus aucun « Bientôt », « Localisation actuelle », « Boîte de réception », « Plus tard ».
Essai de « Plus tard » : course programmée, enregistrée, relue puis annulable dans « Mes courses ».

## 21. Version 1.5.7, mise à jour : barre du bas, volets Services et Compte, dossier médical protégé (22 novembre)

Mise à jour livrée sans changer de numéro (1.5.7, code 14), à la demande du fondateur, sur la
base de quatre captures d'une application de transport : cartes du compte, liste de réglages,
barre de navigation du bas, pastilles rondes.

### Navigation

- **Barre du bas** : Accueil, Services, Activité, Compte. Une pilule flottante, présente sur
  ces quatre écrans seulement. Les trois traits de l'accueil disparaissent : le compte est un
  volet.
- **Services** : les huit services ouverts, sur des pastilles rondes avec les objets en volume
  — Course, Réserver, Livraison, Colis, Abonnement, Location Signature, Mariage, ORION
  Assurance. Trois objets ont été modélisés pour cela (`rendre.py`) : calendrier (`reserver`),
  bouclier à croix (`protection`), boîte cadeau (`cadeau`).
- **Activité** : les courses, avec les courses programmées en tête.
- **Accueil** : les quatre petites tuiles deviennent des pastilles rondes à fond neutre, de la
  même largeur qu'avant (86 px sur un écran de 412).

### Compte

Deux cartes, puis des groupes de lignes. Chaque entrée de la capture a son écran et fonctionne :

| Entrée | Ce qu'elle fait |
|---|---|
| Contrôle de sécurité | Anneau n/4 calculé sur quatre protections réelles : contact de confiance, partage automatique des trajets, verrou par empreinte, ORION Assurance. Chaque ligne mène au réglage ou l'active. |
| Invitez vos amis · Parrainez des amis | Code personnel stable (`ORION-XXXXXX`), copie, partage par la feuille du téléphone, saisie du code d'un ami (format contrôlé, son propre code refusé). |
| Famille | Proches enregistrés (adolescent, adulte, senior). « Commander pour… » ouvre la recherche ; à la confirmation on choisit le passager ; pendant la course, un bouton prépare le SMS au proche avec le chauffeur, le véhicule, la plaque et le code de prise en charge. |
| Mode simplifié | Accueil allégé : une seule question, les lieux enregistrés en gros boutons, l'aide. S'active et se quitte d'un geste. |
| Contacts | Carnet de contacts avec appel et SMS ; un contact de confiance, repris par le partage automatique et le contrôle de sécurité. |
| Groupes enregistrés | Groupes de contacts ; « Écrire au groupe » ouvre les SMS avec tous les destinataires. |
| Gagnez des revenus | Candidature chauffeur ou livreur, envoyée au support ORION. |
| Tableau de bord ORION Business | Profil professionnel ; à la confirmation, « Course professionnelle » et motif (obligatoire si le profil le demande) ; relevé du mois, liste, export. |
| ORION Business | Demande d'ouverture d'un compte entreprise, envoyée au support. |
| Gérer le compte, Informations | Écrans existants (profil, mentions légales). |

Les données de ces écrans restent sur le téléphone (`frontend/src/compte.ts`).

### Dossier médical protégé

Le dossier ORION Assurance ne s'ouvre plus dans l'application sans preuve : l'empreinte ou le
visage du téléphone, ou un **code secret de 4 à 8 chiffres que le client choisit** s'il ne veut
pas lier son empreinte (`frontend/src/coffre.ts`). Le choix est demandé dès le premier
enregistrement, et avant toute ouverture d'un dossier créé avec une version précédente.

- Le code n'est jamais gardé : seule son empreinte calculée (PBKDF2-SHA-256, 150 000 tours, sel
  aléatoire) reste sur le téléphone. Les codes évidents (0000, 1234, 4321…) sont refusés.
- Cinq codes faux suspendent la saisie 30 secondes, puis le double à chaque nouvelle erreur.
- Un code oublié ne se retrouve pas : on supprime le dossier et on le recrée.
- Ce verrou protège la lecture et la modification dans l'application. Il ne chiffre pas le
  dossier : en cas d'alerte, le SAMU d'ORION doit pouvoir le lire sans que le client ait à
  saisir quoi que ce soit.

### Questionnaire santé enrichi

Cinq étapes au lieu de trois. S'ajoutent, tous facultatifs : poids et taille, quatre antécédents
(AVC, maladie respiratoire chronique, cancer en traitement, maladie du foie), insuline si
diabète, mois de grossesse, sept allergies connues à cocher, hospitalisation ou opération
récente, prothèse ou implant, difficultés de communication (malentendant, malvoyant, parole,
langue), langues parlées, hôpital de préférence, consignes pour les secours, seconde personne à
prévenir, mutuelle. Le serveur valide les mêmes champs (`backend/src/modules/assurance/dossier.ts`)
et la console les montre à l'agent SAMU. Les dossiers déjà enregistrés restent valides.

### Vitrine des véhicules (Mariage, Location Signature)

Chaque écran montre « Votre véhicule » : les photos et vidéos réelles du véhicule choisi, selon
les options (décoration, durée, cortège, formule). La vitrine se met à jour dès qu'une option
change. Aucune image n'est livrée aujourd'hui : elle montre alors le modèle en volume et le dit.
Pour en ajouter plus tard, sans toucher au code : déclarer les fichiers dans
`frontend/public/medias/vehicules.json` (guide : `LISEZ-MOI.md` du même dossier), ou les envoyer
au serveur (`PUT /admin/medias/vehicules`, lu par l'application à `GET /rental/medias-vehicules`).
Les adresses sont contrôlées : `https://…` ou `medias/…` uniquement.

### Limites à connaître

- Le parrainage enregistre et partage les codes, mais **aucune réduction n'est créditée** : le
  serveur n'a pas encore de programme de parrainage. L'écran le dit. Les montants affichés
  (1 000 F sur 3 courses) sont une valeur par défaut à confirmer (`OFFRE_PARRAINAGE`).
- Sans serveur, les demandes « chauffeur » et « entreprise » restent sur le téléphone ; l'écran
  le dit.
- Le relevé professionnel est local ; la facture mensuelle d'entreprise relève du module B2B du
  serveur, non relié à l'application.
- Le SMS au proche et le SMS de groupe ouvrent l'application de messages du téléphone, texte
  prêt : c'est le client qui l'envoie.
- Comme pour l'application, l'ouverture du dossier par l'empreinte ne se constate que sur un
  téléphone ; dans un navigateur, seul le code secret est proposé.

### APK et vérifications

`ORION-client-1.5.7.apk` (mise à jour) : version 1.5.7, code 14, même signature, SHA-256
`f19cac461f02fe8efde1c58199e37ac575c78a94f824400c9c8f229c94b0e91a`, 14,3 Mo, 176 fichiers web
identiques au contenu construit. 1 055 textes couverts dans les huit langues (137 nouveaux ; les
textes médicaux, en français et en anglais comme avant).

Sur le contenu de cette APK, sans erreur JavaScript : services Google 9 sur 9 (clair et sombre),
« Google seul » 7 sur 7 (clair et sombre), parcours client 9 sur 9, parcours complet 20 sur 20
(assurance en cinq étapes puis code secret), fluidité inchangée. Deux séries nouvelles, en clair
et en sombre : 13 contrôles du compte (barre du bas, Services, contacts, groupes, famille,
parrainage, Business, demandes, commande pour un proche avec course professionnelle et SMS) et
7 contrôles de l'assurance, des vitrines et du mode simplifié (champs enrichis relus, 1234
refusé, pause après cinq erreurs, code absent du stockage en clair, vitrine vide puis alimentée
selon l'option). Serveur : 415 tests réussis, dont le questionnaire enrichi et la vitrine.

## 22. Version 1.5.8 : écarts de prix entre gammes resserrés, volets qui gardent leur position (22 novembre)

### Prix

Le fondateur trouvait les gammes Or et Diamant trop chères face à la concurrence. L'écart fixe
(Or = Argent + 700 F, Diamant = Or + 1 000 F) est remplacé par un écart borné :

| | Trajet court | Trajet long |
|---|---|---|
| Argent → Or | + 100 F | + 200 F |
| Or → Diamant | + 500 F | + 1 000 F |

Le prix de l'Argent ne change pas. L'écart part du minimum jusqu'à 2 km, atteint le maximum à
partir de 20 km et monte entre les deux avec la distance, par pas de 50 F comme tous les prix
(`supplementGamme`, `backend/src/modules/services/ride/pricing.ts`). En pratique : Or + 100 F
jusqu'à 6,5 km, + 150 F jusqu'à 15,5 km, + 200 F au-delà ; Diamant + 500 F de plus que l'Or sous
3 km, puis 50 F de plus tous les 1,8 km environ, jusqu'à + 1 000 F. L'écart ne dépend ni de la
carrosserie ni de l'assurance.

Relevé dans l'application 1.5.8 (berline, en journée, Argent / Or / Diamant) :

| Destination | Distance | Prix | Écarts |
|---|---|---|---|
| Cocody Danga | 1,7 km | 850 / 950 / 1 450 F | + 100, + 500 |
| Plateau | 3,9 km | 1 300 / 1 400 / 1 950 F | + 100, + 550 |
| Riviera Golf | 5,4 km | 1 500 / 1 600 / 2 200 F | + 100, + 600 |
| Aéroport | 16,6 km | 3 700 / 3 900 / 4 800 F | + 200, + 900 |
| Grand-Bassam | 37,7 km | 7 850 / 8 050 / 9 050 F | + 200, + 1 000 |

Les quatre bornes et les deux distances se règlent dans la console (Tarification, « Gammes —
écart de prix avec la gamme précédente »). Un tarif enregistré avec l'ancien supplément fixe est
repris au démarrage avec les nouveaux écarts, les autres réglages étant gardés. L'application
garde sa copie du barème (`frontend/src/tarifServeur.ts`) ; le test qui compare les deux calculs
au franc près passe toujours.

### Volets qui gardent leur position

Défaut constaté par le fondateur : dans le volet Compte, ouvrir une option puis en sortir
ramenait en haut de la page. Chaque écran est reconstruit quand on y revient ; rien ne retenait
où il était arrêté. L'application note maintenant la position de chaque page et la replace au
retour, sans animation (`frontend/src/App.tsx`) :

- en sortant d'une option, on retrouve le volet exactement où on l'avait laissé ;
- les quatre volets de la barre du bas gardent leur position d'un passage à l'autre ;
- toucher le volet déjà ouvert ramène en haut de sa page ;
- une option que l'on rouvre repart du haut.

### APK et vérifications

`ORION-client-1.5.8.apk` : version 1.5.8, code 15, même signature, SHA-256
`b241a35054eccfbe9863327fdddd5aec4b11f3b5c0563b1b2c24c7bd4a335b63`, 14,2 Mo, contenu web
identique au contenu construit.

Sur le contenu de cette APK, en clair et en sombre, sans erreur JavaScript : 11 contrôles sur 11
— prix des trois gammes vers cinq destinations en berline et en SUV (écarts dans les bornes,
croissants avec la distance), position retrouvée au retour de treize options du volet Compte
(jusqu'à 1 500 px de défilement), option rouverte en haut, volets de la barre du bas. Serveur :
419 tests, 417 réussis, 2 ignorés, dont les écarts bornés sur 80 distances, leur réglage depuis
la console et la reprise d'un ancien tarif.

## 23. Version 1.5.9 : plus de supplément fixe, une majoration en pour cent par gamme (22 novembre)

Les écarts resserrés de la 1.5.8 laissaient encore les gammes Or et Diamant trop chères aux yeux
du fondateur, surtout sur les petites courses. Deux essais dans la même journée :

1. suppléments entièrement retirés, les trois gammes au même prix — construit, non livré : le
   fondateur a précisé que les gammes doivent garder des prix différents ;
2. **retenu, choisi par le fondateur parmi trois propositions chiffrées** : une majoration
   légère en pour cent du prix de la course, le prix de l'Argent restant inchangé.

| Gamme | Prix |
|---|---|
| Argent | prix de référence, inchangé |
| Or | Argent + 5 % |
| Diamant | Argent + 15 % |

La majoration est calculée sur le prix Argent déjà arrondi, puis arrondie à 50 F
(`supplementGamme`, `backend/src/modules/services/ride/pricing.ts`). Elle suit donc tout ce qui
fait le prix : zone, forfait, trafic, carrosserie, assurance, remise. Deux gammes ne tombent
jamais au même prix : chacune coûte au moins 50 F de plus que la précédente, même sur la plus
petite course. Une course gratuite (code promo) reste gratuite dans les trois gammes.

Relevé dans l'application 1.5.9 (berline, en journée, Argent / Or / Diamant) :

| Destination | Distance | Prix | Écarts avec l'Argent |
|---|---|---|---|
| Cocody Danga | 1,8 km | 850 / 900 / 1 000 F | + 50, + 150 |
| Plateau | 3,9 km | 1 300 / 1 350 / 1 500 F | + 50, + 200 |
| Riviera Golf | 5,4 km | 1 500 / 1 600 / 1 750 F | + 100, + 250 |
| Aéroport | 16,6 km | 3 700 / 3 900 / 4 250 F | + 200, + 550 |
| Grand-Bassam | 37,7 km | 7 850 / 8 250 / 9 050 F | + 400, + 1 200 |

Par rapport à la 1.5.8, le Diamant baisse sur tous ces trajets sauf le plus long, où il revient
au même prix (9 050 F) ; l'Or baisse sur les petites courses, ne change pas sur les trajets
moyens et monte de 200 F sur le très long trajet (8 250 F contre 8 050 F).

Les deux pourcentages se règlent dans la console (Tarification, « Gammes — majoration par rapport
à l'Argent »). Les réglages `ecarts` et `ecartKm` de la 1.5.8 n'existent plus ; un tarif
enregistré avec l'ancien supplément fixe ou avec ces écarts est repris au démarrage sans eux,
avec les pourcentages par défaut, le reste des réglages étant gardé. La copie du barème dans
l'application (`frontend/src/tarifServeur.ts`) suit, et le test qui compare les deux calculs au
franc près passe toujours.

Limite : aucun tarif du concurrent n'a été relevé pour ce réglage ; les prix n'ont pas été
comparés aux siens, gamme par gamme. Le seul repère reste la capture fournie plus tôt (20,5 km au
départ de Yopougon : 6 600 à 8 900 F chez le concurrent, 3 700 à 4 050 F en Argent chez ORION).

`ORION-client-1.5.9.apk` : version 1.5.9, code 16, même signature, SHA-256
`68103549bf2722f0ccc34f79d4b10dd2acdb8d5d32a520f288918b422b2c8a15`, 14,5 Mo, contenu web
identique au contenu construit. Sur ce contenu, en clair et en sombre, sans erreur JavaScript :
11 contrôles sur 11 (prix des trois gammes vers cinq destinations en berline et en SUV, prix
Argent inchangé, position gardée dans les volets). Serveur : 418 tests, 416 réussis, 2 ignorés,
dont la majoration sur 80 distances, son réglage depuis la console et la reprise des anciens
tarifs.
Parcours rejoués sur ce contenu, tous réussis : parcours client 9 sur 9, volets et compte 13 sur
13, parcours complet 20 sur 20.

## 24. APK de test « temps réel » : app client à part et mini console chauffeur (22 novembre)

Deux APK de test, installées à côté de l'app officielle sans la remplacer, pour comparer les prix
d'ORION à ceux de la concurrence dans des conditions réelles. Rien de ce qui suit ne touche l'app
officielle 1.5.9 tant que le fondateur ne l'a pas validé.

- **ORION Test** (`ci.orion.test.client`, 1.5.9-test) : toute l'app client 1.5.9, construite avec
  `VITE_TEMPS_REEL=1` (`frontend/src/tempsReel.ts`). Trois différences, affichées au client :
  1. le trafic du prix est le trafic réel de Google sur ce trajet au moment de la commande
     (durée avec circulation comparée à la durée sans circulation : à partir de 1,15 dense ×1,15,
     à partir de 1,5 embouteillage ×1,35) ;
  2. le temps facturé est le temps prévu avec la circulation ;
  3. l'approche du chauffeur compte : distance et temps par la route, trafic compris, depuis la
     position du chauffeur de test le plus proche ; 2 km et 5 min offerts, puis 100 F par km et
     18 F par minute (hors taxes).
  La carte Google affiche la couche du trafic en direct. Le prix reste fixe une fois commandé.
- **ORION Console test** (`ci.orion.test.console`) : une mini console qui joue le chauffeur, avec la
  même carte Google et le trafic en direct. Elle voit la position du client, place le chauffeur à
  la distance choisie (curseur de 0,3 à 20 km et direction), reçoit les courses commandées dans
  ORION Test, les accepte ou les refuse, roule vers le client sur la route de Google à la vitesse
  du trafic (×1, ×5 ou ×20), vérifie le code, fait la course et reçoit le paiement.

Les deux partagent le registre de test du téléphone (fournisseur `ci.orion.test.client.bustest`,
permission « signature ») : elles doivent être installées sur le même téléphone. La construction :
`frontend/scripts/construire-apk-test.sh` (clé Google prise dans l'environnement, jamais écrite
dans le dépôt).

Vérification dans un navigateur, sur le contenu des deux APK, avec Google en direct : 9 contrôles
sur 9, sans erreur JavaScript. Exemple relevé de nuit vers Riviera Golf (5,4 km) : chauffeur à
7,2 km par la route (10 min) → 2 100 / 2 200 / 2 400 F ; chauffeur ramené à 1,4 km (4 min) →
1 400 / 1 450 / 1 600 F, recalculé en direct chez le client. Course commandée, acceptée par la
console, voiture qui avance chez le client, code vérifié, course terminée et payée.

Limites : le passage d'une app à l'autre n'a pas été essayé sur un vrai téléphone (pas d'émulateur
ici) ; la durée « sans circulation » de Google est parfois plus longue que la durée réelle la nuit,
le trafic est alors compté fluide.

## 25. App chauffeur 1.5.9 alignée sur l'app client, reliée sur le même téléphone (22 novembre)

L'app chauffeur reprend les apports de l'app client 1.5.9 : carte Google, objets en volume,
barre du bas en pilule, raccourcis ronds, couleur au choix (vert, orange, bleu), mode clair et
sombre, verrouillage par empreinte ou visage, position gardée dans chaque onglet, langues avec
drapeaux. Les nouvelles phrases sont traduites dans les 8 langues. Sur l'écran large de la
voiture (et HarmonyOS, qui charge la même page), les raccourcis gardent une taille fixe.

Versions : Android client et chauffeur 1.5.9, code 17 ; HarmonyOS 1.5.9, code 17 ; iOS client et
chauffeur 1.5.9, build 17, avec le texte d'autorisation Face ID dans les deux apps et les modules
natifs (partage, empreinte) ajoutés au projet iOS du chauffeur.

`ORION-client-1.5.9.apk` (code 17, SHA-256
`f5a031abb1adb63f685e833c3636100c680c5d5c8863e6fca29393d160dbacd2`) et
`ORION-chauffeur-1.5.9.apk` (`ci.orion.chauffeur`, code 17, SHA-256
`11bfb3babddff2575b510fbcf7cf86ee4eb6d4cc9c3430ee56831e8c83089747`), même signature. Installées
sur le même téléphone, une course commandée dans l'app client arrive dans l'app chauffeur
(registre `ci.orion.app.bustest`, section 21 et suivantes). Contrôle croisé sur le contenu de ces
APK, dans un navigateur : parcours complet 10 sur 10 (offre, acceptation, arrivée, mauvais code
refusé, course, paiement, note), refus, annulation et chauffeur hors ligne 5 sur 5, sans erreur
JavaScript. Le passage d'une app à l'autre n'a pas été essayé sur un vrai téléphone.

iPhone : deux apps ne peuvent pas partager ce registre sans groupe d'apps signé ; la liaison
client ↔ chauffeur reste réservée à Android en attendant le serveur en ligne.

### Console et tableau de bord : icônes au trait, comme les paramètres de l'app client

Le menu de la console, le titre de chaque session et les tuiles de chiffres prennent le style des
paramètres de l'app client : une icône au trait fin, de la couleur du texte, sur une bulle ronde
neutre et translucide. Même chose pour les tuiles et le fil d'activité du tableau de bord. Les
objets en volume restent là où ils montrent une chose (numéros de secours, packs de location),
comme dans l'app client. Vérifié en clair et en sombre, sur ordinateur et sur téléphone, sans
erreur JavaScript.

## 26. Vidéo iPhone commentée, app chauffeur au visuel actuel de l'app client (22 novembre)

**Vidéo.** Une course complète, filmée en temps réel dans l'app client 1.5.9 au format iPhone
(402 × 874 points, barre d'état et Dynamic Island, identité Safari iOS), avec la carte Google en
direct et une narration en voix d'homme : accueil, recherche de Riviera Golf, trois gammes, écran
de confirmation, « Pourquoi ce prix », commande, chauffeur qui accepte depuis l'app ORION
Chauffeur (registre de test partagé), approche par la route, code de prise en charge, contrôle de
sécurité en course, paiement Orange Money, note de cinq étoiles. Le moteur filmé est Chromium au
format et à l'identité de l'iPhone : ni Mac ni simulateur iOS n'est disponible ici. Le contenu
affiché est celui que l'app iPhone embarque.

Le tournage a fait apparaître trois défauts, corrigés :
- la carte de l'écran de confirmation montrait tout le pays (marges de cadrage fixes plus hautes
  que la bande de carte visible) : les marges suivent maintenant la taille de la carte ;
- si l'app chauffeur passait en ligne avant que l'app client soit ouverte, une offre simulée la
  rendait occupée puis la mettait en pause, et la commande voyait « aucun chauffeur en ligne » :
  l'offre simulée est retirée dès que l'app client est reliée, sans pénalité ;
- l'icône de l'app iPhone était encore l'ancienne feuille plate : elle est remplacée par la
  feuille en volume, comme sur Android.

**App chauffeur.** Elle reprend le visuel de l'app client d'aujourd'hui (et non celui de la
version 1.2) :
- objets de l'accueil dans la palette « vif » de l'app client, avec des matières naturelles.
  Quatre objets ont été rendus pour l'occasion : mallette et portefeuille en cuir, batterie blanc
  cassé à éclair vert, bouton SOS rouge sur socle blanc à bague d'acier (`scripts/rendus-3d`,
  `public/rendus/urbain` et `vif`) ;
- icônes au trait partout ailleurs ;
- en-têtes sans carte : grand titre posé sur le fond, lueur de la couleur choisie en haut, logo
  ORION sur l'accueil seulement ;
- cartes et chiffres sur la surface teintée ;
- onglets et objectifs en puces ;
- solde sans aplat vert, avatar clair, bouton principal à l'encre de l'app client.

Clair, sombre et écran de voiture vérifiés, sans erreur JavaScript. Test croisé client ↔
chauffeur : 10 sur 10, puis 5 sur 5 pour le refus, l'annulation et le chauffeur hors ligne.

APK (code 18, version 1.5.9, même signature), SHA-256 :
- `ORION-chauffeur-1.5.9.apk` : `19adf61b3407311b82d3013b11c9d2612151172802f0aa470a3e9d05c43e195b`
- `ORION-client-1.5.9.apk` : `ee8a108500e77ec9b54cb2add77bc02c9af77e7414a39b7051a6b5fab4b6d4ad`

Codes HarmonyOS et iOS portés à 18.

## 27. Version 1.6.0 : huit palettes, péage au choix, chauffeur à l'heure, feux tricolores, chauffeurs salariés (22 novembre)

**Apparence (apps client et chauffeur).** Huit palettes au choix, sur deux rangées de quatre :
vert, orange, bleu, blanc, jaune, marron, violet et rose (la huitième, non nommée dans la
demande, est le rose ; elle se change en une ligne dans `src/theme.tsx`). La palette « Blanc »
garde les thèmes clair et sombre purs : aucune teinte dans les fonds. Le thème se choisit sur
trois vignettes (Clair, Sombre, Système) qui montrent l'écran tel qu'il sera.

**Tarifs (serveur, apps, console).**
- ORION Assurance : 4 % de la course (2 % auparavant ; un réglage enregistré à 2 % passe à 4 %
  au démarrage du serveur).
- Écart entre gammes : Or +5 % et Diamant +15 % dans le district d'Abidjan ; dès que le départ,
  un arrêt ou l'arrivée est hors du district (contour officiel OCHA / CNTIG, HDX), Or +10 % et
  Diamant +20 %. Les deux grilles se règlent dans la console (Tarification).
- Pont à péage ou voie normale : quand le trajet peut passer par un péage, l'app propose les deux
  itinéraires (durée avec le trafic, distance, montant du péage). Le prix de chaque gamme suit
  l'itinéraire choisi : sa distance par la route, plus le péage, qui n'est pas majoré par la
  gamme. Itinéraires : Google (variantes et route qui évite les péages), sinon OSRM ; à défaut
  de voie normale proposée, le contournement connu du péage (pont Général-de-Gaulle pour le
  pont Henri-Konan-Bédié, Adjamé pour le 4ᵉ pont, ancienne route pour Bassam). Postes : HKB,
  4ᵉ pont, Grand-Bassam, Attinguié, Thomasset, 500 F chacun par défaut (montants réglables dans
  la console). Le péage revient en entier au chauffeur, sans commission.

**Mise à disposition à l'heure.** Retirée de la Location Signature (catalogue et réservations
du serveur ; les réservations déjà faites restent lisibles), elle devient une course VTC : petite
icône sablier dans la barre de recherche (« Plus tard » réduit pour lui faire place). Le client
choisit le lieu de prise en charge, le début (maintenant ou à une heure précise), la durée
(2 à 12 h) et la gamme. Prix = heures × tarif horaire de l'Argent (5 000 F TTC par défaut,
réglable), puis la majoration de la gamme. Abidjan seulement (refus du serveur hors district).

**Cartes.** Les 623 feux tricolores du district (regroupés en 301 carrefours, Overture Maps /
OpenStreetMap) et les postes de péage apparaissent sur la carte Google de l'app cliente, la
carte de l'app chauffeur, la console et le tableau de bord (feux à partir du zoom 14). Position
précise : le GPS est écouté quelques secondes et le point le plus précis est retenu (arrêt à
20 m) ; côté chauffeur, un point imprécis n'écrase plus un point GPS récent.

**Chauffeur, console, console de test.** L'offre et la course montrent l'itinéraire choisi
(pont à péage ou voie normale) et la durée d'une mise à disposition ; le guidage respecte le
choix du client (contournement ou passage par le poste) ; la console affiche les deux dans la
liste des courses.

**Chauffeurs salariés.** Les chauffeurs ORION sont embauchés et payés au mois, sur les véhicules
d'ORION. L'inscription ne demande plus de gamme ; le profil ne demande que les informations
personnelles (nom, téléphone, date de naissance, permis) ; véhicule, gamme, immatriculation et
matricule sont attribués par ORION et affichés en lecture seule ; la batterie est relevée par
le véhicule. Le dossier n'exige plus aucune pièce du véhicule côté serveur.

Tests : 428 (426 réussis, 2 ignorés), dont la parité de prix app / serveur pour le péage, la
course hors d'Abidjan et la mise à disposition, l'itinéraire choisi de bout en bout (devis,
course, console, paiement du chauffeur) et la location sans mise à disposition. Test croisé
client ↔ chauffeur ↔ console ↔ tableau de bord : 10 sur 10.

Versions : 1.6.0, code 19 (Android client et chauffeur, iOS, HarmonyOS) ; APK de test code 2.

APK (même signature, certificat `de10eef9…bf7dc`), SHA-256 :
- `ORION-client-1.6.0.apk` (code 19) : `9b61bb0d6edf43e8c17c72a5b2dc38b0a13267bfbd7a49ff3afad0ebebdc3e4f`
- `ORION-chauffeur-1.6.0.apk` (code 19) : `45e4b092e4e51ff75f4b501c368e6ef6fe2fcddea523712a85b4740cec5f70f4`
- `ORION-test-client-1.6.0.apk` (code 2) : `8ec3218b5320b5cc1b9fc491a756587f0e02c0550d7495cd006159a921d2f7eb`
- `ORION-console-test-1.6.0.apk` (code 2) : `d8339ef432e72fbb7aa31bc77d4cf18fa96b625b4af61904d278e3cdcd2cf2cc`

## 28. Version 1.6.1 : le choix pont à péage / voie normale avec la carte Google (22 novembre)

Constat sur l'APK 1.6.0 : le péage était reconnu (« Péage compris : Pont Henri Konan Bédié »),
mais le client ne pouvait pas choisir la voie normale. Reproduit avec la vraie clé Google, l'app
servie comme dans l'APK : Google ne sait pas que les ponts d'Abidjan sont payants ; ses variantes
et sa route « sans péage » passent toutes par le pont HKB, et le point de contournement retenu
(au milieu du pont Général-de-Gaulle) le ramenait lui aussi sur HKB.

Correction : chaque péage a plusieurs points de contournement, vérifiés sur les routes de Google
dans les deux sens (aucun poste sur le trajet obtenu) — HKB : Plateau ; 4ᵉ pont : Adjamé ;
Grand-Bassam : ancienne route par Modeste. Ils sont essayés en même temps ; la voie normale la
plus rapide est retenue, sauf détour de plus de moitié plus long (le prix suit la distance). À
défaut, les variantes du calcul ORION sont essayées. Même règle sur le serveur (tracé de la
course) et dans le guidage du chauffeur.

Vérifié avec la clé Google : Cocody → Zone 4, pont HKB 17 min (Argent 2 450 F, péage compris)
ou voie normale par le Plateau 34 min (2 950 F) ; Yopougon → Plateau, 4ᵉ pont 18 min (2 550 F)
ou voie normale 21 min (2 600 F). Le tracé et les prix changent avec le choix ; les feux
tricolores apparaissent sur la carte Google aux carrefours (zoom 14 et plus) et le poste de
péage choisi est mis en avant (« Péage · 500 F »).

APK 1.6.1 (code 20 ; APK de test code 3), même signature, SHA-256 :
- `ORION-client-1.6.1.apk` : `8052ec6b5e29416de50ed21d9df83c31113648ed47019f2a0a002d52e8711e02`
- `ORION-chauffeur-1.6.1.apk` : `c5a4966de66112c59cda631d2c6cc78db84fc9a00cb803e7cfac89e80bb15ecb`
- `ORION-test-client-1.6.1.apk` : `c1d67724921952e5d94b50c7cdfa0e9e5721431467ed0b1a19ff192331a412fb`
- `ORION-console-test-1.6.1.apk` : `83b9ff08692deedc867eee61fe189cd3f8aa7519e5a368d39229beb7206b70e8`
