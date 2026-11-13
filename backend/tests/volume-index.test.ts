import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildApp } from '../src/app.js';
import { IndexChrono } from '../src/core/chrono.js';
import type { Ride } from '../src/modules/rides/store.js';
import type { Quote } from '../src/modules/services/types.js';

/**
 * VOLUME : les index et les cumuls qui permettent à la console et au tableau de bord de
 * rester rapides avec des millions de courses et de mouvements financiers.
 *
 * Un cumul tenu au fil de l'eau est rapide, mais il n'a de valeur que s'il dit EXACTEMENT
 * ce que dirait un recomptage complet. Ces tests comparent chaque raccourci à un calcul
 * brut sur toutes les données, y compris quand une course change d'état après coup.
 */
const AUTH = { 'x-admin-token': 'orion-admin-dev' };
const JOUR = 86_400_000;

test('IndexChrono : fenêtres, ajouts dans le désordre et égalités', () => {
  const ix = new IndexChrono<string>();
  ix.ajouter(10, 'a');
  ix.ajouter(30, 'c');
  ix.ajouter(20, 'b');
  ix.ajouter(20, 'b2'); // égalité : rangé APRÈS l'élément de même date
  ix.ajouter(5, 'z');
  assert.deepEqual(ix.tous(), ['z', 'a', 'b', 'b2', 'c']);
  assert.deepEqual(ix.depuis(20), ['b', 'b2', 'c']);
  assert.deepEqual(ix.entre(10, 30), ['a', 'b', 'b2']);
  assert.equal(ix.compterDepuis(11), 3);
  assert.deepEqual(ix.recents(2), ['c', 'b2']);
  assert.deepEqual(ix.recents(2, 2), ['b', 'a']);
  const vus: string[] = [];
  ix.parcourirRecents((x) => { vus.push(x); return vus.length < 3; });
  assert.deepEqual(vus, ['c', 'b2', 'b']);
});

/** Fabrique une course historique, datée et dans l'état voulu. */
function course(i: number, il_y_a: number, status: Ride['status'], opts: { cash?: boolean; livraison?: boolean; abonnement?: number } = {}): Ride {
  const cree = Date.now() - il_y_a;
  const at = (d: number) => new Date(cree + d).toISOString();
  const montant = 1000 + i * 37;
  const events: Ride['events'] = [{ type: 'created', at: at(0) }, { type: 'accepted', at: at(10_000) }];
  if (['completed', 'paid', 'rated'].includes(status)) events.push({ type: 'completed', at: at(600_000) });
  if (status === 'paid' || status === 'rated') events.push({ type: 'paid', at: at(660_000) });
  if (status === 'rated') events.push({ type: 'rated', at: at(700_000), payload: { stars: 5 } });
  if (status === 'cancelled') events.push({ type: 'cancelled', at: at(60_000) });
  return {
    id: `vi-${i}`, clientId: `vi-cli-${i % 7}`, driverId: `vi-drv-${i % 3}`,
    serviceType: opts.livraison ? 'delivery' : 'course', status,
    origin: { lat: 5.33, lng: -4.02 }, destination: { lat: 5.36, lng: -3.99 },
    quote: {
      lockId: `vi${i}`, amount: montant, currency: 'XOF', distanceMeters: 3000, etaSeconds: 600, trafficLevel: 'fluide',
      origin: { lat: 5.33, lng: -4.02 }, destination: { lat: 5.36, lng: -3.99 }, serviceType: opts.livraison ? 'delivery' : 'ride',
      breakdown: { base: 300, distance: 600, time: 100, surge: 1, traffic: 0, discount: 0, subtotal: montant, tva: Math.round(montant * 0.18), fee: Math.round(montant * 0.2), insurance: 0 },
    } as unknown as Quote,
    events,
    paymentMethod: opts.cash ? 'cash' : 'wave',
    subscription: opts.abonnement ? { montantCouvert: opts.abonnement, remise: 0 } : undefined,
    createdAt: at(0),
  } as unknown as Ride;
}

/** Recomptage brut : toutes les courses, sans aucun index. Paiements datés du paiement. */
function recompter(toutes: Ride[], seuil: number) {
  const r = { gmv: 0, tva: 0, commission: 0, dettes: 0, encaisse: 0, especes: 0, nombre: 0 };
  for (const x of toutes) {
    if (x.status !== 'paid' && x.status !== 'rated') continue;
    const paye = Date.parse(x.events.find((e) => e.type === 'paid')!.at);
    if (paye < seuil) continue;
    r.gmv += x.quote.amount;
    r.tva += x.quote.breakdown.tva ?? 0;
    r.commission += x.quote.breakdown.fee ?? 0;
    if (x.paymentMethod === 'cash') r.dettes += x.quote.breakdown.fee ?? 0;
    const enc = Math.max(0, x.quote.amount - (x.subscription?.montantCouvert ?? 0) - (x.subscription?.remise ?? 0));
    if (enc <= 0) continue;
    r.nombre += 1;
    if (x.paymentMethod === 'cash') r.especes += enc; else r.encaisse += enc;
  }
  return r;
}

test('Cumuls financiers = recomptage brut, y compris après changement d’état', async (t) => {
  const { app, container } = await buildApp();
  t.after(() => app.close());
  const statuts: Ride['status'][] = ['rated', 'paid', 'completed', 'cancelled', 'rated', 'paid'];
  const creees: Ride[] = [];
  // 400 courses sur 60 jours, dont des espèces, des livraisons et des abonnements.
  for (let i = 0; i < 400; i += 1) {
    const r = course(i, (i / 400) * 60 * JOUR + 3_600_000, statuts[i % statuts.length]!, {
      cash: i % 4 === 0, livraison: i % 5 === 0, abonnement: i % 11 === 0 ? 400 : i % 13 === 0 ? 99_999 : 0,
    });
    container.rides.save(r);
    creees.push(r);
  }
  // Une course terminée est PAYÉE après coup : les cumuls doivent suivre.
  const reprise = creees.find((x) => x.status === 'completed')!;
  reprise.status = 'paid';
  reprise.events.push({ type: 'paid', at: new Date().toISOString() });
  container.rides.save(reprise);

  for (const jours of [1, 7, 30, 45]) {
    const seuil = Date.now() - jours * JOUR;
    const brut = recompter(creees, seuil);
    const c = container.executive.consolidation(jours);
    assert.equal(c.gmvParActivite.mobilite, brut.gmv, `GMV sur ${jours} j`);
    assert.equal(c.tvaCollectee, brut.tva, `TVA sur ${jours} j`);
    assert.equal(c.revenu, brut.commission, `revenu (commissions) sur ${jours} j`);
    assert.equal(c.dettesEspeces, brut.dettes, `dettes espèces sur ${jours} j`);
    assert.equal(c.especesChauffeurs, brut.especes, `espèces chauffeurs sur ${jours} j`);
    assert.equal(c.entrees, brut.encaisse, `entrées en caisse sur ${jours} j`);
    assert.equal((c.parCategorie.course?.nombre ?? 0) + (c.parCategorie.livraison?.nombre ?? 0), brut.nombre, `nombre de paiements sur ${jours} j`);

    // Le grand livre, page par page, redonne exactement le livre complet, dans l'ordre.
    const complet = container.executive.grandLivre({ depuisJours: jours });
    const pages: string[] = [];
    let p = 1;
    let page;
    do {
      page = container.executive.pageLivre({ depuisJours: jours, page: p, limit: 37 });
      pages.push(...page.mouvements.map((m) => m.id));
      p += 1;
    } while (p <= page.pages);
    assert.deepEqual(pages, complet.map((m) => m.id), `pages du livre sur ${jours} j`);
    assert.equal(page.total, complet.length, `total du livre sur ${jours} j`);
    assert.equal(page.entrees, complet.filter((m) => m.sens === 'entree' && m.enCaisse).reduce((n, m) => n + m.montant, 0));

    // Filtre « livraison » : mêmes mouvements que le livre complet filtré.
    const livraisons = container.executive.pageLivre({ depuisJours: jours, categorie: 'livraison', page: 1, limit: 1000 });
    assert.deepEqual(livraisons.mouvements.map((m) => m.id), complet.filter((m) => m.categorie === 'livraison').map((m) => m.id));
    assert.equal(livraisons.total, complet.filter((m) => m.categorie === 'livraison').length);

    // L'export ligne à ligne suit le même ordre.
    assert.deepEqual([...container.executive.fluxLivre(jours)].map((m) => m.id), complet.map((m) => m.id));
  }

  // Série de trésorerie : la somme des jours = les entrées en caisse des courses.
  const serie = container.executive.serie(30);
  const debut = Date.parse(`${serie[0]!.date}T00:00:00Z`);
  assert.equal(serie.reduce((n, j) => n + j.entrees, 0), recompter(creees, debut).encaisse);

  // Par statut, actives, par chauffeur : identiques au recomptage.
  const parStatut = new Map<string, number>();
  for (const r of creees) parStatut.set(r.status, (parStatut.get(r.status) ?? 0) + 1);
  for (const [s, n] of parStatut) assert.equal(container.rides.cumuls.parStatut[s] ?? 0, n, `statut ${s}`);
  assert.deepEqual(container.rides.listByDriver('vi-drv-1').map((r) => r.id),
    creees.filter((r) => r.driverId === 'vi-drv-1').sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)).map((r) => r.id));

  // Et la route de la console renvoie la même page.
  const route = await app.inject({ method: 'GET', url: '/admin/executive/livre?days=30&page=2&limit=25', headers: AUTH });
  assert.equal(route.statusCode, 200);
  assert.deepEqual(route.json().mouvements.map((m: { id: string }) => m.id),
    container.executive.grandLivre({ depuisJours: 30 }).slice(25, 50).map((m) => m.id));
});

test('Exports CSV écrits par tranches : en-tête, toutes les lignes, aucune perte entre tranches', async (t) => {
  const { app, container } = await buildApp();
  t.after(() => app.close());
  // 4 500 courses payées aujourd'hui : plus de deux tranches de 2 000 lignes.
  for (let i = 0; i < 4500; i += 1) container.rides.save(course(i, 3_600_000 + i * 1000, 'paid'));
  const csv = await app.inject({ method: 'GET', url: '/admin/executive/livre.csv?days=2', headers: AUTH });
  assert.equal(csv.statusCode, 200);
  const lignes = csv.body.split('\n');
  assert.equal(lignes[0], 'date;sens;categorie;libelle;montant_fcfa;en_caisse;contrepartie;reference;statut');
  assert.equal(lignes.length, 1 + 4500);
  assert.ok(lignes.every((l) => l.split(';').length === 9), 'chaque ligne est complète');

  const courses = await app.inject({ method: 'GET', url: '/admin/rides.csv?jours=2', headers: AUTH });
  const lc = courses.body.split('\n');
  assert.match(lc[0]!, /^id,clientId,driverName/);
  assert.equal(lc.length, 1 + 4500);
  assert.equal(new Set(lc.slice(1).map((l) => l.split(',')[0])).size, 4500, 'aucune course dupliquée ni perdue');

  // Compression : la même réponse, beaucoup plus légère sur le réseau.
  const brut = await app.inject({ method: 'GET', url: '/admin/rides?limit=200', headers: AUTH });
  const br = await app.inject({ method: 'GET', url: '/admin/rides?limit=200', headers: { ...AUTH, 'accept-encoding': 'br' } });
  assert.equal(br.headers['content-encoding'], 'br');
  assert.ok(br.rawPayload.length * 4 < brut.rawPayload.length, `compressé ${br.rawPayload.length} o contre ${brut.rawPayload.length} o`);
});

test('Portefeuilles, clients et alertes : index = recomptage', async (t) => {
  const { app, container } = await buildApp();
  t.after(() => app.close());
  const w = container.wallet;
  const maintenant = Date.now();
  for (let i = 0; i < 300; i += 1) {
    const at = new Date(maintenant - (300 - i) * 3_600_000).toISOString();
    w.importer({ driverId: `w-${i % 5}`, type: 'ride_earning', amount: 800 + i, rideId: `r${i}`, note: 'Course', at });
    w.importer({ driverId: `w-${i % 5}`, type: 'commission', amount: -(200 + i), rideId: `r${i}`, note: 'Commission', at });
    if (i % 50 === 0) w.importer({ driverId: `w-${i % 5}`, type: 'payout', amount: -1000, note: 'Retrait', at });
  }
  for (let k = 0; k < 5; k += 1) {
    // Le gain de course est déjà net : la commission est journalisée pour mémoire, hors solde.
    const brut = w.history(`w-${k}`).filter((e) => e.type !== 'commission').reduce((n, e) => n + e.amount, 0);
    assert.equal(w.balance(`w-${k}`), brut, `solde de w-${k}`);
  }
  const seuil = maintenant - 48 * 3_600_000;
  const toutes = [0, 1, 2, 3, 4].flatMap((k) => w.history(`w-${k}`));
  assert.equal(w.entriesSince(seuil).length, toutes.filter((e) => Date.parse(e.at) >= seuil).length);
  assert.equal(w.payoutsSince(0).length, toutes.filter((e) => e.type === 'payout').length);

  // Clients : la recherche par téléphone suit un changement de numéro.
  const c = container.clients;
  c.touch('vi-a', { name: 'Awa', phone: '+2250700000001' });
  c.updateProfile('vi-a', { phone: '+2250700000002', phoneVerifiedAt: new Date().toISOString() });
  assert.equal(c.findByVerifiedPhone('+2250700000001'), undefined);
  assert.equal(c.findByVerifiedPhone('+2250700000002')?.id, 'vi-a');
  // Recherche libre : retrouve le nouveau nom, oublie l'ancien, et rien après suppression du compte.
  c.updateProfile('vi-a', { name: 'Awa Konaté' });
  assert.deepEqual(c.rechercher('konaté', 5).map((x) => x.id), ['vi-a']);
  assert.deepEqual(c.rechercher('0700000002', 5).map((x) => x.id), ['vi-a']);
  c.anonymiser('vi-a');
  assert.equal(c.rechercher('konaté', 5).length, 0, 'un compte supprimé ne se retrouve plus par son nom');
  assert.equal(c.rechercher('0700000002', 5).length, 0, 'ni par son ancien numéro');
  assert.equal(c.creesDepuis(maintenant - 60_000), c.list().filter((x) => Date.parse(x.createdAt) >= maintenant - 60_000).length);

  // Alertes système : une seule alerte ouverte par (course, type), même relevée mille fois.
  const s = container.safety;
  for (let i = 0; i < 1000; i += 1) {
    s.raiseSystem({ kind: 'immobilisation', userId: 'vi-a', rideId: 'vi-course', location: { lat: 5.3, lng: -4 } });
  }
  assert.equal(s.list().filter((a) => a.rideId === 'vi-course').length, 1);
  assert.equal(s.parUsager('vi-a').length, 1);
});
