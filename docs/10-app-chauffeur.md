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
