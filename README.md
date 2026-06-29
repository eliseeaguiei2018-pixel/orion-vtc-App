# ORION VTC 🚗🌱

**Plateforme de mobilité verte (VTC) pour la Côte d'Ivoire (Abidjan)**, organisée autour
de trois interfaces — **Client**, **Chauffeur** et **Administrateur** — conçue pour être
simple, rapide, sûre, transparente et **facilement extensible** à d'autres services Orion.

Ce dépôt contient :
- une **documentation fonctionnelle et technique** complète (`docs/`) ;
- un **backend** runnable, stateless et scalable (`backend/`) ;
- une **application client** premium mobile-first (`frontend/`).

> 📱 **Périmètre actuel** : l'**application client** est livrée en premier.
> L'**application chauffeur** est un projet **séparé**, prévu pour la suite (même backend).

## 🎯 Principes différenciants
Interface simple et moderne · rapidité de réservation · sécurité passagers & chauffeurs ·
transparence des prix (FCFA) · qualité de service · extensibilité multi-services.

## 🇨🇮 Pensé pour la Côte d'Ivoire
- **Plan directeur** : communes du Grand Abidjan + grandes villes du pays (zones, surge).
- **FCFA (XOF)** et **mobile money** en tête : Orange Money, Wave, MTN MoMo, Moov Money.
- **Sécurité** : bouton SOS + **détection automatique d'accident** → alerte **SAMU (185)**.
- **Suivi temps réel** (WebSocket) et **partenariat Google Maps** prêt (itinéraires/places).

## 🧭 Les trois interfaces
- **Client** : compte, géoloc, départ/destination, estimation avant validation, choix de
  véhicule, suivi temps réel, paiement, historique, notation, SOS.
- **Chauffeur** *(à venir, séparé)* : inscription + KYC, disponibilité, courses, navigation,
  revenus, wallet.
- **Admin** : validation chauffeurs, véhicules, suivi temps réel, stats, commissions,
  promotions, support, supervision des urgences.

## 📚 Documentation
| Document | Sujet |
|----------|-------|
| [Vue d'ensemble](docs/01-vue-densemble.md) | Architecture macro, cycle de vie d'une course |
| [Parcours utilisateurs](docs/02-user-flows.md) | User flows client / chauffeur / admin |
| [Critères réglementaires](docs/03-criteres-validation-reglementaires.md) | Documents KYC + workflow de validation |
| [Extension des services](docs/04-strategie-extension-services.md) | Architecture multi-services (livraison, micro-mobilité…) |
| [Architecture & scalabilité](docs/05-architecture-scalabilite.md) | « Ne pas buguer quel que soit le nombre d'utilisateurs » |
| [Modèle de données](docs/06-modele-de-donnees.md) | Entités et choix structurants |
| [Côte d'Ivoire, sécurité & temps réel](docs/07-cote-divoire-securite-temps-reel.md) | Plan directeur CI, mobile money, accident/SAMU, WebSocket, Google Maps |

## ⚙️ Backend (démarrage rapide)
```bash
cd backend && cp .env.example .env && npm install
npm run dev      # http://localhost:3000
npm test         # 30 tests
```
Aucune infrastructure externe requise pour démarrer (index géo & temps réel en mémoire ;
Redis/PostgreSQL en production). Détails : [`backend/README.md`](backend/README.md).

## 📱 Application client (démarrage rapide)
```bash
cd frontend && npm install
npm run dev      # http://localhost:5173
```
Tourne en **mode démo** sans backend, ou se connecte à l'API via `VITE_API_URL`.
Détails : [`frontend/README.md`](frontend/README.md).

## 🏗️ Pourquoi ça tient la charge
Services **stateless** + scalabilité **horizontale**, **idempotence**, **prix verrouillé**,
**machine à états**, **rate limiting** (back-pressure), **health checks** + **graceful
shutdown**, **logs structurés**, matching géo via **index spatial à TTL**, temps réel
adossable à **Redis Pub/Sub**. Voir [docs/05](docs/05-architecture-scalabilite.md).

## 🗺️ Suite logique (roadmap)
1. Persistance PostgreSQL/PostGIS + Redis (implémenter les variantes des interfaces).
2. Brancher l'app client sur le WebSocket serveur + activer Google Maps (clé API).
3. Wallet chauffeur + commissions + payouts mobile money.
4. **Application chauffeur** (projet séparé) + dashboard admin / supervision des urgences.
5. Extension : livraison de colis, puis micro-mobilité (cf. docs/04).

## 📄 Licence
À définir par le porteur du projet.
