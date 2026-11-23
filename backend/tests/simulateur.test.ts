import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scryptSync } from 'node:crypto';

/**
 * SIMULATEUR DU MARCHÉ (console, PDG seul) : des chauffeurs et des clients simulés que l'app
 * cliente prend pour des vrais (carte, approche, majoration de forte demande), jamais confiés
 * au dispatch, coupés d'un geste ou à l'heure prévue.
 * La config capture process.env au chargement → comptes définis AVANT les imports.
 */
const SALT = '0a1b2c3d4e5f6071';
const HASH = scryptSync('Simu#2026', SALT, 32).toString('hex');
process.env.ADMIN_USERS = JSON.stringify([
  { username: 'pdg.sim', name: 'PDG (simulateur)', role: 'ceo', salt: SALT, hash: HASH },
  { username: 'dg.sim', name: 'DG (simulateur)', role: 'dg', salt: SALT, hash: HASH },
]);
const { buildApp } = await import('../src/app.js');
const { Simulateur } = await import('../src/modules/simulateur/service.js');

type App = Awaited<ReturnType<typeof buildApp>>['app'];
async function login(app: App, username: string) {
  const res = await app.inject({ method: 'POST', url: '/admin/login', payload: { username, password: 'Simu#2026' } });
  assert.equal(res.statusCode, 200, res.body);
  return { authorization: `Bearer ${res.json().token}` };
}

// Pharmacie Saint-Bernard (Riviera Bonoumin) → FAO, Riviera Golf.
const LIEU = { lat: 5.3672, lng: -3.9556, nom: 'Pharmacie Saint-Bernard' };
const FAO = { lat: 5.3405, lng: -3.9745 };
const autour = (n: number, metres: number, gamme: 'argent' | 'or' | 'diamant' | 'moto', prefixe: string) => Array.from({ length: n }, (_, i) => {
  const a = (2 * Math.PI * i) / n;
  return {
    id: `${prefixe}${i}`, gamme,
    lat: LIEU.lat + (metres * Math.sin(a)) / 111_320,
    lng: LIEU.lng + (metres * Math.cos(a)) / (111_320 * Math.cos(LIEU.lat * Math.PI / 180)),
  };
});
const prix = async (app: App) => {
  const r = await app.inject({ method: 'POST', url: '/pricing/estimate', payload: { origin: LIEU, destination: FAO, category: 'argent', clientId: 'client-simu' } });
  assert.equal(r.statusCode, 200, r.body);
  return (r.json() as { quote: { amount: number; breakdown: { surge: number }; approche?: { km: number } | null } }).quote;
};
const proches = async (app: App) => {
  const r = await app.inject({ method: 'GET', url: `/vehicules/proches?lat=${LIEU.lat}&lng=${LIEU.lng}` });
  assert.equal(r.statusCode, 200);
  return r.json() as { vehicules: Array<{ id: string; gamme: string }>; approche: Record<string, { km: number } | null>; marche: number };
};

test('simulateur : réservé au PDG, refus signalé pour un autre directeur', async (t) => {
  const { app } = await buildApp();
  t.after(() => app.close());
  const dg = await login(app, 'dg.sim');
  const refus = await app.inject({ method: 'GET', url: '/admin/simulateur', headers: dg });
  assert.equal(refus.statusCode, 403);
  const pdg = await login(app, 'pdg.sim');
  const ok = await app.inject({ method: 'GET', url: '/admin/simulateur', headers: pdg });
  assert.equal(ok.statusCode, 200, ok.body);
  assert.equal(ok.json().simulation.actif, false);
  // Le compte principal de la direction (super admin) y accède aussi.
  const principal = await app.inject({ method: 'GET', url: '/admin/simulateur', headers: { 'x-admin-token': 'orion-admin-dev' } });
  assert.equal(principal.statusCode, 200);
  const me = (await app.inject({ method: 'GET', url: '/admin/me', headers: dg })).json() as { permissions: string[] };
  assert.ok(!me.permissions.includes('simulateur:use'), 'la session n’apparaît pas chez le DG');
});

test('simulateur : l’app cliente voit les chauffeurs simulés, le prix suit l’offre et la demande', async (t) => {
  const { app, container: c } = await buildApp();
  t.after(() => app.close());
  const pdg = await login(app, 'pdg.sim');
  const evenements: string[] = [];
  const publier = c.realtime.publish.bind(c.realtime);
  c.realtime.publish = ((salle: string, type: string, data: unknown) => { evenements.push(type); return publier(salle, type, data); }) as typeof c.realtime.publish;

  const reference = await prix(app);
  assert.equal(reference.breakdown.surge, 1);
  assert.equal((await proches(app)).vehicules.length, 0);

  // Peu de chauffeurs (6 Argent à 2 km), beaucoup de clients (8) : préparé, pas encore actif.
  const prep = await app.inject({ method: 'PUT', url: '/admin/simulateur', headers: pdg, payload: { lieu: LIEU, chauffeurs: autour(6, 2000, 'argent', 'a'), demande: 8 } });
  assert.equal(prep.statusCode, 200, prep.body);
  const m = prep.json().mesures as { offreSimulee: number; demandeSimulee: number; surgeAvec: number; surgeSans: number; approches: Array<{ gamme: string; avec: { km: number } | null }> };
  assert.equal(m.offreSimulee, 0, 'aucun chauffeur simulé à moins de 1,2 km');
  assert.equal(m.demandeSimulee, 8);
  assert.equal(m.surgeAvec, 1.3, 'majoration plafonnée à ×1,3');
  assert.equal(m.surgeSans, 1);
  assert.ok(m.approches.find((a) => a.gamme === 'argent')?.avec, 'approche du scénario mesurée avant activation');
  assert.equal((await prix(app)).amount, reference.amount, 'tant qu’il n’est pas activé, rien ne change pour les clients');
  assert.equal((await proches(app)).vehicules.length, 0);

  const rev = (await proches(app)).marche;
  const act = await app.inject({ method: 'POST', url: '/admin/simulateur/activer', headers: pdg, payload: { dureeMin: 30 } });
  assert.equal(act.statusCode, 200, act.body);
  assert.equal(act.json().simulation.actif, true);
  assert.ok(evenements.includes('marche.maj'), 'les apps clientes sont prévenues en direct');
  const vus = await proches(app);
  assert.equal(vus.vehicules.length, 6, 'les 6 véhicules simulés sont sur la carte du client');
  assert.ok(vus.marche > rev, 'le repère du marché change : l’app refait son devis');
  assert.ok(vus.approche['argent'] && vus.approche['argent'].km > 2, 'approche du plus proche (2 km)');
  assert.ok(!JSON.stringify(vus).includes('"a0"'), 'identifiants anonymes, comme les vrais');
  const rare = await prix(app);
  assert.equal(rare.breakdown.surge, 1.3);
  assert.ok(rare.amount > reference.amount, `peu de chauffeurs : le prix monte (${reference.amount} → ${rare.amount})`);

  // Assez de chauffeurs : 12 Argent à 500 m → la majoration tombe.
  const plus = await app.inject({ method: 'PUT', url: '/admin/simulateur', headers: pdg, payload: { chauffeurs: [...autour(6, 2000, 'argent', 'a'), ...autour(12, 500, 'argent', 'b')] } });
  assert.equal(plus.statusCode, 200, plus.body);
  const nombreux = await prix(app);
  assert.equal(nombreux.breakdown.surge, 1);
  assert.ok(nombreux.amount < rare.amount, `assez de chauffeurs : le prix redescend (${rare.amount} → ${nombreux.amount})`);
  assert.ok((nombreux.approche?.km ?? 99) < 1, 'approche du chauffeur à 500 m');

  // Aperçu de la console : prix par gamme sans et avec le scénario.
  const ap = await app.inject({ method: 'POST', url: '/admin/simulateur/apercu', headers: pdg, payload: { destination: FAO } });
  assert.equal(ap.statusCode, 200, ap.body);
  const gammes = ap.json().gammes as Array<{ gamme: string; sans: { montant: number }; avec: { montant: number } }>;
  assert.deepEqual(gammes.map((g) => g.gamme), ['argent', 'or', 'diamant']);

  // Le dispatch ne connaît que les vrais chauffeurs : aucun simulé dans l'index des positions.
  assert.equal((await c.geo.nearby(LIEU, 30_000, 50)).length, 0);

  // Coupée d'un geste : tout redevient comme avant, aussitôt.
  const off = await app.inject({ method: 'POST', url: '/admin/simulateur/couper', headers: pdg });
  assert.equal(off.statusCode, 200);
  assert.equal(off.json().simulation.fin.motif, 'manuelle');
  assert.equal((await proches(app)).vehicules.length, 0);
  assert.equal((await prix(app)).amount, reference.amount);
  const journal = c.audit.list(200).map((e) => e.action);
  for (const a of ['simulateur.modifier', 'simulateur.activer', 'simulateur.couper']) assert.ok(journal.includes(a), `${a} journalisé`);
});

test('simulateur : s’arrête seul à l’heure prévue, et refuse un scénario vide', () => {
  let t = Date.parse('2026-11-23T14:00:00Z');
  const memoire = new Map<string, unknown>();
  const repo = { get: (id: string) => memoire.get(id) as never, put: (x: { id: string }) => { memoire.set(x.id, x); }, delete: (id: string) => { memoire.delete(id); }, all: () => [...memoire.values()] as never[] };
  const s = new Simulateur(repo, () => t);
  assert.throws(() => s.activer('pdg'), /lieu ou placez des chauffeurs/);
  s.modifier({ lieu: LIEU, chauffeurs: autour(3, 300, 'or', 'o'), demande: 4 }, 'pdg');
  s.activer('pdg', 10);
  assert.equal(s.offre(LIEU, 1200), 3);
  assert.equal(s.demande(LIEU), 4);
  assert.equal(s.demande({ lat: 5.30, lng: -4.02 }), 0, 'la demande simulée reste autour du lieu');
  t += 11 * 60_000;
  assert.equal(s.enVigueur(), false);
  assert.equal(s.etat().fin?.motif, 'expiree');
  assert.equal(s.offre(LIEU, 1200), 0);
  assert.equal(s.offre(LIEU, 1200, true), 3, 'le scénario reste disponible pour l’aperçu');
  // Survit à un redémarrage (repo), sans redevenir actif.
  const apres = new Simulateur(repo, () => t);
  assert.equal(apres.etat().actif, false);
  assert.equal(apres.etat().chauffeurs.length, 3);
  assert.throws(() => s.modifier({ chauffeurs: [{ id: 'x', lat: 48.85, lng: 2.35, gamme: 'argent' }] }, 'pdg'), /Côte d’Ivoire/);
});
