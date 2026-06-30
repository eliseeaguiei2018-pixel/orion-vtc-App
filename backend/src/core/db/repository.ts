import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { config } from '../../config/index.js';
import { logger } from '../logger.js';

/**
 * Couche de persistance — pattern Repository.
 *
 * L'application dépend de l'interface `Repository<T>`, jamais d'une base précise.
 *  - `memory`  : volatile (défaut, tests) — conserve l'identité des objets en mémoire.
 *  - `sqlite`  : durable (fichier local) via le module intégré `node:sqlite` (zéro dépendance).
 *  - `postgres`: en production, on fournit une implémentation Postgres de CETTE interface,
 *                sans toucher aux modules métier.
 *
 * Les magasins (stores) gardent un cache mémoire vivant (identité préservée pour les
 * mutations en place) ET écrivent à travers le repository (write-through), puis se
 * réhydratent au démarrage : les données survivent ainsi aux redémarrages.
 */
export interface Repository<T extends { id: string }> {
  get(id: string): T | undefined;
  put(item: T): void;
  delete(id: string): void;
  all(): T[];
}

class InMemoryRepository<T extends { id: string }> implements Repository<T> {
  private readonly m = new Map<string, T>();
  get(id: string): T | undefined {
    return this.m.get(id);
  }
  put(item: T): void {
    this.m.set(item.id, item);
  }
  delete(id: string): void {
    this.m.delete(id);
  }
  all(): T[] {
    return [...this.m.values()];
  }
}

// Accès au module natif sans dépendre des types (isolé ici).
type SqliteDb = {
  exec(sql: string): void;
  prepare(sql: string): { run(...args: unknown[]): unknown; get(...args: unknown[]): unknown; all(...args: unknown[]): unknown[] };
};

let sharedDb: SqliteDb | null = null;
function getDb(): SqliteDb {
  if (sharedDb) return sharedDb;
  const require = createRequire(import.meta.url);
  const { DatabaseSync } = require('node:sqlite') as { DatabaseSync: new (path: string) => SqliteDb };
  if (config.DB_PATH !== ':memory:') mkdirSync(dirname(config.DB_PATH), { recursive: true });
  sharedDb = new DatabaseSync(config.DB_PATH);
  sharedDb.exec('PRAGMA journal_mode=WAL;');
  logger.info(`Persistance SQLite active (${config.DB_PATH})`);
  return sharedDb;
}

class SqliteRepository<T extends { id: string }> implements Repository<T> {
  constructor(private readonly table: string) {
    getDb().exec(`CREATE TABLE IF NOT EXISTS "${table}" (id TEXT PRIMARY KEY, data TEXT NOT NULL)`);
  }
  get(id: string): T | undefined {
    const row = getDb().prepare(`SELECT data FROM "${this.table}" WHERE id = ?`).get(id) as { data: string } | undefined;
    return row ? (JSON.parse(row.data) as T) : undefined;
  }
  put(item: T): void {
    getDb()
      .prepare(`INSERT INTO "${this.table}" (id, data) VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data`)
      .run(item.id, JSON.stringify(item));
  }
  delete(id: string): void {
    getDb().prepare(`DELETE FROM "${this.table}" WHERE id = ?`).run(id);
  }
  all(): T[] {
    const rows = getDb().prepare(`SELECT data FROM "${this.table}"`).all() as Array<{ data: string }>;
    return rows.map((r) => JSON.parse(r.data) as T);
  }
}

/** Fabrique un repository selon la configuration (mémoire par défaut, SQLite si activé). */
export function createRepository<T extends { id: string }>(collection: string): Repository<T> {
  return config.PERSISTENCE === 'sqlite' ? new SqliteRepository<T>(collection) : new InMemoryRepository<T>();
}
