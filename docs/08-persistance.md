# ORION VTC — Persistance des données

Objectif : les comptes, courses, wallet, abonnements et réservations **survivent aux
redémarrages**. Implémenté via le **pattern Repository**, avec trois backends interchangeables.

## 1. Principe

L'application ne dépend que de l'interface `Repository<T>`
([`../backend/src/core/db/repository.ts`](../backend/src/core/db/repository.ts)) :

```ts
interface Repository<T extends { id: string }> {
  get(id): T | undefined;
  put(item): void;
  delete(id): void;
  all(): T[];
}
```

| Backend | Quand | Détails |
|---------|-------|---------|
| `memory` | dev / tests (défaut) | volatile, conserve l'identité des objets en mémoire |
| `sqlite` | local durable | module **intégré `node:sqlite`** (zéro dépendance), fichier `DB_PATH` |
| `postgres` | production | même interface, implémentation `pg` (à brancher) |

Activation : `PERSISTENCE=sqlite` + `DB_PATH=./data/orion.db` (cf. `.env.example`).

## 2. Write-through + réhydratation

Chaque magasin (`DriverStore`, `RideStore`, `WalletService`, `SubscriptionService`,
`WeddingService`) garde un **cache mémoire vivant** (l'identité des objets est préservée,
donc les mutations en place — statut de course, solde — fonctionnent) **et écrit à travers**
le repository à chaque changement. Au démarrage, il se **réhydrate** depuis le repository :

```
écriture → cache mémoire + repository (SQLite)
démarrage → repository → cache mémoire (réhydratation)
```

Les devis (`quotes`) restent **transitoires** (TTL) : mémoire uniquement.

## 3. Vérifié

- `npm test` (mémoire) : 47 tests ✓
- `npm run test:persist` (SQLite) : un chauffeur et le wallet **rechargés** par un nouveau
  cycle de store ✓
- **Redémarrage réel du serveur** : une ressource créée avant l'arrêt est toujours présente
  après redémarrage (chargée depuis SQLite) ✓

## 4. Passage à PostgreSQL (production)

Fournir une `PostgresRepository<T>` implémentant `Repository<T>` (table par collection avec
colonnes typées + index, ou `jsonb`), puis l'activer dans `createRepository`. Aucun module
métier ne change. Idéal avec le partitionnement et les réplicas décrits dans
[`05-architecture-scalabilite.md`](./05-architecture-scalabilite.md).
