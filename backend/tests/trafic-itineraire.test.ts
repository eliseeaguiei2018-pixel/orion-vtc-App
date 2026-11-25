import { test } from 'node:test';
import assert from 'node:assert/strict';
import { POINTS_BLOCAGE, REGLES_TRAFIC_DEFAUT, periodeAbidjan, traficTrajet } from '../src/modules/geo-ci/traficItineraire.js';
import { buildApp } from '../src/app.js';

/**
 * TRAFIC SUR L'ITINÉRAIRE : heures de pointe d'Abidjan, tronçons denses ou embouteillés et
 * chaque point de blocage traversé comptent dans le prix ; la nuit et le dimanche restent fluides ;
 * le trafic mesuré ne fait que relever ; la console règle tout ; l'application calcule pareil.
 */
interface Copie { traficTrajet: typeof traficTrajet; POINTS_BLOCAGE: typeof POINTS_BLOCAGE; REGLES_TRAFIC_DEFAUT: typeof REGLES_TRAFIC_DEFAUT; brancherDensite(f: (p: { lat: number; lng: number }) => number): void }
const copie = (await import(new URL('../../frontend/src/traficItineraire.ts', import.meta.url).href)) as Copie;
const { traficServeur } = (await import(new URL('../../frontend/src/tarifServeur.ts', import.meta.url).href)) as { traficServeur(o: unknown, d: unknown, at: Date, stops?: unknown[]): { detail: ReturnType<typeof traficTrajet> } };

// 24/11/2026 est un mardi ; 28 un samedi ; 29 un dimanche (Abidjan = GMT).
const mardi = (h: number, m = 0) => new Date(Date.UTC(2026, 10, 24, h, m));
// Yopougon Siporex → Adjamé → Plateau : passe par Siporex, le Forum d'Adjamé et l'Indénié.
const YOP_PLATEAU = [
  { lat: 5.3560, lng: -4.0800 }, { lat: 5.3560, lng: -4.0750 }, { lat: 5.3500, lng: -4.0450 },
  { lat: 5.3460, lng: -4.0250 }, { lat: 5.3400, lng: -4.0200 }, { lat: 5.3236, lng: -4.0217 },
];

test('périodes d’Abidjan : pointes en semaine, samedi plus léger, dimanche calme, nuit fluide', () => {
  assert.equal(periodeAbidjan(mardi(3)), 'nuit');
  assert.equal(periodeAbidjan(mardi(7)), 'pointe');
  assert.equal(periodeAbidjan(mardi(9, 45)), 'journee');
  assert.equal(periodeAbidjan(mardi(12, 30)), 'midi');
  assert.equal(periodeAbidjan(mardi(18)), 'pointe');
  assert.equal(periodeAbidjan(mardi(20, 30)), 'soiree');
  assert.equal(periodeAbidjan(mardi(22)), 'nuit');
  assert.equal(periodeAbidjan(new Date(Date.UTC(2026, 10, 28, 11))), 'journee');
  assert.equal(periodeAbidjan(new Date(Date.UTC(2026, 10, 29, 11))), 'calme');
});

test('chaque embouteillage de l’itinéraire compte, aux heures de pointe seulement', () => {
  const nuit = traficTrajet(YOP_PLATEAU, mardi(3));
  const matinee = traficTrajet(YOP_PLATEAU, mardi(11));
  const pointe = traficTrajet(YOP_PLATEAU, mardi(18));
  const dimanche = traficTrajet(YOP_PLATEAU, new Date(Date.UTC(2026, 10, 29, 11)));
  assert.equal(nuit.pct, 0);
  assert.equal(dimanche.pct, 0);
  assert.deepEqual(pointe.bouchons, ['Carrefour Siporex', 'Forum des marchés d’Adjamé', 'Carrefour de l’Indénié']);
  assert.equal(pointe.niveau, 'jam');
  assert.ok(pointe.pct > matinee.pct + 10, `pointe ${pointe.pct} % > journée ${matinee.pct} %`);
  assert.ok(pointe.pct <= REGLES_TRAFIC_DEFAUT.plafondPct);
  // Le même trajet hors des points de blocage, à la même heure, coûte moins.
  const ailleurs = traficTrajet([{ lat: 5.4400, lng: -4.0800 }, { lat: 5.4400, lng: -4.0400 }], mardi(18));
  assert.equal(ailleurs.bouchons.length, 0);
  assert.ok(ailleurs.pct < pointe.pct);
});

test('le trafic mesuré sur la route ne fait que relever le prix', () => {
  const base = traficTrajet(YOP_PLATEAU, mardi(11));
  const embouteille = traficTrajet(YOP_PLATEAU, mardi(11), REGLES_TRAFIC_DEFAUT, { avecTraficS: 1800, sansTraficS: 1000 });
  const fluide = traficTrajet(YOP_PLATEAU, mardi(11), REGLES_TRAFIC_DEFAUT, { avecTraficS: 1000, sansTraficS: 1000 });
  assert.equal(embouteille.source, 'mesure');
  assert.ok(embouteille.pct > base.pct);
  assert.equal(fluide.pct, base.pct, 'une route annoncée fluide ne baisse rien');
  assert.equal(traficTrajet(YOP_PLATEAU, mardi(11), REGLES_TRAFIC_DEFAUT, { avecTraficS: 9000, sansTraficS: 1000 }).pct, REGLES_TRAFIC_DEFAUT.plafondPct, 'plafonné');
});

test('l’application calcule le trafic comme le serveur (mêmes points de blocage, mêmes résultats)', () => {
  assert.deepEqual(copie.POINTS_BLOCAGE, POINTS_BLOCAGE);
  assert.deepEqual(copie.REGLES_TRAFIC_DEFAUT, REGLES_TRAFIC_DEFAUT);
  for (const h of [3, 7, 11, 12, 18, 20, 23]) {
    for (const jour of [24, 28, 29]) {
      const at = new Date(Date.UTC(2026, 10, jour, h, 15));
      const serveur = traficTrajet(YOP_PLATEAU, at);
      const appli = traficServeur(YOP_PLATEAU[0], YOP_PLATEAU[YOP_PLATEAU.length - 1], at, YOP_PLATEAU.slice(1, -1)).detail;
      assert.deepEqual(appli, serveur, `${jour}/11 ${h} h`);
    }
  }
});

test('console : les pourcentages du trafic se règlent et s’appliquent aussitôt', async (t) => {
  const { app } = await buildApp();
  t.after(() => app.close());
  const H = { 'x-admin-token': 'orion-admin-dev' };
  const r = await app.inject({ method: 'PUT', url: '/admin/pricing', headers: H, payload: { trafic: { densePct: 0, embouteillagePct: 0, parBouchonPct: 0, pointeSoir: ['17:00', '19:30'] } } });
  assert.equal(r.statusCode, 200, r.body);
  assert.equal(r.json().pricing.trafic.pointeSoir[1], '19:30');
  assert.equal(r.json().pricing.trafic.plafondPct, REGLES_TRAFIC_DEFAUT.plafondPct, 'les autres réglages restent');
  const devis = await app.inject({ method: 'POST', url: '/pricing/estimate', payload: { origin: YOP_PLATEAU[0], destination: YOP_PLATEAU[5], category: 'argent', clientId: 'trafic-console' } });
  assert.equal(devis.json().quote.breakdown.trafic.pct, 0, 'sans pourcentage, le trafic n’ajoute rien');
  const cfg = await app.inject({ method: 'GET', url: '/config' });
  assert.equal(cfg.json().prix.trafic.pointeSoir[1], '19:30', 'les applications reçoivent les règles');
  const mauvais = await app.inject({ method: 'PUT', url: '/admin/pricing', headers: H, payload: { trafic: { pointeMatin: ['6h30', '9h'] } } });
  assert.equal(mauvais.statusCode, 400);
});
