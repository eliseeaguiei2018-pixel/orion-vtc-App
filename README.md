# ORION VTC 🚗🌱

**Plateforme de mobilité verte (VTC)** organisée autour de trois interfaces —
**Client**, **Chauffeur** et **Administrateur** — conçue pour être simple, rapide,
sûre, transparente et **facilement extensible** à d'autres services Orion.

Ce dépôt contient :
- une **documentation fonctionnelle et technique** complète (`docs/`) ;
- un **backend de référence** runnable, stateless et scalable (`backend/`).

## 🎯 Principes différenciants
Interface simple et moderne · rapidité de réservation · sécurité passagers & chauffeurs ·
transparence des prix · qualité de service · extensibilité multi-services.

## 🧭 Les trois interfaces
- **Client** : compte, géoloc, départ/destination, estimation de prix avant validation,
  choix de véhicule, suivi temps réel, paiement (espèces / mobile money / carte),
  historique, notation.
- **Chauffeur** : inscription + validation documentaire, disponibilité, réception de
  courses, navigation, revenus, historique, wallet.
- **Admin** : validation des chauffeurs, gestion véhicules, suivi temps réel, statistiques,
  commissions, promotions, support.

## 📚 Documentation
| Document | Sujet |
|----------|-------|
| [Vue d'ensemble](docs/01-vue-densemble.md) | Architecture macro, cycle de vie d'une course |
| [Parcours utilisateurs](docs/02-user-flows.md) | User flows client / chauffeur / admin |
| [Critères réglementaires](docs/03-criteres-validation-reglementaires.md) | Documents KYC + workflow de validation |
| [Extension des services](docs/04-strategie-extension-services.md) | Architecture multi-services (livraison, micro-mobilité…) |
| [Architecture & scalabilité](docs/05-architecture-scalabilite.md) | « Ne pas buguer quel que soit le nombre d'utilisateurs » |
| [Modèle de données](docs/06-modele-de-donnees.md) | Entités et choix structurants |

> 👉 Les trois sujets demandés (user flows, critères réglementaires, stratégie d'extension)
> sont traités dans les documents 02, 03 et 04. La robustesse / mise à l'échelle est
> traitée dans le document 05 **et** implémentée dans le backend.

## ⚙️ Backend (démarrage rapide)
```bash
cd backend
cp .env.example .env
npm install
npm run dev      # http://localhost:3000
npm test         # suite de tests
```
Aucune infrastructure externe requise pour démarrer (index géo en mémoire ;
Redis/PostgreSQL en production). Détails : [`backend/README.md`](backend/README.md).

## 🏗️ Pourquoi ça tient la charge
Services **stateless** + scalabilité **horizontale**, **idempotence**, **prix verrouillé**,
**machine à états**, **rate limiting** (back-pressure), **health checks** + **graceful
shutdown**, **logs structurés**, matching géo via **index spatial à TTL**. Voir
[docs/05](docs/05-architecture-scalabilite.md).

## 🗺️ Suite logique (roadmap)
1. Persistance PostgreSQL/PostGIS + Redis (implémenter les variantes des interfaces).
2. Gateway temps réel WebSocket (suivi chauffeur, transitions d'état).
3. Paiements (mobile money / carte) + wallet chauffeur + commissions.
4. Apps mobiles (client, chauffeur) + dashboard admin.
5. Extension : livraison de colis, puis micro-mobilité (cf. docs/04).

## 📄 Licence
À définir par le porteur du projet.
