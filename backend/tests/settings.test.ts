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

  const upd = await app.inject({ method: 'PUT', url: '/admin/pricing', headers: AUTH, payload: { baseFare: 100, perKm: 40 } });
  assert.equal(upd.statusCode, 200);
  assert.equal(upd.json().pricing.baseFare, 100);

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

test('gammes : majoration en pour cent réglable depuis la console ; les anciens suppléments enregistrés disparaissent', async (t) => {
  const { app } = await buildApp();
  t.after(() => app.close());
  const { estimatePrice, DEFAULT_PRICING } = await import('../src/modules/services/ride/pricing.js');
  const prix = (settings: never, dest = destination) => (['argent', 'or', 'diamant'] as const).map((category) => estimatePrice({ origin, destination: dest, category }, { settings }).amount) as [number, number, number];
  // Réglage d'origine : Or + 5 %, Diamant + 15 %, et plus aucun supplément fixe ni écart borné.
  const defaut = (await app.inject({ method: 'GET', url: '/admin/pricing', headers: AUTH })).json().pricing;
  assert.deepEqual(defaut.majorationsPct, { argent: 0, or: 5, diamant: 15 });
  for (const champ of ['supplements', 'ecarts', 'ecartKm']) assert.equal(champ in defaut, false, champ);
  // La console change les pourcentages ; l'Argent reste la référence, quoi qu'on envoie.
  const upd = await app.inject({ method: 'PUT', url: '/admin/pricing', headers: AUTH, payload: { majorationsPct: { or: 10, diamant: 30 }, ecarts: { or: { min: 150 } }, supplements: { or: 700 } } });
  assert.equal(upd.statusCode, 200, upd.body);
  assert.deepEqual(upd.json().pricing.majorationsPct, { argent: 0, or: 10, diamant: 30 });
  for (const champ of ['supplements', 'ecarts', 'ecartKm']) assert.equal(champ in upd.json().pricing, false, champ);
  // Un long trajet qui reste dans le district (Anyama) : la grille d'Abidjan s'applique.
  const loin = { lat: 5.4946, lng: -4.0517 };
  const [a, o, d] = prix(upd.json().pricing as never, loin);
  assert.equal(o - a, Math.round((a * 0.1) / 50) * 50); assert.equal(d - a, Math.round((a * 0.3) / 50) * 50);
  // Une gamme ramenée à 0 % coûte le prix de l'Argent ; une valeur négative est refusée.
  const zero = (await app.inject({ method: 'PUT', url: '/admin/pricing', headers: AUTH, payload: { majorationsPct: { or: 0 } } })).json().pricing;
  const [a0, o0, d0] = prix(zero as never, loin);
  assert.equal(o0, a0); assert.ok(d0 > a0);
  assert.equal((await app.inject({ method: 'PUT', url: '/admin/pricing', headers: AUTH, payload: { majorationsPct: { or: -5 } } })).statusCode, 400);
  const csv = (await app.inject({ method: 'GET', url: '/admin/pricing/matrix.csv', headers: AUTH })).body;
  assert.match(csv.split('\n')[0]!, /multiplicateur,majoration_gamme_pct,base_fcfa/);

  // Enregistrements laissés par les deux anciens modèles : supplément fixe, puis écarts bornés.
  const { SettingsService } = await import('../src/modules/settings/service.js');
  const { majorationsPct: _m, ...sansMajoration } = DEFAULT_PRICING;
  for (const reste of [
    { supplements: { argent: 0, or: 700, diamant: 1700 } },
    { ecarts: { argent: { min: 0, max: 0 }, or: { min: 100, max: 200 }, diamant: { min: 500, max: 1000 } }, ecartKm: { court: 2, long: 20 } },
  ]) {
    let stocke: Record<string, unknown> = { id: 'pricing', ...sansMajoration, perKm: 145, ...reste };
    const depot = { get: () => stocke, put: (r: Record<string, unknown>) => { stocke = r; return r; }, list: () => [stocke], delete: () => true };
    const p = new SettingsService(depot as never).getPricing() as unknown as Record<string, unknown>;
    for (const champ of ['supplements', 'ecarts', 'ecartKm']) {
      assert.equal(champ in p, false, `${champ} retiré des réglages`);
      assert.equal(champ in stocke, false, `${champ} retiré de l’enregistrement`);
    }
    assert.deepEqual(p.majorationsPct, DEFAULT_PRICING.majorationsPct, 'les gammes reprennent la majoration en pour cent');
    assert.deepEqual(stocke.majorationsPct, DEFAULT_PRICING.majorationsPct);
    assert.equal(p.perKm, 145, 'les autres réglages de la console sont gardés');
  }
});

test('hors Abidjan, péages et mise à disposition : réglables depuis la console, appliqués au devis', async (t) => {
  const { app } = await buildApp();
  t.after(() => app.close());
  const defaut = (await app.inject({ method: 'GET', url: '/admin/pricing', headers: AUTH })).json().pricing;
  assert.equal(defaut.insuranceRate, 0.04, 'ORION Assurance : 4 %');
  assert.deepEqual(defaut.majorationsPctHorsAbidjan, { argent: 0, or: 10, diamant: 20 });
  assert.deepEqual(defaut.miseADisposition, { tarifHeure: 5000, minHeures: 2, maxHeures: 12 });
  assert.deepEqual(defaut.peages.map((p: { id: string; montant: number; pont: boolean }) => [p.id, p.montant, p.pont]),
    [['hkb', 500, true], ['pont4', 500, true], ['bassam', 500, false], ['attinguie', 500, false], ['thomasset', 500, false]]);

  const upd = await app.inject({ method: 'PUT', url: '/admin/pricing', headers: AUTH, payload: {
    majorationsPctHorsAbidjan: { argent: 7, or: 12, diamant: 25 },
    peages: [{ id: 'hkb', montant: 800 }, { id: 'inconnu', montant: 9999 }],
    miseADisposition: { tarifHeure: 6000, minHeures: 3, maxHeures: 10 },
  } });
  assert.equal(upd.statusCode, 200, upd.body);
  const p = upd.json().pricing;
  assert.deepEqual(p.majorationsPctHorsAbidjan, { argent: 0, or: 12, diamant: 25 }, 'l’Argent reste la référence');
  assert.equal(p.peages.find((x: { id: string }) => x.id === 'hkb').montant, 800);
  assert.equal(p.peages.length, 5, 'un poste inconnu n’est pas créé');
  assert.deepEqual(p.miseADisposition, { tarifHeure: 6000, minHeures: 3, maxHeures: 10 });
  assert.equal((await app.inject({ method: 'PUT', url: '/admin/pricing', headers: AUTH, payload: { miseADisposition: { tarifHeure: -1 } } })).statusCode, 400);

  const devis = async (payload: Record<string, unknown>) => {
    const r = await app.inject({ method: 'POST', url: '/pricing/estimate', payload: { clientId: 'console-test', ...payload } });
    assert.equal(r.statusCode, 200, r.body);
    return r.json().quote as { amount: number; breakdown: Record<string, number> };
  };
  // Péage choisi : le montant réglé dans la console, hors majoration de gamme.
  const avecPont = await devis({ origin, destination, category: 'or', itineraire: 'peage', peages: ['hkb'] });
  const sansPont = await devis({ origin, destination, category: 'or', itineraire: 'normal', peages: ['hkb'] });
  assert.equal(avecPont.breakdown.peage, 800);
  assert.equal(avecPont.amount - sansPont.amount, 800);
  // Mise à disposition : 3 h minimum au nouveau tarif horaire.
  const dispo = await devis({ origin, destination: origin, category: 'argent', miseADisposition: { heures: 2 } });
  assert.equal(dispo.breakdown.heures, 3);
  assert.equal(dispo.amount, 18_000);
  // Hors du district : la grille hors Abidjan réglée dans la console.
  const bassam = { lat: 5.2118, lng: -3.7388 };
  const [a, o, d] = await Promise.all((['argent', 'or', 'diamant'] as const).map(async (category) => (await devis({ origin, destination: bassam, category })).amount)) as [number, number, number];
  assert.equal(o - a, Math.max(50, Math.round((a * 0.12) / 50) * 50));
  assert.equal(d - a, Math.max(o - a + 50, Math.round((a * 0.25) / 50) * 50));

  // Un enregistrement d'avant (assurance à 2 %, sans les nouveaux réglages) passe à 4 % et reçoit les valeurs par défaut.
  const { SettingsService } = await import('../src/modules/settings/service.js');
  const { DEFAULT_PRICING } = await import('../src/modules/services/ride/pricing.js');
  const { majorationsPctHorsAbidjan: _h, peages: _p, miseADisposition: _m, ...ancien } = DEFAULT_PRICING;
  let stocke: Record<string, unknown> = { id: 'pricing', ...ancien, insuranceRate: 0.02 };
  const depot = { get: () => stocke, put: (r: Record<string, unknown>) => { stocke = r; return r; }, list: () => [stocke], delete: () => true };
  const migre = new SettingsService(depot as never).getPricing();
  assert.equal(migre.insuranceRate, 0.04);
  assert.deepEqual(migre.majorationsPctHorsAbidjan, DEFAULT_PRICING.majorationsPctHorsAbidjan);
  assert.equal(migre.peages.length, 5);
  assert.deepEqual(migre.miseADisposition, DEFAULT_PRICING.miseADisposition);
  assert.equal(stocke.insuranceRate, 0.04, 'la migration est enregistrée');
});
