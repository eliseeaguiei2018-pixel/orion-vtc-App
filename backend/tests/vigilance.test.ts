import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildApp } from '../src/app.js';

/**
 * MOTEUR DE VIGILANCE.
 *
 * Une console peut afficher des chiffres parfaits et laisser passer une faille :
 * personne ne regarde tous les écrans en même temps. Ces tests vérifient que chaque
 * règle détecte vraiment ce qu'elle prétend détecter — un contrôle qui se trompe ne
 * serait jamais relu.
 */
const A = { 'x-admin-token': 'orion-admin-dev' };
const constat = (body: any, id: string) => body.constats.find((c: { id: string }) => c.id === id);

test('plateforme neuve : état sain, score élevé, aucun faux positif', async (t) => {
  const { app } = await buildApp();
  t.after(() => app.close());

  const r = await app.inject({ method: 'GET', url: '/admin/vigilance', headers: A });
  assert.equal(r.statusCode, 200);
  const b = r.json();
  assert.equal(b.parSeverite.critique, 0, 'aucun critique sur une plateforme vierge');
  assert.ok(b.score >= 90, `score ${b.score}`);
  assert.equal(b.etat, 'sain');
});

test('un chauffeur en ligne avec assurance expirée est signalé comme critique', async (t) => {
  const { app, container } = await buildApp();
  t.after(() => app.close());

  const drv = await app.inject({ method: 'POST', url: '/drivers', payload: { name: 'Yao', category: 'argent' } });
  const id = drv.json().driver.id as string;
  await app.inject({ method: 'POST', url: `/drivers/${id}/online`, payload: { position: { lat: 5.324, lng: -4.021 } } });
  const d = container.drivers.get(id)!;
  d.insuranceExpiry = new Date(Date.now() - 5 * 86_400_000).toISOString();
  container.drivers.persist(id);

  const b = (await app.inject({ method: 'GET', url: '/admin/vigilance', headers: A })).json();
  const c = constat(b, 'assurance-expiree');
  assert.ok(c, 'le constat est levé');
  assert.equal(c.severite, 'critique');
  assert.equal(c.section, 'drivers', 'le constat dit où agir');
  assert.ok(c.elements.includes(id), 'le chauffeur concerné est nommé');
  // Les trois phrases attendues sont bien là : constat, conséquence, action.
  assert.ok(c.constat.length > 20 && c.consequence.length > 20 && c.action.length > 20);
  assert.equal(b.etat, 'critique', 'un seul critique fait sortir la plateforme du vert');
});

test('une alerte SOS que personne n’accepte remonte', async (t) => {
  const { app, container } = await buildApp();
  t.after(() => app.close());

  const sos = await app.inject({
    method: 'POST', url: '/safety/sos',
    payload: { userId: 'client-1', location: { lat: 5.348, lng: -4.002 } },
  });
  const alertId = sos.json().alert.id as string;
  // On vieillit l'alerte de 20 minutes : elle n'a toujours pas de gestionnaire.
  const a = container.safety.get(alertId)!;
  a.createdAt = new Date(Date.now() - 20 * 60_000).toISOString();

  const b = (await app.inject({ method: 'GET', url: '/admin/vigilance', headers: A })).json();
  assert.ok(constat(b, 'sos-sans-agent'), 'alerte sans gestionnaire signalée');
  assert.ok(constat(b, 'sos-rouge-longue'), 'alerte rouge trop longue signalée');

  // Une fois l'alerte prise en charge, le constat « sans agent » disparaît.
  await app.inject({ method: 'POST', url: `/admin/sos/${alertId}/claim`, headers: A });
  const apres = (await app.inject({ method: 'GET', url: '/admin/vigilance', headers: A })).json();
  assert.ok(!constat(apres, 'sos-sans-agent'), 'le constat se referme quand on agit');
});

test('une location imminente sans chauffeur est signalée', async (t) => {
  const { app } = await buildApp();
  t.after(() => app.close());

  const debut = new Date(Date.now() + 6 * 3_600_000).toISOString();
  const res = await app.inject({
    method: 'POST', url: '/rental/reserve',
    payload: { formula: 'evenement', vehicleId: 'aito-m9', debut, duree: 'journee', userId: 'client-mariage' },
  });
  const id = res.json().reservation.id as string;

  const b = (await app.inject({ method: 'GET', url: '/admin/vigilance', headers: A })).json();
  const c = constat(b, 'location-sans-chauffeur');
  assert.ok(c, 'la location sans chauffeur remonte');
  assert.ok(c.elements.includes(id));
  assert.equal(c.section, 'rental');

  // Après affectation, plus de constat.
  const drv = await app.inject({ method: 'POST', url: '/drivers', payload: { name: 'Awa', category: 'diamant' } });
  await app.inject({
    method: 'POST', url: `/admin/rental/${id}/assign`, headers: A,
    payload: { driverId: drv.json().driver.id },
  });
  const apres = (await app.inject({ method: 'GET', url: '/admin/vigilance', headers: A })).json();
  assert.ok(!constat(apres, 'location-sans-chauffeur'));
});

test('incohérences de configuration : passerelles coupées, commission verte inversée, stock à zéro', async (t) => {
  const { app } = await buildApp();
  t.after(() => app.close());

  // Toutes les passerelles coupées : le service tourne sans encaisser.
  for (const method of ['orange_money', 'mtn_momo', 'moov_money', 'wave', 'card', 'cash']) {
    await app.inject({ method: 'POST', url: '/admin/finance/gateways', headers: A, payload: { method, enabled: false } });
  }
  // Incitation écologique inversée.
  await app.inject({ method: 'PUT', url: '/admin/dispatch', headers: A, payload: { commissionGreen: 0.25, commissionStandard: 0.15 } });
  // Un modèle proposé sans aucun exemplaire.
  await app.inject({ method: 'PUT', url: '/admin/rental/tarifs', headers: A, payload: { vehicules: { 'zeekr-8x': { exemplaires: 0 } } } });

  const b = (await app.inject({ method: 'GET', url: '/admin/vigilance', headers: A })).json();
  assert.ok(constat(b, 'aucune-passerelle'), 'aucun moyen de paiement actif');
  assert.equal(constat(b, 'aucune-passerelle').severite, 'critique');
  assert.ok(constat(b, 'commission-verte-incoherente'), 'incitation verte inversée');
  assert.ok(constat(b, 'location-sans-stock'), 'véhicule en vente sans stock');
  assert.ok(b.score <= 60, `score dégradé : ${b.score}`);
  assert.equal(b.etat, 'critique', 'une plateforme qui ne peut plus encaisser n’est pas « à surveiller »');
});

test('un numéro de secours désactivé est une faille critique', async (t) => {
  const { app } = await buildApp();
  t.after(() => app.close());

  await app.inject({
    method: 'PUT', url: '/admin/contacts', headers: A,
    payload: { id: 'samu', label: 'SAMU', numero: '185', actif: false },
  });
  const b = (await app.inject({ method: 'GET', url: '/admin/vigilance', headers: A })).json();
  const c = constat(b, 'secours-desactives');
  assert.ok(c);
  assert.equal(c.severite, 'critique');
  assert.match(c.constat, /SAMU/);
});

test('filtrage par gravité et par domaine, et rapport de contrôle PDF', async (t) => {
  const { app, container } = await buildApp();
  t.after(() => app.close());

  const drv = await app.inject({ method: 'POST', url: '/drivers', payload: { name: 'Koffi', category: 'argent' } });
  const id = drv.json().driver.id as string;
  await app.inject({ method: 'POST', url: `/drivers/${id}/online`, payload: { position: { lat: 5.324, lng: -4.021 } } });
  const d = container.drivers.get(id)!;
  d.insuranceExpiry = new Date(Date.now() - 86_400_000).toISOString();

  const crit = (await app.inject({ method: 'GET', url: '/admin/vigilance?severite=critique', headers: A })).json();
  assert.ok(crit.constats.every((c: { severite: string }) => c.severite === 'critique'));
  const conf = (await app.inject({ method: 'GET', url: '/admin/vigilance?domaine=conformite', headers: A })).json();
  assert.ok(conf.constats.every((c: { domaine: string }) => c.domaine === 'conformite'));
  // Le score et les totaux restent ceux de TOUTE la plateforme, pas du filtre.
  assert.equal(crit.score, conf.score);

  const pdf = await app.inject({ method: 'GET', url: '/admin/vigilance/rapport.pdf', headers: A });
  assert.equal(pdf.statusCode, 200);
  assert.match(String(pdf.headers['content-type']), /application\/pdf/);
  assert.ok(pdf.rawPayload.length > 400);
});

test('les failles critiques remontent jusqu’au tableau de bord du PDG', async (t) => {
  const { app, container } = await buildApp();
  t.after(() => app.close());

  const drv = await app.inject({ method: 'POST', url: '/drivers', payload: { name: 'Adjoua', category: 'argent' } });
  const id = drv.json().driver.id as string;
  await app.inject({ method: 'POST', url: `/drivers/${id}/online`, payload: { position: { lat: 5.324, lng: -4.021 } } });
  container.drivers.get(id)!.insuranceExpiry = new Date(Date.now() - 86_400_000).toISOString();

  const tb = (await app.inject({ method: 'GET', url: '/admin/executive', headers: A })).json();
  // Le PDG n'a pas à ouvrir une autre session pour apprendre que la plateforme
  // laisse rouler un véhicule non assuré.
  assert.equal(tb.vigilance.etat, 'critique');
  assert.ok(tb.vigilance.critiques >= 1);
  assert.ok(
    tb.alertes.some((a: { titre: string; gravite: string }) => a.gravite === 'critique' && /assurance/i.test(a.titre)),
    'la faille apparaît en tête des alertes de direction',
  );
});
