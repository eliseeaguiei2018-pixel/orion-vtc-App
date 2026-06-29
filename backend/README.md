# ORION VTC — Backend

API de mise en relation géolocalisée pour la plateforme de mobilité verte ORION.
Conçue **stateless** et **horizontalement scalable** (cf.
[`../docs/05-architecture-scalabilite.md`](../docs/05-architecture-scalabilite.md)).

## Pile technique
- **Node.js 20+ / TypeScript** (strict)
- **Fastify 5** (HTTP performant)
- **Zod** (validation des entrées)
- **Pino** (logs structurés)
- Index géo **abstrait** : mémoire en dev/test, Redis-ready en prod

## Démarrage

```bash
cp .env.example .env
npm install
npm run dev        # développement (rechargement à chaud)
```

Le service tourne **sans aucune infrastructure externe** (index géo en mémoire),
ce qui le rend immédiatement exécutable et testable.

## Scripts
| Commande | Description |
|----------|-------------|
| `npm run dev` | Serveur de développement (watch) |
| `npm run build` | Compilation TypeScript → `dist/` |
| `npm start` | Démarrage production (`dist/server.js`) |
| `npm run typecheck` | Vérification de types |
| `npm test` | Suite de tests (unitaires + intégration via `app.inject`) |

## Endpoints principaux

| Méthode | Route | Rôle |
|---------|-------|------|
| GET | `/health/live` · `/health/ready` | Liveness / readiness (orchestrateur) |
| GET | `/services` | Services activés |
| POST | `/pricing/estimate` | Estimation **prix verrouillé** avant validation |
| POST | `/drivers` | Inscription chauffeur |
| POST | `/drivers/:id/online` · `/offline` | Disponibilité + présence géo |
| POST | `/drivers/:id/location` | Heartbeat de position (TTL) |
| POST | `/rides` | Création de course (idempotente) + matching |
| GET | `/rides/:id` | Détail d'une course |
| GET | `/clients/:clientId/rides` | Historique client |
| POST | `/rides/:id/transition` | Transition d'état contrôlée (machine à états) |
| POST | `/rides/:id/rate` | Notation du chauffeur |
| GET | `/compliance/rules/:jurisdiction` | Règles KYC par juridiction |
| POST | `/compliance/evaluate` | Éligibilité d'un dossier chauffeur |
| GET | `/geo/zones` · POST `/geo/resolve` | Plan directeur CI (zones) + rattachement |
| GET | `/payments/methods` | Moyens de paiement (mobile money en tête) |
| POST | `/rides/:id/pay` | Paiement (FCFA, idempotent) |
| POST | `/safety/sos` · `/safety/sensor` | SOS manuel · détection d'accident (capteurs) |
| GET | `/safety/alerts` · `/safety/emergency-numbers` | Alertes · numéros d'urgence CI (SAMU 185) |
| POST | `/maps/route` · GET `/maps/autocomplete` | Itinéraires / lieux (Google Maps si clé) |
| GET | `/drivers/:id/wallet` · POST `/drivers/:id/payout` | Wallet chauffeur (solde, ledger) · retrait |
| GET | `/fleet` | Niveaux Bronze→Diamant + flotte de marques |
| GET | `/subscriptions/plans` · POST `/subscriptions` | Abonnements (Bronze/Argent/Gold) |
| POST | `/wedding/quote` · `/wedding/reserve` | Location mariage (prix par niveau + options) |
| GET | `/countries` | Pays (CI actif + expansion sous-régionale) |
| WS | `/ws/rides/:id` · `/ws/emergency` | Suivi temps réel · supervision urgences |

> 🏷️ **Niveaux** : Bronze / Argent / Or / Diamant, du plus accessible au plus haut de gamme,
> chacun avec sa flotte 100% électrique (Geely, Deepal, AVATR, Xiaomi, XPENG, Huawei Stelato,
> NIO, Zeekr…) et un multiplicateur tarifaire. 🌍 **Multi-pays** prêt (CI actif).

> 🛰️ **Tracking live** : à la création d'une course, le serveur émet en continu la position
> du chauffeur (`driver.location`) et les transitions (`ride.status`) sur la room WebSocket.
> En dev, un **simulateur** (`SIMULATE_RIDES=true`) joue le rôle de l'app chauffeur (encore
> à venir) et des **chauffeurs de démonstration** sont mis en ligne au démarrage.
> 💰 **Wallet & commissions** : au paiement, le gain net (montant − commission) crédite le
> wallet du chauffeur ; la commission plateforme est journalisée.

> 🇨🇮 **Localisation** : devise **XOF (FCFA)**, tarifs Abidjan, surge par zone & heure de
> pointe, zone de service limitée à la Côte d'Ivoire. Voir
> [`../docs/07-cote-divoire-securite-temps-reel.md`](../docs/07-cote-divoire-securite-temps-reel.md).

### Exemple : estimation puis course

```bash
# 1) Estimation (récupère un lockId = prix verrouillé)
curl -X POST localhost:3000/pricing/estimate -H 'content-type: application/json' \
  -d '{"origin":{"lat":48.85,"lng":2.35},"destination":{"lat":48.86,"lng":2.34}}'

# 2) Création de course avec le lockId + clé d'idempotence
curl -X POST localhost:3000/rides -H 'content-type: application/json' \
  -H 'idempotency-key: 123e4567' \
  -d '{"clientId":"client-1","lockId":"<lockId>"}'
```

## Patterns de robustesse implémentés
- **Idempotence** (`Idempotency-Key`) sur la création de course → pas de doublon.
- **Prix verrouillé** (`lockId`) entre estimation et création → transparence garantie.
- **Machine à états** → transitions illégales refusées (409).
- **Rate limiting** → protection surcharge (429 + back-pressure).
- **Health checks** `live`/`ready` + **graceful shutdown** → déploiements sans coupure.
- **Logs structurés** avec `requestId` → observabilité.
- **Index géo TTL** → présence chauffeur sans « fantômes ».

## Structure
```
src/
  config/        configuration validée (12-factor)
  core/          briques transverses (logger, errors, geo, idempotence, state machine)
  modules/
    services/    contrat ServiceModule + registre + module VTC (multi-service)
    drivers/     chauffeurs, présence, disponibilité
    rides/       courses, matching, cycle de vie
    pricing/     estimation / devis verrouillé
    compliance/  règles KYC réglementaires
    health/      liveness / readiness
  app.ts         assemblage Fastify
  server.ts      démarrage + arrêt en douceur
  container.ts   injection de dépendances
tests/           tests unitaires & d'intégration
```

## Production
- Construire l'image : `docker build -t orion-api ./backend` (ou `docker compose up`).
- Brancher Redis (`GEO_BACKEND=redis`) et PostgreSQL : implémenter les variantes des
  interfaces `GeoIndex` / stores — **sans changer les modules métier**.
