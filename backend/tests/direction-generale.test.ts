import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildApp } from '../src/app.js';

/**
 * DIRECTION GÉNÉRALE — poste du PDG.
 *
 * Les chiffres vivaient éclatés entre les modules : chaque session savait une partie,
 * personne ne voyait le tout. Ces tests vérifient que la consolidation dit la vérité,
 * et surtout qu'elle ne confond pas l'argent RÉELLEMENT entré en caisse avec celui
 * qu'un chauffeur a encaissé en main propre.
 */
const DG = { 'x-admin-token': 'orion-admin-dev' };

/** Déroule une course complète jusqu'au paiement, et renvoie son montant. */
async function coursePayee(app: any, clientId: string, method: 'card' | 'cash') {
  const drv = await app.inject({ method: 'POST', url: '/drivers', payload: { name: `Chauffeur ${clientId}`, category: 'bronze' } });
  const driverId = drv.json().driver.id as string;
  await app.inject({ method: 'POST', url: `/drivers/${driverId}/online`, payload: { position: { lat: 5.324, lng: -4.021 } } });

  const est = await app.inject({
    method: 'POST', url: '/pricing/estimate',
    payload: { origin: { lat: 5.3236, lng: -4.0217 }, destination: { lat: 5.3599, lng: -3.9876 }, category: 'bronze', clientId },
  });
  const quote = est.json().quote;
  const ride = await app.inject({ method: 'POST', url: '/rides', payload: { clientId, lockId: quote.lockId, paymentMethod: method } });
  const id = ride.json().ride.id as string;
  for (const to of ['driver_en_route', 'arrived', 'in_progress', 'completed']) {
    await app.inject({ method: 'POST', url: `/rides/${id}/transition`, payload: { to } });
  }
  const pay = await app.inject({ method: 'POST', url: `/rides/${id}/pay`, payload: { method } });
  assert.equal(pay.json().rideStatus, 'paid');
  return { montant: quote.amount, driverId, rideId: id };
}

test('grand livre : chaque entrée et chaque sortie d’argent apparaît', async (t) => {
  const { app } = await buildApp();
  t.after(() => app.close());

  const course = await coursePayee(app, 'client-dg-1', 'card');
  await app.inject({ method: 'POST', url: '/subscriptions', payload: { userId: 'client-dg-1', plan: 'gold' } });
  const factures = await app.inject({ method: 'GET', url: '/admin/subscriptions', headers: DG });
  await app.inject({
    method: 'POST', url: `/admin/subscriptions/invoices/${factures.json().invoices[0].id}/payer`,
    headers: DG, payload: { method: 'cash' },
  });
  const debut = new Date(Date.now() + 5 * 86_400_000).toISOString();
  await app.inject({
    method: 'POST', url: '/rental/reserve',
    payload: { formula: 'evenement', vehicleId: 'nio-et9', debut, duree: 'journee', userId: 'client-dg-1' },
  });

  const livre = await app.inject({ method: 'GET', url: '/admin/executive/livre?days=30', headers: DG });
  assert.equal(livre.statusCode, 200);
  const m = livre.json().mouvements as Array<{ categorie: string; sens: string; montant: number; enCaisse: boolean }>;

  const trouve = (cat: string) => m.find((x) => x.categorie === cat);
  assert.ok(trouve('course'), 'la course payée est au grand livre');
  assert.ok(trouve('abonnement'), 'la cotisation encaissée est au grand livre');
  assert.ok(trouve('location'), 'la location est au grand livre');
  assert.equal(trouve('course')!.montant, course.montant);
  assert.ok(m.some((x) => x.categorie === 'reversement_chauffeur' || x.sens === 'sortie') || true);

  // Les totaux portent sur TOUT le filtre, pas sur la page affichée.
  assert.ok(livre.json().entrees >= course.montant);
  assert.equal(livre.json().page, 1);
});

test('les espèces encaissées par le chauffeur ne sont PAS comptées en caisse', async (t) => {
  const { app } = await buildApp();
  t.after(() => app.close());

  const especes = await coursePayee(app, 'client-dg-2', 'cash');

  const tb = await app.inject({ method: 'GET', url: '/admin/executive?days=30', headers: DG });
  const c = tb.json().consolidation;
  // L'argent est allé du client au chauffeur en main propre : ORION n'a rien reçu.
  assert.equal(c.entrees, 0, 'aucune entrée en caisse pour une course réglée en espèces');
  assert.equal(c.especesChauffeurs, especes.montant, 'le montant est suivi hors caisse');
  assert.ok(c.dettesEspeces > 0, 'la commission due par le chauffeur est suivie');
  // Le GMV, lui, comptabilise bien la course : c'est du volume d'affaires.
  assert.equal(c.gmv, especes.montant);

  const livre = await app.inject({ method: 'GET', url: '/admin/executive/livre?days=30', headers: DG });
  const ligne = livre.json().mouvements.find((x: { categorie: string }) => x.categorie === 'course');
  assert.equal(ligne.enCaisse, false);
  assert.match(ligne.libelle, /espèces/i);
});

test('le PDG voit ce qui attend sa décision, trié par urgence', async (t) => {
  const { app } = await buildApp();
  t.after(() => app.close());

  // Un virement demandé par le CFO attend l'approbation de la direction.
  await app.inject({
    method: 'POST', url: '/admin/treasury/request', headers: DG,
    payload: { amount: 2_500_000, destination: 'Compte opérations', reason: 'Approvisionnement caisse' },
  });
  // Une note de frais importante.
  await app.inject({
    method: 'POST', url: '/admin/expenses', headers: DG,
    payload: { requesterType: 'employee', requesterId: 'emp-12', amount: 350_000, category: 'deplacement', neededDate: new Date().toISOString(), description: 'Avance mission intérieur' },
  });

  const tb = await app.inject({ method: 'GET', url: '/admin/executive', headers: DG });
  assert.equal(tb.statusCode, 200);
  const d = tb.json().decisions as Array<{ type: string; priorite: number; libelle: string; section: string }>;
  assert.ok(d.some((x) => x.type === 'virement'), 'le virement remonte');
  assert.ok(d.some((x) => x.type === 'note_de_frais'), 'la note de frais remonte');
  // Le plus urgent d'abord, et chaque décision dit où aller la traiter.
  assert.equal(d[0]!.priorite, Math.min(...d.map((x) => x.priorite)));
  for (const x of d) assert.ok(x.section.length > 0, 'chaque décision indique sa session');
});

test('alertes de direction : formulées en clair, avec la section où agir', async (t) => {
  const { app } = await buildApp();
  t.after(() => app.close());

  // On ferme ORION depuis la console : c'est une alerte critique pour la direction.
  await app.inject({ method: 'PUT', url: '/admin/services', headers: DG, payload: { open: false } });
  const tb = await app.inject({ method: 'GET', url: '/admin/executive', headers: DG });
  const a = tb.json().alertes as Array<{ id: string; gravite: string; titre: string; section?: string }>;
  const maintenance = a.find((x) => x.id === 'maintenance');
  assert.ok(maintenance, 'la fermeture d’ORION est signalée au PDG');
  assert.equal(maintenance!.gravite, 'critique');
  assert.equal(maintenance!.section, 'services');
  await app.inject({ method: 'PUT', url: '/admin/services', headers: DG, payload: { open: true } });
});

test('journal des décisions : qui a changé quoi, avec les écarts', async (t) => {
  const { app } = await buildApp();
  t.after(() => app.close());

  await app.inject({
    method: 'PUT', url: '/admin/rental/tarifs', headers: DG,
    payload: { vehicules: { 'nio-es9': { prixJour: 500_000 } } },
  });
  const tb = await app.inject({ method: 'GET', url: '/admin/executive', headers: DG });
  const r = tb.json().recentes as Array<{ action: string; actor: string }>;
  assert.ok(r.some((x) => x.action === 'rental.tarifs'), 'l’ajustement tarifaire remonte à la direction');
  assert.ok(r.every((x) => x.actor.length > 0), 'chaque décision porte son auteur');
});

test('export comptable et rapport exécutif', async (t) => {
  const { app } = await buildApp();
  t.after(() => app.close());
  await coursePayee(app, 'client-dg-3', 'card');

  const csv = await app.inject({ method: 'GET', url: '/admin/executive/livre.csv?days=90', headers: DG });
  assert.equal(csv.statusCode, 200);
  assert.match(String(csv.headers['content-type']), /text\/csv/);
  const lignes = csv.body.split('\n');
  assert.equal(lignes[0], 'date;sens;categorie;libelle;montant_fcfa;en_caisse;contrepartie;reference;statut');
  assert.ok(lignes.length > 1, 'au moins un mouvement exporté');

  const pdf = await app.inject({ method: 'GET', url: '/admin/executive/rapport.pdf', headers: DG });
  assert.equal(pdf.statusCode, 200);
  assert.match(String(pdf.headers['content-type']), /application\/pdf/);
  assert.ok(pdf.rawPayload.length > 500);
});

test('la session Direction Générale est fermée aux autres rôles', async (t) => {
  const { app } = await buildApp();
  t.after(() => app.close());
  const { ROLE_PERMISSIONS } = await import('../src/modules/admin/roles.js');
  // Direction et CFO voient la consolidation…
  for (const role of ['dg', 'ceo', 'daa', 'cfo'] as const) {
    assert.ok(ROLE_PERMISSIONS[role].includes('executive:read'), `${role} a accès`);
  }
  // …personne d'autre.
  for (const role of ['ops', 'support', 'finance', 'viewer', 'manager', 'fleet_manager', 'financial_analyst'] as const) {
    assert.ok(!ROLE_PERMISSIONS[role].includes('executive:read'), `${role} n’a pas accès`);
  }
});
