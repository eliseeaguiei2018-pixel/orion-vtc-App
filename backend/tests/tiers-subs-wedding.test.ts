import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FLEET, TIERS, pickCar, isTier } from '../src/modules/fleet/catalog.js';
import { SubscriptionService, PLANS } from '../src/modules/subscriptions/service.js';
import { quoteWedding, WeddingService } from '../src/modules/wedding/service.js';
import { COUNTRIES } from '../src/modules/countries/catalog.js';
import { AppError } from '../src/core/errors.js';

test('flotte : 4 niveaux avec marques attendues', () => {
  assert.deepEqual(TIERS, ['bronze', 'argent', 'or', 'diamant']);
  assert.ok(FLEET.bronze.cars.includes('Geely Galaxy E8'));
  assert.ok(FLEET.diamant.cars.includes('NIO ET9'));
  assert.ok(isTier('or') && !isTier('comfort'));
  assert.ok(FLEET.bronze.cars.includes(pickCar('bronze', 0)));
});

test('abonnement : quota quotidien consommable', () => {
  const s = new SubscriptionService();
  s.subscribe('u1', 'argent');
  assert.equal(PLANS.argent.ridesPerDay, 3);
  const a = s.consumeRide('u1'); const b = s.consumeRide('u1'); const c = s.consumeRide('u1'); const d = s.consumeRide('u1');
  assert.equal(a.covered, true);
  assert.equal(c.covered, true);
  assert.equal(d.covered, false); // quota dépassé (3/jour)
});

test('abonnement : forfait inconnu rejeté', () => {
  const s = new SubscriptionService();
  assert.throws(() => s.subscribe('u1', 'platine'), AppError);
});

test('mariage : prix croît avec le niveau et les options', () => {
  const base = quoteWedding({ tier: 'bronze', date: '2026-07-01' }).total;
  const lux = quoteWedding({ tier: 'diamant', date: '2026-07-01' }).total;
  assert.ok(lux > base);
  const withOpts = quoteWedding({ tier: 'bronze', date: '2026-07-01', options: { decoration: true, convoy: 2 } }).total;
  assert.ok(withOpts > base);
});

test('mariage : réservation enregistrée', () => {
  const w = new WeddingService();
  const q = quoteWedding({ tier: 'or', date: '2026-07-01', duration: 'fullday' });
  const r = w.reserve('u1', q);
  assert.equal(r.status, 'reserved');
  assert.equal(w.listByUser('u1').length, 1);
});

test('pays : CI actif, sous-région à venir', () => {
  const ci = COUNTRIES.find((c) => c.code === 'CI');
  assert.equal(ci?.status, 'active');
  for (const code of ['GH', 'SN', 'TG', 'BJ', 'NG']) {
    assert.equal(COUNTRIES.find((c) => c.code === code)?.status, 'coming_soon');
  }
});
