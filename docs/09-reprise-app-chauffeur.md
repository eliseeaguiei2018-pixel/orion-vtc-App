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
| **App Chauffeur** | ❌ **à construire** | — |

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

## 6. Périmètre proposé pour l'app Chauffeur

À confirmer avec le porteur du projet avant de coder.

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
