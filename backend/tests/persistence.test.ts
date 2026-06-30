import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createRepository } from '../src/core/db/repository.js';
import { createGeoIndex } from '../src/core/geo.js';
import { DriverStore, type Driver } from '../src/modules/drivers/store.js';
import { WalletService, type LedgerEntry } from '../src/modules/wallet/service.js';
import { config } from '../src/config/index.js';

/**
 * Ce test ne vaut que sous PERSISTENCE=sqlite (script `npm run test:persist`).
 * Il prouve que les données écrites par un store sont relues par un NOUVEAU store
 * (lifecycle différent, autre instance) via le fichier SQLite → durabilité.
 */
const sqlite = config.PERSISTENCE === 'sqlite';

test('SQLite : un chauffeur survit à un nouveau cycle (réhydratation)', { skip: !sqlite }, async () => {
  const geo = createGeoIndex();
  const id = randomUUID();
  const driver: Driver = { id, name: 'Persistant', matricule: 'ORION-CI-0001', category: 'bronze', kycStatus: 'active', availability: 'online', ratingAvg: 4.8, ratingCount: 10 };

  const store1 = new DriverStore(geo, createRepository<Driver>('drivers'));
  store1.upsert(driver);

  // Nouveau store (simulating redémarrage) sur la même base.
  const store2 = new DriverStore(geo, createRepository<Driver>('drivers'));
  const reloaded = store2.get(id);
  assert.ok(reloaded, 'le chauffeur a été rechargé depuis SQLite');
  assert.equal(reloaded!.name, 'Persistant');
});

test('SQLite : le wallet (ledger) survit à un nouveau cycle', { skip: !sqlite }, async () => {
  const driverId = randomUUID();
  const w1 = new WalletService(createRepository<LedgerEntry>('wallet_ledger'));
  w1.creditRide(driverId, randomUUID(), 10000);
  const balance1 = w1.balance(driverId);
  assert.ok(balance1 > 0);

  const w2 = new WalletService(createRepository<LedgerEntry>('wallet_ledger'));
  assert.equal(w2.balance(driverId), balance1, 'le solde est rechargé depuis SQLite');
});

test('mode mémoire : test ignoré proprement', { skip: sqlite }, () => {
  assert.ok(true);
});
