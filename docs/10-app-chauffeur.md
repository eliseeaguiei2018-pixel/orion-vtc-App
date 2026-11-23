# 🚗 ORION — Application Chauffeur

> Troisième interface d'ORION, à côté de l'app Client (`index.html`) et de la console
> Admin (`admin.html`). Elle est **synchronisée en temps réel** avec le backend et la
> console : chaque décision prise en console se reflète immédiatement dans l'app.

---

## 1. Ouvrir l'app

| Contexte | Adresse |
|---|---|
| Développement (Vite) | `http://localhost:5173/driver.html` |
| Build / préversion | `dist/driver.html` |
| Vercel (sous-domaine) | `chauffeur.orion.ci` → `driver.html` (voir `frontend/vercel.json`) |
| GitHub Pages | `…/orion-vtc-App/driver.html` (mode démo) |

- **Avec backend** (`VITE_API_URL` défini) : vraies données, vraie console.
  Hors production, le code SMS de connexion s'affiche à l'écran (« code de test »).
- **Sans backend** : **mode démo** complet (offres, console et clients simulés).
  Code de connexion : `123456`. Le dossier envoyé est validé automatiquement après quelques secondes.

## 2. Fonctionnalités

| Onglet | Contenu |
|---|---|
| **Connexion** | Téléphone + code SMS. Nouveau numéro = inscription (nom + gamme). |
| **Accueil** | En ligne / Hors ligne / Pause · GPS réel (ou simulé) · secteur (bonus, gamme minimale, cantonnement) · position en file d'attente · gains du jour · zones à forte demande · règles console en vigueur · SOS. |
| **Offre** | Compte à rebours = délai réglé en console · gain net estimé · moyen de paiement annoncé · distance d'approche · refus avec motif. |
| **Course** | En route → arrivé → client à bord → terminée · Google Maps / Waze · appel client · attente facturée · SOS · annulation · encaissement espèces ou attente du paiement mobile money · récapitulatif des gains. |
| **Courses** | Historique filtrable, gain net, note client, espèces encaissées. |
| **Gains** | Solde · commission appliquée (verte vs thermique) · dette espèces vs plafond · objectif du jour · 7 jours · retrait mobile money · mouvements du portefeuille. |
| **Éco** | Batterie (SoC / SoH) transmise au dispatch · autonomie · heures creuses · fidélité électrique · CO₂ évité · formation éco-conduite (vidéo + QCM). |
| **Profil** | Dossier (KYC) : identité, véhicule, assurance, conformité verte, NIF · envoi à ORION · suivi de validation en direct · qualité · thème · déconnexion. |

## 3. Synchronisation avec la console

Même modèle que l'app Client, complété par un canal personnel :

| Moment | Source | Effet dans l'app |
|---|---|---|
| Démarrage | `GET /config` (= app Client) | Ville, ouverture ORION, services, passerelles |
| Démarrage | `GET /drivers/config` | Délai d'offre, commissions, plafond dette, heures creuses, attente, zones |
| Démarrage | `GET /drivers/me`, `/drivers/:id/active-ride` | Fiche, finances, mission en cours |
| En continu | WS `/ws/config` (= app Client) | `config.update` : maintenance, service coupé, passerelles |
| En continu | WS `/ws/drivers/:id?token=…` | voir tableau ci-dessous |
| Retour au premier plan | HTTP | Resynchronisation complète |

Trames du canal chauffeur `/ws/drivers/:id` :

| Trame | Déclencheur | Affichage |
|---|---|---|
| `connected` | Connexion / reconnexion | État complet (fiche, config, config flotte, finances, mission) |
| `driver.update` | Toute écriture de la fiche (KYC, suspension motivée, avertissement, VIP, fidélité, cantonnement, disponibilité) | Bandeaux et statut mis à jour |
| `driver-config.update` | Console : dispatch, commissions, plafond, heures creuses, tarifs d'attente, zones | Règles et calculs mis à jour |
| `config.update` | Console : maintenance, services, passerelles | Bandeaux, bouton « En ligne », moyens d'encaissement |
| `ride.assigned` | Course attribuée (avec `offer` si le chauffeur utilise l'app) | Écran d'offre |
| `ride.withdrawn` | Refus, délai dépassé, réassignation console | Offre retirée |
| `ride.status`, `ride.reassigned`, … | Room de la course en cours (relayée) | Annulation client, clôture console |
| `payment.received` | Paiement du client | Récapitulatif des gains |
| `notification`, `announcement` | Console (messages ciblés, squads, annonces chauffeurs) | Cloche + toast |

## 4. Endpoints ajoutés (backend, module `driver-app`)

Aucune route existante n'a été réécrite ; l'app consomme aussi `/drivers/:id/online`,
`/offline`, `/location`, `/telemetry`, `/queue`, `/profile`, `/wallet`, `/payout`,
`/training/eco`, `/drivers/:id/training`, `/rides/:id/transition`, `/wait`, `/sos`, `/pay`.

| Méthode | Route | Rôle |
|---|---|---|
| `POST` | `/drivers/auth/otp` | Envoi du code SMS (anti-spam 30 s) |
| `POST` | `/drivers/auth/verify` | Code → jeton chauffeur ; nouveau numéro = inscription |
| `GET` | `/drivers/me` | Fiche + situation financière (jeton) |
| `GET` | `/drivers/config` | Réglages console utiles au chauffeur |
| `GET` | `/drivers/announcements` | Annonces destinées aux chauffeurs |
| `GET` | `/drivers/demand` | Zones à forte demande (agrégées) |
| `POST` | `/drivers/:id/kyc/submit` | Soumission du dossier complété (jeton) |
| `GET` | `/drivers/:id/rides` | Historique + totaux jour / 7 jours (jeton) |
| `GET` | `/drivers/:id/active-ride` | Mission en cours + offre éventuelle (jeton) |
| `POST` | `/drivers/:id/offers/:rideId/accept` | Accepter l'offre (jeton) |
| `POST` | `/drivers/:id/offers/:rideId/decline` | Refuser l'offre (jeton) |
| `WS` | `/ws/drivers/:id?token=…` | Canal temps réel personnel |

`POST /rides` accepte en plus un champ optionnel `paymentMethod` (affiché au chauffeur ;
« espèces » exclut les chauffeurs au-delà du plafond de dette).

## 5. Règles métier

- **Offres** : l'attribution immédiate est conservée (le client voit tout de suite un
  chauffeur). Si ce chauffeur utilise l'app, il doit **confirmer** dans le délai console
  (`offerTimeoutSec`, 10–15 s). Refus ou délai dépassé → réattribution automatique au
  suivant (jamais re-proposée à qui a refusé), client prévenu en direct. Personne d'autre →
  annulation **sans frais**. Délai dépassé → chauffeur mis en **pause**.
  Le mode `broadcast` de la console est traité comme `cascade` côté offres.
- **Simulateur** : les chauffeurs équipés de l'app ne sont plus simulés ; les chauffeurs
  de démonstration (`SIMULATE_RIDES=true`) gardent le comportement historique.
- **Espèces** : à l'encaissement, une écriture « espèces encaissées » est inscrite au
  ledger → la **commission devient une dette**. Au-delà de `cashDebtLimit` (console), le
  chauffeur ne reçoit plus de courses payées en espèces (il reste éligible au mobile money).
- **Mise en ligne refusée** si le compte est suspendu (motif affiché), si ORION est fermé,
  et — depuis l'app — tant que le dossier n'est pas validé.
- **Commission** : taux effectif partagé entre paiement et app (personnalisé console >
  fidélité verte > vert réduit > standard).

## 6. Sécurité

- Jeton chauffeur HS256 signé avec `DRIVER_JWT_SECRET`, **distinct** du secret console :
  un jeton chauffeur n'ouvre jamais la console.
- Un jeton chauffeur ne peut agir que sur **sa** fiche et **ses** courses (403 sinon).
- `DRIVER_AUTH_STRICT=true` rend le jeton obligatoire sur toutes les routes
  `/drivers/:id/*` existantes (désactivé par défaut pour la compatibilité). **À activer en
  production** une fois l'envoi SMS branché.
- Codes SMS : 6 chiffres, validité `DRIVER_OTP_TTL_SECONDS`, 5 essais max, jamais
  journalisés ; en production ils ne sont **jamais** renvoyés par l'API.
- Coordonnées du passager visibles uniquement pendant la mission.
- Connexions et inscriptions chauffeur inscrites au journal d'audit.

> **Opérateur SMS** : le code part par l'API SMS d'Orange Côte d'Ivoire (ou Twilio),
> module `backend/src/modules/sms/`, commun aux chauffeurs et aux clients. Il s'active avec
> `SMS_PROVIDER=orange` et les identifiants Orange (`DEPLOIEMENT.md`, « Opérateur SMS »).
> Sans opérateur, un serveur en production refuse l'envoi du code (erreur 503 explicite).

## 7. Organisation du code

```
frontend/driver.html                 page d'entrée
frontend/src/driver/
  main.tsx, Driver.tsx               montage + coquille (onglets, offre, mission)
  useDriver.ts                       état central + synchronisation temps réel
  backend.ts                         accès backend réel (HTTP + WebSocket)
  demo.ts                            moteur de démonstration (sans backend)
  session.ts, errors.ts, types.ts    session, erreurs, types
  format.ts, ui.tsx, driver.css      utilitaires, composants, styles
  screens/                           Login, Home, Offer, Ride, Rides, Earnings, Green, Profile, Alerts
backend/src/modules/driver-app/
  auth.ts                            codes SMS + jeton chauffeur + garde
  config.ts                          configuration chauffeur publique
  views.ts                           vues course / gains / finances
  offers.ts                          offres, cascade, actions console
  routes.ts                          routes HTTP + canal WS
backend/tests/driver-app.test.ts     connexion, garde, mise en ligne, synchro WS, espèces
backend/tests/driver-offers.test.ts  offres, cascade, expiration, console, simulateur
```

## 8. Vérifications

- `backend` : `npm run typecheck` + `npm test` (11 tests ajoutés, 0 échec).
- `frontend` : `npm run typecheck` + `npm run build` (3 pages : client, admin, chauffeur).
- Parcours testé dans un navigateur réel avec le backend : inscription → dossier →
  validation console en direct → en ligne → offre (délai console) → course → espèces →
  dette visible → maintenance et suspension reçues en direct ; le client suit la voiture
  et les étapes sur `/ws/rides/:id`. Mode démo testé aussi. Aucune erreur console.

---

## 9. Alignement avec l'écosystème (app cliente, console, tableau de bord)

L'app Chauffeur a été réalignée sur les avancées de l'app cliente, de la console (sessions
« Mon poste », Équipages, Location Signature, Supervision SAMU) et du tableau de bord.

### 9.1 Défauts de synchronisation corrigés

| Constat | Correction |
|---|---|
| Les positions envoyées par l'app n'alimentaient pas le tracé de la course (seul le simulateur le faisait) : dossier SOS, déviation d'itinéraire, vitesse, position falsifiée et litiges travaillaient sans tracé pour un vrai chauffeur. | `POST /drivers/:id/location` enregistre chaque point sur la course active (même règle que le simulateur, début du trajet client marqué à la prise en charge). |
| Une course libérée après `RIDE_UNPAID_RELEASE_MINUTES` sans paiement restait la « mission en cours » de l'app. | Elle sort de la mission et apparaît dans **Gains › À régulariser** (`aRegulariser` de `/drivers/:id/rides`). |
| L'app demandait au client le prix complet en espèces, même quand son **abonnement ORION** en couvrait tout ou partie. | Chaque course porte `encaissement` (brut, part prise en charge, reste à encaisser). Course entièrement couverte : « Valider la fin de course — rien à encaisser ». Le chauffeur reste payé sur le brut. |
| L'annulation par le chauffeur passait par la transition générique : frais facturés au passager, « annulation abusive » comptée contre lui, aucun motif ni auteur. | `POST /drivers/:id/rides/:rideId/cancel` (voir 9.3). |
| Les décisions console sur une location (statut, annulation, réaffectation) n'arrivaient pas au chauffeur. | Trames `rental.update` et `rental.withdrawn`. |
| Le passager voyait une plaque déduite du matricule. | Il reçoit la **vraie plaque**, la couleur, le véhicule et la **photo** du chauffeur (`POST /rides`, `ride.reassigned`, lien de partage). |
| Le chauffeur voyait le nom complet du passager. | Prénom et photo, le temps de la course, comme l'annonce la politique de confidentialité publiée. |

### 9.2 Ajouts

| Onglet / écran | Contenu | Côté serveur |
|---|---|---|
| **Poste** (nouvel onglet) | Activité 30 jours, solde, dette espèces / plafond, reste dû, équipe et chef à appeler, identifiant console, points d'attention ; **demandes** (prêt, avance, congé, matériel, réparation, réclamation, document) avec plafonds et suivi du circuit chef → direction financière → trésorerie ; **messages et rapports du chef d'équipe** (lire, répondre, rendre). | `GET /drivers/:id/poste`, `POST /drivers/:id/requetes`, `GET /drivers/:id/messages`, `POST /drivers/:id/messages/:mid/lu`, `POST /drivers/:id/messages/:mid/reponse`, `POST /drivers/:id/rapports/:rid/rendre` |
| **Courses › Locations** | Locations Signature confiées : véhicule, période, lieu, contact à appeler, options à préparer (jamais le prix) ; étapes déclarées : véhicule préparé, en route, sur place, début puis fin de service (le dossier passe « en cours » puis « terminée » dans la console). | `GET /drivers/:id/rentals`, `POST /drivers/:id/rentals/:rid/etape` |
| **SOS** | Suivi en direct de son alerte, identique au passager : alerte reçue, agent ORION nommé, secours réellement sollicités, chat discret, numéros directs. Rien n'est annoncé avant d'avoir eu lieu. | `/safety/sos/:id`, `/safety/sos/:id/message`, `/ws/sos/:id` (existants) |
| **Course** | Prénom et photo du passager, reste à encaisser (abonnement), annulation motivée, trajet d'approche en pointillés sur la vraie carte. | — |
| **Profil** | Photo du chauffeur (vue par le passager, la console, le dossier SOS), couleur au choix vert / orange / bleu (comme l'app cliente), aide & sécurité, politique de confidentialité. | `PUT/DELETE /drivers/:id/photo`, `GET /drivers/:id/photo` |
| **Connexion** | Code SMS en six cases (un seul champ : frappe rapide, collage et remplissage automatique sans chiffre perdu), « Renvoyer le code ». | — |
| **Note en direct** | Toast « Nouvelle note ★★★★★ · #Courtoisie » (étoiles et thèmes, jamais le texte du passager). | trame `ride.rated` |

Nouvelles trames du canal `/ws/drivers/:id` : `ride.rated`, `rental.update`, `rental.withdrawn`,
`poste.message` (et `crew.request`, `rental.assigned`, déjà publiées par le serveur, désormais traitées).

### 9.3 Annulation par le chauffeur

| Situation | Effet |
|---|---|
| Avant la prise en charge (client injoignable, adresse introuvable, panne, insécurité, autre) | Le passager **garde sa course** : elle repart vers un autre chauffeur (jamais celui qui a annulé), sans frais pour lui. Personne d'autre : annulation sans frais. Panne : le chauffeur passe hors ligne. |
| Passager absent | Seulement une fois arrivé **et** après les minutes d'attente offertes (console) ; course annulée, frais d'absence console inscrits au client. |
| Course en cours | Refusé : terminer la course, ou SOS. |

Le motif est obligatoire et tracé au journal (`ride.cancel_chauffeur`, `ride.cancel_chauffeur_securite`) ;
les annulations du chauffeur sont comptées (`cancellations`), sauf motif de sécurité. Demander au
passager d'annuler lui-même reste interdit (signalé à la console comme détournement de course).

### 9.4 Vérifications

- `backend` : 9 tests ajoutés (`driver-alignement.test.ts`, `driver-poste-app.test.ts`), suite complète au vert.
- Parcours navigateur réel avec le serveur et la console pilotée en direct : code en six cases → photo →
  dossier validé → poste (équipe, chef, demande d'avance) → location Signature (étape déclarée) → course
  espèces avec code passager → tracé GPS enregistré → note reçue en direct → annulation motivée sans frais
  pour le passager → SOS suivi jusqu'à la prise en charge. Mode démo et couleur au choix vérifiés. Aucune
  erreur console.

## 10. Mise à niveau : écosystème complet, 8 langues, apps natives, navigation guidée

### 10.1 Corrections demandées

| Avant | Maintenant |
|---|---|
| Les messages du chef n'arrivaient qu'aux chauffeurs ayant un identifiant console créé à la main (« Personnel & accès »). | **Chaque chauffeur reçoit automatiquement son identifiant console** à l'inscription (code SMS) et dès qu'il entre dans la flotte d'une équipe ; le chef écrit et demande des rapports à **toute sa flotte**. Le chauffeur choisit lui-même son mot de passe console dans l'onglet **Poste** (`POST /drivers/:id/console/mot-de-passe`, journalisé). |
| La photo d'un chauffeur s'affichait pour quiconque connaissait son identifiant interne. | **Adresse signée et expirante** (HMAC, 24 h) remise uniquement aux personnes concernées : passager de la course, lien de partage, console, dossier SOS, le chauffeur lui-même. Sans signature : session du chauffeur ou accès personnel `drivers:read`, sinon refus. |
| La console n'affichait ni la photo du chauffeur ni son compteur d'annulations. | Photo (avatar) et **annulations** visibles dans Opérations (liste et fiche), Équipages, Supervision et Poste équipe. |
| App en français seulement. | **8 langues** (français, anglais, espagnol, italien, arabe de droite à gauche, chinois, allemand, russe), même choix que l'app cliente (`orion.lang`). Les messages envoyés à la console restent en français. Contrôle `npm run check:langues` en CI. |
| Installation depuis le navigateur uniquement. | **Apps natives « ORION Pro »** Android et iOS (`ci.orion.chauffeur`), voir [`NATIVE.md`](../NATIVE.md) §1 bis ; APK compilé à chaque modification. |
| Graphisme en retrait de l'app cliente. | Refonte au même niveau : en-têtes en dégradé, véhicule de la gamme sur scène lumineuse, interrupteur En ligne, tuiles de raccourcis, portrait, solde lumineux, barre d'onglets flottante, clair / sombre, vert / orange / bleu. |

### 10.2 Vraie carte et navigation guidée

L'app chauffeur utilise **la même carte réelle que l'app cliente** : carte vectorielle de la
Côte d'Ivoire dessinée à partir d'OpenStreetMap (routes, ponts, **échangeurs**, **voies en
construction**, quartiers, lagune), servie par OpenFreeMap et **mise à jour chaque semaine**
avec les nouveautés cartographiées (nouvel échangeur, voie ouverte, chantier). Les
itinéraires sont calculés par le serveur ORION (OSRM sur ces mêmes données).

Pendant une mission, le chauffeur est **guidé dans l'app** :

- la carte **suit le véhicule**, orientée dans le sens de la marche, en vue inclinée ;
  « Vue d'ensemble » montre tout le trajet, « Recentrer » reprend le suivi ;
- **bandeau de guidage** : prochaine manœuvre (bretelle d'échangeur, sortie, rond-point avec
  numéro de sortie, embranchement, demi-tour…), distance, voie à prendre, manœuvre suivante,
  distance restante, durée et **heure d'arrivée** recalculées à chaque position ;
- **recalcul automatique** quand le chauffeur s'écarte de l'itinéraire (déviation, route barrée,
  chantier) : au-delà de 60 m pendant trois positions, au plus une fois toutes les 20 s ;
- **guidage vocal** dans la langue choisie (à l'approche : ≈ 400 m, 120 m, puis au moment de
  tourner), désactivable d'un toucher ;
- vers le client (ou le colis), puis vers la destination ; Google Maps et Waze restent proposés.

| Élément | Où |
|---|---|
| Manœuvres de l'itinéraire (position, type, sortie de rond-point) | `backend/src/modules/maps/routage.ts` (`manoeuvres`, ajout aux champs existants) |
| Moteur de guidage (situer le véhicule, prochaine manœuvre, recalcul) | `frontend/src/driver/navigation.ts` |
| Bandeau et guidage vocal | `frontend/src/driver/screens/Guidage.tsx` |
| Carte qui suit le véhicule, tracé fourni | `frontend/src/components/CarteReelle.tsx` (`suivi`, `trace`, `ponts`, optionnels : l'app cliente est inchangée) |

Sans réseau, ou si le serveur de tuiles ne répond pas, la carte bascule d'elle-même sur la
**carte de secours** (qui trace aussi l'itinéraire guidé) : la course n'est jamais bloquée.
En démonstration, le GPS simulé fait rouler le véhicule **le long des routes** de l'itinéraire.

Production : `OSRM_URL` peut pointer vers un serveur OSRM ORION alimenté chaque jour par
l'extrait Côte d'Ivoire d'OpenStreetMap, et `VITE_MAP_TILES_URL` vers un serveur de tuiles
ORION, pour des mises à jour plus fréquentes que la semaine.

### 10.3 Vérifications

- Serveur : suite complète au vert (dont identifiant automatique, photo signée, manœuvres).
- Moteur de guidage : contrôles sur un itinéraire réel (progression, manœuvres successives,
  écart d'itinéraire, textes en français, anglais et arabe, repli hors connexion).
- Parcours navigateur avec le serveur ORION : course acceptée → guidage vers le client
  (bretelle, rond-point sortie 2, arrivée) → déviation et nouvel itinéraire → vue d'ensemble ;
  en français et en arabe. Parcours complet (inscription, photo, poste, location, course
  espèces, annulation, SOS suivi) et mot de passe console vérifié par une vraie connexion.
