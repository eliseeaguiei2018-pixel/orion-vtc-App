import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildApp } from '../src/app.js';

const AUTH = { 'x-admin-token': 'orion-admin-dev' };
const origin = { lat: 5.3236, lng: -4.0217 };
const destination = { lat: 5.3599, lng: -3.9876 };

test('admin/me : super_admin a la permission pricing:write', async (t) => {
  const { app } = await buildApp();
  t.after(() => app.close());
  const me = await app.inject({ method: 'GET', url: '/admin/me', headers: AUTH });
  assert.equal(me.statusCode, 200);
  assert.equal(me.json().role, 'super_admin');
  assert.ok(me.json().permissions.includes('pricing:write'));
});

test('tarification pilotable : baisser baseFare/perKm réduit le prix des courses', async (t) => {
  const { app } = await buildApp();
  t.after(() => app.close());

  const before = await app.inject({ method: 'POST', url: '/pricing/estimate', payload: { origin, destination, category: 'argent' } });
  const priceBefore = before.json().quote.amount as number;

  const upd = await app.inject({ method: 'PUT', url: '/admin/pricing', headers: AUTH, payload: { baseFare: 150, perKm: 80 } });
  assert.equal(upd.statusCode, 200);
  assert.equal(upd.json().pricing.baseFare, 150);

  const after = await app.inject({ method: 'POST', url: '/pricing/estimate', payload: { origin, destination, category: 'argent' } });
  const priceAfter = after.json().quote.amount as number;
  assert.ok(priceAfter < priceBefore, `attendu ${priceAfter} < ${priceBefore}`);
});

test('tarification : augmenter les prix fonctionne aussi', async (t) => {
  const { app } = await buildApp();
  t.after(() => app.close());
  const before = (await app.inject({ method: 'POST', url: '/pricing/estimate', payload: { origin, destination, category: 'or' } })).json().quote.amount as number;
  await app.inject({ method: 'PUT', url: '/admin/pricing', headers: AUTH, payload: { perKm: 400 } });
  const after = (await app.inject({ method: 'POST', url: '/pricing/estimate', payload: { origin, destination, category: 'or' } })).json().quote.amount as number;
  assert.ok(after > before);
});

test('RBAC : jeton inconnu refusé (401)', async (t) => {
  const { app } = await buildApp();
  t.after(() => app.close());
  const res = await app.inject({ method: 'GET', url: '/admin/pricing', headers: { 'x-admin-token': 'mauvais' } });
  assert.equal(res.statusCode, 401);
});

test('écarts entre gammes : réglables depuis la console, bornés et cohérents', async (t) => {
  const { app } = await buildApp();
  t.after(() => app.close());
  const { estimatePrice } = await import('../src/modules/services/ride/pricing.js');
  // Réglage d'origine : Or = Argent + 100 à 200 F, Diamant = Or + 500 à 1 000 F.
  const defaut = (await app.inject({ method: 'GET', url: '/admin/pricing', headers: AUTH })).json().pricing;
  assert.deepEqual(defaut.ecarts, { argent: { min: 0, max: 0 }, or: { min: 100, max: 200 }, diamant: { min: 500, max: 1000 } });
  assert.deepEqual(defaut.ecartKm, { court: 2, long: 20 });
  assert.equal('supplements' in defaut, false);
  // Un écart fixe (minimum = maximum) s'applique tel quel, quel que soit le trajet.
  const upd = await app.inject({ method: 'PUT', url: '/admin/pricing', headers: AUTH, payload: { ecarts: { or: { min: 150, max: 150 }, diamant: { min: 700, max: 700 } } } });
  assert.equal(upd.statusCode, 200, upd.body);
  // (calcul direct avec les réglages rendus : deux devis successifs du serveur peuvent
  // différer par la majoration de demande, qui n'a rien à voir avec les gammes)
  const settings = upd.json().pricing;
  for (const dest of [destination, { lat: 5.2118, lng: -3.7388 }]) {
    const [a, o, d] = (['argent', 'or', 'diamant'] as const).map((category) => estimatePrice({ origin, destination: dest, category }, { settings }).amount);
    assert.equal(o! - a!, 150); assert.equal(d! - o!, 700);
  }
  // Un maximum inférieur au minimum est ramené au minimum ; un trajet long plus court que le trajet court est corrigé.
  const corrige = (await app.inject({ method: 'PUT', url: '/admin/pricing', headers: AUTH, payload: { ecarts: { or: { min: 300, max: 100 } }, ecartKm: { court: 10, long: 5 } } })).json().pricing;
  assert.deepEqual(corrige.ecarts.or, { min: 300, max: 300 });
  assert.deepEqual(corrige.ecartKm, { court: 10, long: 11 });
  assert.deepEqual(corrige.ecarts.diamant, { min: 700, max: 700 }, 'la gamme non envoyée garde son réglage');
  // Valeurs refusées : un écart négatif.
  const refuse = await app.inject({ method: 'PUT', url: '/admin/pricing', headers: AUTH, payload: { ecarts: { or: { min: -50 } } } });
  assert.equal(refuse.statusCode, 400);
  // La matrice tarifaire exportée donne le supplément sur un trajet court et sur un trajet long.
  const csv = (await app.inject({ method: 'GET', url: '/admin/pricing/matrix.csv', headers: AUTH })).body;
  assert.match(csv.split('\n')[0]!, /supplement_gamme_trajet_court,supplement_gamme_trajet_long/);
});

test('tarifs enregistrés avec l’ancien supplément fixe : repris avec les nouveaux écarts', async () => {
  const { SettingsService } = await import('../src/modules/settings/service.js');
  const { DEFAULT_PRICING } = await import('../src/modules/services/ride/pricing.js');
  // Enregistrement tel que la console l'avait laissé : Or +700 F, Diamant +1 700 F, prix au km modifié.
  const { ecarts: _e, ecartKm: _k, ...ancien } = DEFAULT_PRICING;
  let stocke: Record<string, unknown> = { id: 'pricing', ...ancien, perKm: 145, supplements: { argent: 0, or: 700, diamant: 1700 } };
  const depot = { get: () => stocke, put: (r: Record<string, unknown>) => { stocke = r; return r; }, list: () => [stocke], delete: () => true };
  const service = new SettingsService(depot as never);
  const p = service.getPricing() as unknown as Record<string, unknown>;
  assert.deepEqual(p.ecarts, DEFAULT_PRICING.ecarts);
  assert.deepEqual(p.ecartKm, DEFAULT_PRICING.ecartKm);
  assert.equal('supplements' in p, false, 'l’ancien supplément a disparu');
  assert.equal(p.perKm, 145, 'les autres réglages de la console sont gardés');
  assert.equal('supplements' in stocke, false, 'et l’enregistrement est mis à jour');
  assert.deepEqual(stocke.ecarts, DEFAULT_PRICING.ecarts);
});
