import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildApp } from '../src/app.js';

/**
 * TABLEAU DE BORD ORION : interface à part, synchronisée avec tout l'écosystème.
 * Chaque événement du serveur (commande, attribution, statut, paiement, alerte) devient
 * une ligne du journal, et l'état agrège courses, livraisons, flotte et sécurité.
 */
const AUTH = { 'x-admin-token': 'orion-admin-dev' };
const ORIGIN = { lat: 5.3236, lng: -4.0217 };       // Plateau
const DEST = { lat: 5.3599, lng: -3.9876 };         // Cocody Riviera

test('tableau de bord : réservé au personnel, alimenté en direct par une vraie livraison', async (t) => {
  const { app, container } = await buildApp();
  t.after(() => app.close());

  assert.equal((await app.inject({ method: 'GET', url: '/admin/dashboard' })).statusCode, 401, 'personnel uniquement');

  const coursier = (await app.inject({ method: 'POST', url: '/drivers', payload: { name: 'Yacouba Ouattara', category: 'moto' } })).json().driver.id;
  await app.inject({ method: 'POST', url: `/drivers/${coursier}/online`, payload: { position: { lat: 5.3240, lng: -4.0220 } } });

  // Ce que publie le serveur est vu par le tableau, sans que personne n'ait à le lui dire.
  const recus: string[] = [];
  container.realtime.subscribe('tableau', (m) => recus.push((m.data as { titre: string }).titre));

  const q = (await app.inject({ method: 'POST', url: '/pricing/estimate', payload: {
    serviceType: 'delivery', origin: ORIGIN, destination: DEST, category: 'petit',
  } })).json().quote;
  const ride = (await app.inject({ method: 'POST', url: '/rides', headers: { 'idempotency-key': 'tableau-1' },
    payload: { clientId: 'c-tableau', lockId: q.lockId } })).json().ride;
  assert.equal(ride.driverId, coursier);

  assert.ok(recus.some((x) => x.startsWith('Nouvelle livraison moto')), `journal : ${recus.join(' | ')}`);
  assert.ok(recus.some((x) => x.includes('Coursier attribué : Yacouba Ouattara')), `journal : ${recus.join(' | ')}`);

  const etat = (await app.inject({ method: 'GET', url: '/admin/dashboard', headers: AUTH })).json();
  assert.equal(etat.enDirect.livraisons, 1, 'la livraison est en cours');
  assert.equal(etat.conducteurs.coursiers, 1);
  assert.equal(etat.aujourdhui.commandes, 1);
  assert.ok(etat.journal.length >= 2);
  assert.equal(etat.journal[0].service, 'livraison');
  assert.ok(etat.coursesActives.some((r: { id: string; service: string }) => r.id === ride.id && r.service === 'livraison'));
  assert.ok(etat.flotte.some((f: { id: string; moto: boolean }) => f.id === coursier && f.moto));
  // Aucune donnée de santé ni identité complète : seulement des agrégats.
  assert.equal(typeof etat.assurance.inscrits, 'number');
  assert.equal(JSON.stringify(etat).includes('groupeSanguin'), false);
});
