import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildApp } from '../src/app.js';
import { estimatePrice, DEFAULT_PRICING, coutApproche } from '../src/modules/services/ride/pricing.js';
import { ChauffeursProches } from '../src/modules/proches/service.js';

/**
 * AVANT LA COMMANDE (comme Yango) : le client voit les véhicules libres autour de lui et sait
 * en combien de minutes le plus proche arrive ; cette approche entre dans le prix fixe.
 */
const YOP = { lat: 5.3441, lng: -4.0637 }; // Yopougon, zone industrielle
const GOLF = { lat: 5.3588, lng: -3.964 }; // Riviera Golf

test('approche : offerte jusqu’à 2 km et 5 min, puis au km et à la minute', () => {
  assert.equal(coutApproche({ km: 1.5, minutes: 4 }), 0);
  assert.equal(coutApproche({ km: 4, minutes: 10 }), 2 * 100 + 5 * 18);
  assert.equal(coutApproche(null), 0);
  const sans = estimatePrice({ origin: YOP, destination: GOLF, category: 'argent' }, {});
  const loin = estimatePrice({ origin: YOP, destination: GOLF, category: 'argent' }, { approche: { km: 9, minutes: 25 } });
  assert.ok(loin.amount > sans.amount);
  assert.equal(loin.breakdown.approche, 7 * 100 + 20 * 18);
  assert.equal(loin.breakdown.approcheMin, 25);
  const coupe = estimatePrice({ origin: YOP, destination: GOLF, category: 'argent' }, {
    approche: { km: 9, minutes: 25 }, settings: { ...DEFAULT_PRICING, approche: { ...DEFAULT_PRICING.approche, actif: false } },
  });
  assert.equal(coupe.amount, sans.amount);
});

test('temps d’approche : distance par la route et vitesse de ville', () => {
  const a = ChauffeursProches.approcheDepuis(3000);
  assert.equal(a.km, 4.1);
  assert.equal(a.minutes, 10);
  assert.equal(ChauffeursProches.approcheDepuis(50).minutes, 1);
});

test('GET /vehicules/proches : véhicules libres anonymes + approche par gamme, repris dans le devis', async (t) => {
  const { app, container: c } = await buildApp();
  t.after(() => app.close());
  const vide = await app.inject({ method: 'GET', url: `/vehicules/proches?lat=${YOP.lat}&lng=${YOP.lng}` });
  assert.equal(vide.statusCode, 200);

  const d = c.drivers.upsert({
    id: 'drv-proche-1', name: 'Chauffeur Proche', matricule: 'PR-001-CI', category: 'or',
    kycStatus: 'active', availability: 'offline', ratingAvg: 4.8, ratingCount: 3, phone: '+2250701020399',
  });
  await c.drivers.goOnline(d.id, { lat: YOP.lat + 0.01, lng: YOP.lng });
  await new Promise((r) => setTimeout(r, 2600)); // cache de 2,5 s par cellule
  const r = await app.inject({ method: 'GET', url: `/vehicules/proches?lat=${YOP.lat}&lng=${YOP.lng}` });
  const corps = r.json() as { vehicules: Array<{ id: string; lat: number; gamme: string }>; approche: Record<string, { km: number; minutes: number } | null> };
  assert.ok(corps.vehicules.some((v) => v.gamme === d.category && Math.abs(v.lat - (YOP.lat + 0.01)) < 1e-6));
  assert.ok(!JSON.stringify(corps).includes(d.id), 'aucun identifiant réel de chauffeur');
  assert.ok(corps.approche[d.category], 'approche connue pour sa gamme');

  const e = await app.inject({ method: 'POST', url: '/pricing/estimate', payload: { origin: YOP, destination: GOLF, category: d.category } });
  assert.equal(e.statusCode, 200);
  const q = (e.json() as { quote: { approche?: { minutes: number } | null } }).quote;
  assert.ok((q.approche?.minutes ?? 0) >= 1);

  await c.drivers.goOffline(d.id);
  const e2 = await app.inject({ method: 'POST', url: '/pricing/estimate', payload: { origin: YOP, destination: GOLF, category: d.category } });
  const q2 = (e2.json() as { quote: { approche?: unknown } }).quote;
  assert.equal(q2.approche, null, 'aucun chauffeur Or en ligne : le client le sait avant de commander');

  const hors = await app.inject({ method: 'GET', url: '/vehicules/proches?lat=48.85&lng=2.35' });
  assert.equal(hors.statusCode, 400);
});

test('multi-gammes : un chauffeur Or ouvert à l’Argent reçoit les deux, la console le règle', async (t) => {
  const { app, container: c } = await buildApp();
  t.after(() => app.close());
  const d = c.drivers.upsert({
    id: 'drv-multi-1', name: 'Chauffeur Multi', matricule: 'MU-001-CI', category: 'or',
    kycStatus: 'active', availability: 'offline', ratingAvg: 4.9, ratingCount: 3, phone: '+2250701020398',
  });
  await c.drivers.goOnline(d.id, { lat: YOP.lat + 0.008, lng: YOP.lng });
  const avant = await c.matching.findDriver(YOP, 'argent');
  assert.ok(!avant || avant.driverId !== d.id, 'chauffeur Or seul : pas de course Argent');

  const r = await app.inject({ method: 'POST', url: `/admin/drivers/${d.id}/attribution`, headers: { 'x-admin-token': 'orion-admin-dev' }, payload: { categories: ['argent', 'or'] } });
  assert.equal(r.statusCode, 200, r.body);
  assert.deepEqual(r.json().driver.categories.sort(), ['argent', 'or']);
  const proche = await c.proches.approche(YOP, 'argent');
  assert.ok(proche, 'il compte désormais pour l’Argent');
  const e = await app.inject({ method: 'POST', url: '/pricing/estimate', payload: { origin: YOP, destination: GOLF, category: 'argent' } });
  assert.ok((e.json() as { quote: { approche?: unknown } }).quote.approche);
  const apres = await c.matching.findDriver(YOP, 'argent');
  assert.equal(apres?.driverId, d.id, 'les courses Argent lui sont proposées');
});
