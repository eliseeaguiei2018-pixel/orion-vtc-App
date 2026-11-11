# 🚗 ORION — Dossier de reprise : **App Chauffeur**

> Document de passation destiné à une **nouvelle session de travail** qui doit construire
> l'application Chauffeur en restant **synchronisée** avec le backend et la console Admin
> déjà en place. Il décrit l'existant, les règles du projet, les points d'accroche
> techniques et le périmètre à livrer.

---

## 1. Le projet en une page

**ORION** — super-app de **mobilité verte** (VTC + livraison moto) pour **Abidjan, Côte d'Ivoire**.
Interface et contenus **en français**, devise **XOF (F CFA)**, **prix fixe garanti**
(le montant affiché est le montant payé, embouteillages inclus).

| Brique | État | Emplacement |
|---|---|---|
| **API Backend** | ✅ en place | `backend/` (Node 22, Fastify 5, TypeScript strict) |
| **App Client** (passagers) | ✅ en place | `frontend/index.html` + `frontend/src/App.tsx` |
| **Console Admin** (17 sessions) | ✅ en place | `frontend/admin.html` + `frontend/src/admin/Admin.tsx` |
| **App Chauffeur** | ✅ en place (novembre 2026) | `frontend/driver.html` + `frontend/src/driver/` — voir [doc 10](./10-app-chauffeur.md) |

Dépôt : `eliseeaguiei2018-pixel/orion-vtc-App` · Branche de travail : `claude/orion-platform-overview-osgd1u` · PR #1 ouverte.

---

## 2. Règles du projet (non négociables)

1. **Tout en français** : interface, commentaires de code, messages de commit.
2. **Additif uniquement** : on **complète** l'existant, on ne retire **jamais** une
   fonctionnalité déjà livrée. Avant de coder une fonctionnalité, **vérifier si elle
   existe déjà** — si oui, ne pas la refaire.
3. **Zéro bug** : `npm run typecheck`, `npm test` (backend) et `npm run build` (frontend)
   doivent passer avant chaque commit.
4. **Commiter tôt et souvent** : le conteneur de travail peut être recyclé et **tout
   travail non committé est perdu** (c'est déjà arrivé). Ne pas accumuler.
5. **Pousser** sur `claude/orion-platform-overview-osgd1u` avec `git push -u origin <branche>`.
   **Ne pas ouvrir de pull request** sans demande explicite (la PR #1 existe déjà).
6. **Ne jamais mettre d'identifiant de modèle** dans le code, les commits ou la doc.

### Exigence transversale de sécurité (déjà appliquée à la console)

> Si un employé tente d'accéder à une session qui ne lui est pas autorisée, un message
> doit s'afficher l'informant qu'il n'a pas le droit d'y accéder **sans autorisation de
> la direction**, puis une alerte est envoyée au **DG, au CFO et au DAA**, et l'événement
> est journalisé.

Implémentation existante : `backend/src/modules/admin/security.ts` (`SecurityAlertsService`,
`SECURITY_NOTIFY = ['DG','CFO','DAA']`) et la fonction `require(req, permission)` de
`backend/src/modules/admin/routes.ts`. **Toute nouvelle route admin doit passer par `require()`.**

---

## 3. Architecture backend (points d'accroche)

- **Pattern Repository** (`backend/src/core/db/repository.ts`) : mémoire ↔ SQLite, même interface.
- **Injection de dépendances** via `createContainer()` (`backend/src/container.ts`).
- **Imports ESM** : toujours suffixer `.js` (TypeScript NodeNext), y compris dans les tests.
- **Validation** : Zod sur chaque entrée (`backend/src/core/validate.ts` → `parse()`).
- **Erreurs** : `badRequest()`, `notFound()`, `forbidden()` de `backend/src/core/errors.ts`.
- **PDF sans dépendance** : `backend/src/core/pdf.ts` (`simplePdf`).
- **CSV anti-injection de formule** : préfixer `'` si la cellule commence par `=`, `+`, `-` ou `@`.
- **Tests** : `node:test` + `tsx`, dans `backend/tests/*.test.ts`. **117 tests, 0 échec** à ce jour.

### ⚠️ Zod v4 — syntaxe à respecter

Le backend utilise **Zod v4** (`zod@^4.6.7`, depuis la mise à jour de sécurité
GHSA-mrhx-c7xc-m3w5). La migration depuis la v3 n'a demandé **aucune adaptation du code
existant**, mais une règle change pour tout nouveau schéma.

**La règle qui casse** — `z.record()` exige **deux arguments** (type de clé, type de valeur) :

```ts
// ❌ Passe à l'exécution, mais ÉCHOUE au typecheck :
//    "error TS2554: Expected 2-3 arguments, but got 1" → CI rouge
const schema = z.record(z.boolean());

// ✅ Forme correcte (déjà celle employée dans le code existant)
const schema = z.record(z.string(), z.boolean());
```

> Le piège : la v4 reste permissive à l'exécution, donc un test peut passer alors que
> `npm run typecheck` échouera. C'est `tsc` qui garde la CI — toujours le lancer.

**Formes héritées encore valides** (vérifiées sur zod 4.6.7, typecheck et exécution) —
inutile de les réécrire dans le code existant, mais préférer la forme moderne pour du neuf :

| Hérité (fonctionne) | Forme moderne v4 |
|---|---|
| `z.string().email()` | `z.email()` |
| `z.object({…}).strict()` | `z.strictObject({…})` |
| `z.nativeEnum(Obj)` | `z.enum(Obj)` |
| `error.flatten()` | `z.flattenError(error)` |
| `.min(2, { message: 'court' })` | `.min(2, { error: 'court' })` |

**Inchangé** : `z.object`, `z.string`, `z.number`, `z.boolean`, `z.array`, `z.enum`,
`z.coerce.*`, `z.custom<T>()`, `.optional()`, `.default()`, `safeParse()`.

Le wrapper maison `parse(schema, data)` (`backend/src/core/validate.ts`) lève un 400
homogène et reste inchangé : **l'utiliser systématiquement** plutôt qu'un `safeParse` direct.

### Temps réel (WebSocket)

| Canal | Rôle |
|---|---|
| `GET /ws/rides/:id` | Suivi d'une course (position, transitions, alertes) |
| `GET /ws/emergency` | Poste de supervision SAMU (SOS / accidents) |
| `GET /ws/config` | **Config publique en direct** : à la connexion, trame `connected` portant `config` ; à chaque changement console, trame `config.update` portant `data` |

Hub pub/sub : `backend/src/modules/realtime/hub.ts` (rooms `ride:`, `driver:`, `client:`,
`emergency`, `support`, `config`). En production multi-instances → adosser à Redis Pub/Sub.

---

## 4. Endpoints **déjà disponibles** pour l'app Chauffeur

Ne pas les réécrire — les consommer.

| Méthode | Route | Usage |
|---|---|---|
| `POST` | `/drivers` | Création d'un chauffeur |
| `GET` | `/drivers/:id` | Fiche chauffeur |
| `POST` | `/drivers/:id/online` | Passer en ligne (avec position) |
| `POST` | `/drivers/:id/offline` | Passer hors ligne |
| `POST` | `/drivers/:id/location` | Envoi de position (tracking) |
| `POST` | `/drivers/:id/telemetry` | Télémétrie verte (batterie, SoC/SoH) |
| `GET` | `/drivers/:id/queue` | File des offres de course reçues |
| `POST` | `/drivers/:id/profile` | Mise à jour du profil / véhicule |
| `GET` | `/drivers/:id/wallet` | Portefeuille : gains, commissions, solde |
| `POST` | `/drivers/:id/payout` | Demande de virement |
| `GET` | `/training/eco` | Module de formation éco-conduite |
| `POST` | `/drivers/:id/training` | Validation d'une formation |
| `POST` | `/rides/:id/transition` | Changement d'état de course (`driver_en_route`, `arrived`, `in_progress`, `completed`, `cancelled`) |
| `POST` | `/rides/:id/wait` | Attente facturée (minutes de courtoisie gérées côté serveur) |
| `POST` | `/rides/:id/sos` | Alerte SOS depuis la course |
| `GET` | `/config` | Config publique (maintenance, services, passerelles) |
| `GET` | `/drivers/:id/rentals` | **Locations Signature confiées à ce chauffeur** (session chauffeur requise) |

**Données chauffeur déjà modélisées** (`backend/src/modules/drivers/store.ts`) :
`suspensionReason`, `loyaltyTier`, `commissionOverride`, `electricRides`, `batteryKwh`,
`plugType`, `cablesConfirmed`, `ribVerified`, `nif`, `vip`, `batteryHealthPct`, `phone`,
`licenseNo`, `birthDate`, `vehiclePlate`, `vehicleColor`.

---

## 5. Ce que la console Admin pilote (à refléter côté chauffeur)

La console (17 sessions) contrôle notamment :

- **Dispatch** : rayon de recherche, mode cascade/broadcast, délai d'acceptation d'une
  offre (10–15 s), pondération du scoring, priorité écologique, filtre ETA.
- **Commissions** : taux standard / **réduit flotte électrique** / fidélité au-delà d'un
  seuil de courses électriques.
- **Plafond de dette espèces** : au-delà, le chauffeur ne reçoit que des courses carte.
- **Incitations vertes** : bonus de recharge en heures creuses, points carbone.
- **KYC & conformité** : pipeline de validation, documents expirants (< 30 j), suspension
  **motivée**, conformité verte (kWh / type de prise).
- **Maintenance véhicules**, **astreintes 24/7**, **squads** (micro P&L, chat d'équipe).
- **Qualité** : note minimale, avertissement automatique, désappariement sous 1–2 ★.
- **Maintenance plateforme** : ORION ouvert/fermé, services activés, passerelles de paiement.

👉 **Le modèle de synchro à reproduire** : l'app Client lit `GET /config` au démarrage
**et** s'abonne à `GET /ws/config` pour appliquer les changements en direct
(voir `frontend/src/api.ts` → `fetchAppConfig()`, `configSocketUrl()` et l'effet
correspondant dans `frontend/src/App.tsx`). **L'app Chauffeur doit faire pareil.**

---

## 5 bis. LOCATION SIGNATURE — ce que l'app Chauffeur doit ajouter

Un service de **location de véhicules électriques ultra-premium** a été ajouté
(`backend/src/modules/rental/`, flotte dans `backend/src/modules/fleet/prestige.ts`) :
Huawei Maextro S800, BYD Yangwang U7, Huawei AITO M9, NIO ES9, NIO ET9,
Huawei Stelato S9, Zeekr 8X. Trois formules : **événement & mariage**,
**entreprise & institution**, et **course en mise à disposition** (la voiture pour
N heures, ou privatisée à la journée / au week-end / à la semaine / au mois).

La console affecte un chauffeur à une location (session « Location Signature »).
**Côté app Chauffeur, il reste à faire :**

1. **Écran « Mes locations »** alimenté par `GET /drivers/:id/rentals` (jeton chauffeur
   obligatoire). La réponse donne le dossier, le véhicule, la période, les heures de
   mise à disposition, le lieu de prise en charge, le contact sur place, la société et
   le bon de commande le cas échéant, le statut et **les options à préparer**
   (décoration, tapis rouge, hôtesses, escorte, rafraîchissements…).
   Le montant facturé au client n'est **pas** exposé au chauffeur : il reçoit la
   prestation à assurer, pas la facture.
2. **Notification temps réel** : à l'affectation, le serveur publie `rental.assigned`
   sur le canal personnel du chauffeur (`/ws/drivers/:id`) et crée une notification.
   L'app doit l'afficher comme elle affiche déjà une offre de course.
3. **Préparation du véhicule** : les options cochées impliquent une préparation
   (décoration florale, tapis rouge). Prévoir une case « véhicule préparé » si le
   porteur du projet le demande — rien n'est encore implémenté côté serveur.

> ⚠️ Une location n'est **pas** une course : pas de `lockId`, pas de machine à états
> de course, pas de commission au km. Ne pas l'injecter dans le flux `rides`.

---

## 5 ter. ABONNEMENT ORION — ce que le chauffeur doit savoir

L'abonnement client a été rendu **effectif** (il était purement décoratif) :
une course peut être prise en charge, en tout ou partie, par le forfait du client.

**Conséquence directe pour l'app Chauffeur** : le client peut payer **0 F** à la fin
d'une course, alors que le chauffeur est rémunéré sur le **montant brut**. C'est déjà
le comportement du serveur (`POST /rides/:id/pay` crédite `montantBrut`), mais l'app
Chauffeur ne doit pas en conclure à un impayé ni afficher « non payé ».

- En **espèces**, le chauffeur n'encaisse que le reste dû (part d'abonnement déduite) ;
  sa dette espèces n'est débitée que de ce montant-là.
- L'écran « gains » doit continuer d'afficher le **brut** et la commission habituelle.

---

## 6. Périmètre proposé pour l'app Chauffeur

> ✅ **Livré** (lots 0 à 8 validés par le porteur du projet). Détail, endpoints ajoutés,
> règles métier et sécurité : [docs/10-app-chauffeur.md](./10-app-chauffeur.md).
> Décisions retenues : attribution immédiate conservée + confirmation par le chauffeur
> (cascade en cas de refus) ; espèces = commission inscrite en dette avec plafond console ;
> connexion par code SMS, mode strict désactivé par défaut.

1. **Connexion & KYC** : inscription, dépôt de documents, suivi du statut de validation,
   affichage du **motif de suspension** le cas échéant.
2. **Mise en ligne** : bouton En ligne / Hors ligne, position envoyée en continu,
   état de la zone (secteur, bonus, standard minimal exigé).
3. **Réception d'offres** : offre de course avec **compte à rebours** aligné sur le délai
   configuré en console, acceptation / refus, cascade vers le suivant.
4. **Déroulé de course** : navigation, transitions d'état, attente facturée, SOS,
   chat/appel client, fin de course et encaissement (espèces / mobile money).
5. **Gains** : portefeuille, détail des commissions (taux **vert** mis en avant),
   dette espèces et son plafond, demande de virement.
6. **Mobilité verte** : niveau de batterie, formation éco-conduite, bonus heures creuses,
   points carbone, kilomètres électriques cumulés.
7. **Synchronisation console** : `GET /config` + abonnement `GET /ws/config` ;
   respect de la maintenance (ORION fermé → pas de mise en ligne) et des passerelles actives.
8. **Qualité** : note moyenne, retours clients, alertes qualité.

### Choix technique conseillé

Même stack que l'existant : **React + Vite + TypeScript**, en **troisième page** du projet
`frontend/` (`driver.html` + `frontend/src/driver/`), sur le modèle de la console Admin
(`admin.html` + `frontend/src/admin/`). Avantages : un seul build, un seul déploiement,
réutilisation directe des composants (`frontend/src/components/`), de l'i18n
(`frontend/src/i18n/`) et du thème. Le fichier `frontend/vite.config.ts` déclare déjà les
entrées multi-pages — y ajouter la troisième.

---

## 7. Avant de livrer

```bash
# Backend
cd backend && npm ci && npm run typecheck && npm test

# Frontend
cd frontend && npm ci && npm run typecheck && npm run build
```

Puis commit en français et `git push -u origin claude/orion-platform-overview-osgd1u`.
La CI GitHub Actions (`.github/workflows/ci.yml`) rejoue typecheck + tests + build + audit
sur chaque push et sur la PR.

---

## 8. Lectures utiles

- `docs/01-vue-densemble.md` — vision produit
- `docs/05-architecture-scalabilite.md` — architecture et montée en charge
- `docs/07-cote-divoire-securite-temps-reel.md` — spécificités CI, sécurité, temps réel
- `HANDOVER.md` — passation générale (mise en production, stores, recrutement)
- `SECURITY.md` — politique de sécurité des données
