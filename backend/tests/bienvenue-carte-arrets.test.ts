import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { civiliteProbable, composerBienvenue, momentAccueil } from '../src/modules/rides/bienvenue.js';

/**
 * ORION PRO ET LE CLIENT À BORD : accueil vocal personnalisé (civilité, moment de la journée,
 * assurance), carte de service du chauffeur hors course (zones à forte demande, sièges ORION),
 * arrêt ajouté par le client après sa commande (détour facturé, chauffeur prévenu).
 */
const AUTH = { 'x-admin-token': 'orion-admin-dev' };
const POS = { lat: 5.336, lng: -4.031 };
const ORIGIN = { lat: 5.335, lng: -4.03 };
const DEST = { lat: 5.345, lng: -4.02 };

async function chauffeur(app: FastifyInstance, phone: string, name: string) {
  const otp = (await app.inject({ method: 'POST', url: '/drivers/auth/otp', payload: { phone } })).json();
  const v = (await app.inject({ method: 'POST', url: '/drivers/auth/verify', payload: { phone, code: otp.devCode, name } })).json();
  await app.inject({ method: 'POST', url: `/admin/drivers/${v.driver.id}/kyc`, headers: AUTH, payload: { status: 'active' } });
  await app.inject({ method: 'POST', url: `/drivers/${v.driver.id}/online`, headers: { authorization: `Bearer ${v.token}` }, payload: { position: POS } });
  return { id: v.driver.id as string, h: { authorization: `Bearer ${v.token}` } };
}
async function passager(app: FastifyInstance, phone: string, name: string, civilite?: 'M' | 'Mme') {
  const o = (await app.inject({ method: 'POST', url: '/clients/auth/otp', payload: { phone } })).json();
  const v = (await app.inject({ method: 'POST', url: '/clients/auth/verify', payload: { clientId: `c-${phone}`, phone, code: o.devCode, name, ...(civilite ? { civilite } : {}) } })).json();
  return { id: v.client.id as string, h: { authorization: `Bearer ${v.token}` }, client: v.client };
}
const a = (h: number) => { const d = new Date('2026-11-24T00:00:00Z'); d.setUTCHours(h, 15); return d; };

test('accueil vocal : moment de la journée d’Abidjan, civilité et assurance', () => {
  assert.equal(momentAccueil(a(7)), 'matin');
  assert.equal(momentAccueil(a(11)), 'fin_matinee');
  assert.equal(momentAccueil(a(13)), 'debut_apres_midi');
  assert.equal(momentAccueil(a(16)), 'fin_apres_midi');
  assert.equal(momentAccueil(a(17)), 'debut_soiree');
  assert.equal(momentAccueil(a(19)), 'soir');
  assert.equal(momentAccueil(a(21)), 'nuit');
  assert.equal(momentAccueil(a(2)), 'nuit');

  // Prénom sans ambiguïté d'abord, même écrit après le nom de famille ; jour akan seul : Monsieur.
  assert.equal(civiliteProbable('Kouassi Aya'), 'Mme');
  assert.equal(civiliteProbable('Aya Kouassi'), 'Mme');
  assert.equal(civiliteProbable('KONAN Yao'), 'M');
  assert.equal(civiliteProbable('Yao Jean-Baptiste'), 'M');
  assert.equal(civiliteProbable('Marie-Claire Bamba'), 'Mme');
  assert.equal(civiliteProbable('Zxq Wvb'), null);

  const homme = composerBienvenue({ nom: 'KONAN Yao', civilite: null, at: a(7), assure: true });
  assert.match(homme.texte, /^Bonjour Monsieur Konan Yao, bienvenue à bord d’ORION\. J’espère que vous allez bien et que vous avez passé une excellente nuit, et que vous passerez un excellent trajet avec votre chauffeur\./);
  assert.match(homme.texte, /ceinture de sécurité, même à l’arrière/);
  assert.match(homme.texte, /Wi-Fi gratuit/);
  assert.match(homme.texte, /bouton SOS/);
  assert.match(homme.texte, /protégée par ORION Assurance .* 100 %/);
  assert.match(homme.texte, /Excellente journée, et que le Bon Dieu vous protège\.$/);
  assert.equal(homme.voix, 'feminine', 'une voix féminine accueille un client');
  assert.equal(homme.origineCivilite, 'prenom');

  const femme = composerBienvenue({ nom: 'Aya Kouassi', civilite: 'Mme', at: a(21), assure: false });
  assert.match(femme.texte, /^Bonsoir Madame Aya Kouassi, bienvenue à bord d’ORION\. J’espère que vous allez bien et que toute cette journée a été bénéfique pour vous/);
  assert.match(femme.texte, /si vous activez ORION Assurance avant votre commande ; pour cette course, ORION vous prendra en charge à 50 %/);
  assert.match(femme.texte, /Excellente nuit, et que le Bon Dieu vous protège\.$/);
  assert.equal(femme.voix, 'masculine', 'une voix masculine accueille une cliente');

  const inconnu = composerBienvenue({ nom: null, civilite: null, at: a(13), assure: false });
  assert.match(inconnu.texte, /^Bonsoir, bienvenue à bord d’ORION\. J’espère que vous passez un excellent début d’après-midi/);
});

test('accueil vocal servi au chauffeur une fois le client à bord, civilité du compte', async (t) => {
  const { app } = await buildApp();
  t.after(() => app.close());
  const k = await chauffeur(app, '0701020590', 'Konan Yao');
  const aya = await passager(app, '0707070590', 'Kouassi Aya', 'Mme');
  assert.equal(aya.client.civilite, 'Mme');
  const q = (await app.inject({ method: 'POST', url: '/pricing/estimate', payload: { origin: ORIGIN, destination: DEST, category: 'argent' } })).json().quote;
  const cree = (await app.inject({ method: 'POST', url: '/rides', headers: { 'idempotency-key': 'bv-1', ...aya.h }, payload: { clientId: aya.id, lockId: q.lockId, paymentMethod: 'cash' } })).json();
  const id = cree.ride.id as string;
  assert.equal((await app.inject({ method: 'GET', url: `/rides/${id}/bienvenue`, headers: k.h })).statusCode, 409, 'pas avant que le client soit là');
  for (const to of ['driver_en_route', 'arrived']) await app.inject({ method: 'POST', url: `/rides/${id}/transition`, headers: k.h, payload: { to } });
  await app.inject({ method: 'POST', url: `/rides/${id}/start`, headers: k.h, payload: { code: cree.codePriseEnCharge } });
  assert.equal((await app.inject({ method: 'GET', url: `/rides/${id}/bienvenue`, headers: aya.h })).statusCode, 403, 'réservé au chauffeur');
  const m = (await app.inject({ method: 'GET', url: `/rides/${id}/bienvenue`, headers: k.h })).json();
  assert.match(m.texte, /Madame Kouassi Aya, bienvenue à bord/);
  assert.equal(m.voix, 'masculine');
  assert.equal(m.origineCivilite, 'compte');

  // La cliente change sa civilité dans son compte : l'accueil suit.
  const p = await app.inject({ method: 'PUT', url: `/clients/${aya.id}/profile`, headers: aya.h, payload: { civilite: 'M' } });
  assert.equal(p.json().client.civilite, 'M');

  // La direction retouche une phrase depuis la console ; le texte d'origine reste disponible.
  const lu = (await app.inject({ method: 'GET', url: '/admin/voix-bord', headers: AUTH })).json();
  const textes = { ...lu.textes, moments: { ...lu.textes.moments, soir: { ...lu.textes.moments.soir, voeu: 'j’espère que votre journée s’est bien achevée' } } };
  assert.equal((await app.inject({ method: 'PUT', url: '/admin/voix-bord', headers: AUTH, payload: textes })).statusCode, 200);
  const relu = (await app.inject({ method: 'GET', url: '/admin/voix-bord', headers: AUTH })).json();
  assert.equal(relu.textes.moments.soir.voeu, 'j’espère que votre journée s’est bien achevée');
  assert.equal(relu.origine.moments.soir.voeu, 'j’espère que la soirée s’est bien achevée');
  assert.match(relu.exemples[1].texte, /Bonsoir Madame Aya Kouassi/);
});

test('carte de service ORION Pro : zones à forte demande et siège de la zone', async (t) => {
  const { app } = await buildApp();
  t.after(() => app.close());
  const k = await chauffeur(app, '0701020591', 'Bamba Lassina');
  // Pas de siège renseigné : la carte le dit (aucun siège conseillé).
  const vide = (await app.inject({ method: 'GET', url: `/drivers/${k.id}/carte?lat=5.336&lng=-4.031`, headers: k.h })).json();
  assert.deepEqual(vide.bases, []);
  assert.equal(vide.baseConseillee, null);
  assert.equal((await app.inject({ method: 'GET', url: `/drivers/${k.id}/carte`, headers: {} })).statusCode, 401);

  // Huit clients différents demandent un prix au même endroit : zone à forte demande.
  const ici = { lat: 5.3644, lng: -4.0225 };
  for (let i = 0; i < 8; i++) {
    await app.inject({ method: 'POST', url: '/pricing/estimate', payload: { origin: ici, destination: DEST, category: 'argent', clientId: `demande-${i}` } });
  }
  const carte = (await app.inject({ method: 'GET', url: `/drivers/${k.id}/carte?lat=5.336&lng=-4.031`, headers: k.h })).json();
  const z = carte.zones[0];
  assert.ok(z, 'une zone à forte demande');
  assert.equal(z.niveau, 'forte');
  assert.ok(z.demande >= 8);
  assert.ok(z.distanceMeters > 2000 && z.distanceMeters < 6000);
  assert.ok(typeof z.nom === 'string' && z.nom.length > 2);

  // La direction renseigne les sièges : celui de la commune du chauffeur lui est conseillé.
  const put = await app.inject({ method: 'PUT', url: '/admin/bases-orion', headers: AUTH, payload: { bases: [
    { nom: 'Siège ORION · Plateau', zone: 'Plateau', lat: 5.3236, lng: -4.0217, principale: true },
    { nom: 'Agence ORION · Yopougon', zone: 'Yopougon', lat: 5.3456, lng: -4.0864 },
  ] } });
  assert.equal(put.statusCode, 200, put.body);
  const yop = (await app.inject({ method: 'GET', url: `/drivers/${k.id}/carte?lat=5.35&lng=-4.08`, headers: k.h })).json();
  assert.equal(yop.bases.length, 2);
  assert.equal(yop.bases.find((b: { id: string }) => b.id === yop.baseConseillee).nom, 'Agence ORION · Yopougon');
  assert.equal((await app.inject({ method: 'PUT', url: '/admin/bases-orion', headers: AUTH, payload: { bases: [{ nom: 'A', lat: 5.3, lng: -4 }] } })).statusCode, 400, 'nom trop court');
});

test('arrêt ajouté par le client en course : détour facturé, chauffeur prévenu, payé', async (t) => {
  const { app, container } = await buildApp();
  t.after(() => app.close());
  const k = await chauffeur(app, '0701020592', 'Koffi Serge');
  const aya = await passager(app, '0707070592', 'Aya Kouassi');
  const evts: Array<{ type: string; data: Record<string, unknown> }> = [];
  container.realtime.subscribeAll((m) => { if (m.type === 'ride.arrets' || m.type === 'chat.message') evts.push({ type: m.type, data: m.data as Record<string, unknown> }); });
  const q = (await app.inject({ method: 'POST', url: '/pricing/estimate', payload: { origin: ORIGIN, destination: DEST, category: 'argent' } })).json().quote;
  const cree = (await app.inject({ method: 'POST', url: '/rides', headers: { 'idempotency-key': 'arr-1', ...aya.h }, payload: { clientId: aya.id, lockId: q.lockId, paymentMethod: 'cash' } })).json();
  const id = cree.ride.id as string;
  const detour = { lat: 5.352, lng: -4.04 };

  // Avant la prise en charge (chauffeur en route) : aperçu du supplément, puis ajout.
  await app.inject({ method: 'POST', url: `/rides/${id}/transition`, headers: k.h, payload: { to: 'driver_en_route' } });
  assert.equal((await app.inject({ method: 'POST', url: `/rides/${id}/arrets/ajout`, headers: k.h, payload: { position: detour } })).statusCode, 403, 'c’est le client qui ajoute');
  const ap = (await app.inject({ method: 'POST', url: `/rides/${id}/arrets/apercu`, headers: aya.h, payload: { position: detour, nom: 'Pharmacie du Bonheur' } })).json();
  assert.ok(ap.supplement > 0, `détour facturé (${ap.supplement} F)`);
  assert.equal(ap.prixApres, q.amount + ap.supplement);
  const ajout = await app.inject({ method: 'POST', url: `/rides/${id}/arrets/ajout`, headers: aya.h, payload: { position: detour, nom: 'Pharmacie du Bonheur' } });
  assert.equal(ajout.statusCode, 200, ajout.body);
  const r = ajout.json();
  assert.equal(r.prevus.length, 1);
  assert.equal(r.prevus[0].nom, 'Pharmacie du Bonheur');
  assert.equal(r.prevus[0].ajoute, true);
  assert.equal(r.supplementTrajet, ap.supplement);
  assert.equal(r.prixAvecDetours, q.amount + ap.supplement);
  const annonce = evts.find((e) => e.type === 'ride.arrets' && e.data.nouvelArret);
  assert.ok(annonce, 'le chauffeur reçoit le nouvel arrêt en direct');
  const msg = evts.find((e) => e.type === 'chat.message' && /a ajouté un arrêt : Pharmacie du Bonheur/.test(String((e.data.message as { texte: string }).texte)));
  assert.ok(msg, 'et un message ORION dans le chat');

  // En course : le chauffeur marque l'arrêt (prévu, index 0) puis termine ; le paiement compte le détour.
  await app.inject({ method: 'POST', url: `/rides/${id}/transition`, headers: k.h, payload: { to: 'arrived' } });
  await app.inject({ method: 'POST', url: `/rides/${id}/start`, headers: k.h, payload: { code: cree.codePriseEnCharge } });
  assert.equal((await app.inject({ method: 'POST', url: `/rides/${id}/arrets`, headers: k.h, payload: { type: 'prevu', index: 0 } })).statusCode, 200);
  await app.inject({ method: 'POST', url: `/rides/${id}/arrets/fin`, headers: k.h });
  await app.inject({ method: 'POST', url: `/rides/${id}/transition`, headers: k.h, payload: { to: 'completed' } });
  assert.equal((await app.inject({ method: 'POST', url: `/rides/${id}/arrets/ajout`, headers: aya.h, payload: { position: detour } })).statusCode, 409, 'plus d’ajout une fois arrivé');
  const pay = await app.inject({ method: 'POST', url: `/rides/${id}/pay`, headers: { 'idempotency-key': 'arr-pay' }, payload: { method: 'cash' } });
  assert.equal(pay.statusCode, 200, pay.body);
  assert.equal(pay.json().payment.amount, q.amount + ap.supplement);
  assert.ok(container.rides.get(id)!.events.some((e) => e.type === 'arret_ajoute'));
});
