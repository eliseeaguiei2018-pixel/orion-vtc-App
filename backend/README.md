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
