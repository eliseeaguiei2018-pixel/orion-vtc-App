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
