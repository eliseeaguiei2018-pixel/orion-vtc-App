import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FLEET, TIERS, pickCar, isTier, normaliserGamme } from '../src/modules/fleet/catalog.js';
import { SubscriptionService, PLANS } from '../src/modules/subscriptions/service.js';
import { quoteWedding, WeddingService } from '../src/modules/wedding/service.js';
import { COUNTRIES } from '../src/modules/countries/catalog.js';
import { AppError } from '../src/core/errors.js';

test('flotte : 3 gammes (Argent, Or, Diamant), le Bronze a rejoint l’Argent', () => {
  assert.deepEqual(TIERS, ['argent', 'or', 'diamant']);
  assert.ok(FLEET.argent.cars.includes('Geely Galaxy E8'), 'les véhicules Bronze roulent en Argent');
  assert.ok(FLEET.diamant.cars.includes('NIO ET9'));
  assert.ok(isTier('or') && !isTier('comfort') && !isTier('bronze'));
  assert.ok(FLEET.argent.cars.includes(pickCar('argent', 0)));
  assert.equal(normaliserGamme('bronze'), 'argent');
  // Mariage : les tarifs ont glissé d'une gamme (60 000 → 110 000 → 190 000 F / jour).
  assert.deepEqual(TIERS.map((t) => FLEET[t].weddingDayPrice), [60_000, 110_000, 190_000]);
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
  const base = quoteWedding({ tier: 'argent', date: '2026-07-01' }).total;
  const lux = quoteWedding({ tier: 'diamant', date: '2026-07-01' }).total;
  assert.ok(lux > base);
  const withOpts = quoteWedding({ tier: 'argent', date: '2026-07-01', options: { decoration: true, convoy: 2 } }).total;
  assert.ok(withOpts > base);
});

test('mariage : réservation enregistrée', () => {
  const w = new WeddingService();
  const q = quoteWedding({ tier: 'or', date: '2026-07-01', duration: 'fullday' });
  const r = w.reserve('u1', q);
  assert.equal(r.status, 'reserved');
  assert.equal(w.listByUser('u1').length, 1);
});

test('pays : seule la Côte d’Ivoire est publiée, les autres pays restent en réserve', async () => {
  const ci = COUNTRIES.find((c) => c.code === 'CI');
  assert.equal(ci?.status, 'active');
  // Gardés dans le catalogue pour plus tard, jamais actifs.
  for (const code of ['GH', 'SN', 'TG', 'BJ', 'NG']) {
    assert.equal(COUNTRIES.find((c) => c.code === code)?.status, 'coming_soon');
  }
  // La route publique ne montre que les pays ouverts.
  const { buildApp } = await import('../src/app.js');
  const { app } = await buildApp();
  const res = await app.inject({ method: 'GET', url: '/countries' });
  await app.close();
  assert.deepEqual(res.json().countries.map((c: { code: string }) => c.code), ['CI']);
  assert.deepEqual(res.json().active, ['CI']);
  assert.ok(!/Ghana|Sénégal|Togo|Bénin|Nigeria/.test(res.body), 'aucun autre pays dans la réponse');
});
