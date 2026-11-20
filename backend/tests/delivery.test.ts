import { test } from 'node:test';
import assert from 'node:assert/strict';

/**
 * Service de LIVRAISON à moto. Il était annoncé partout (bascule console, tuile de
 * l'app cliente, drapeau `services.delivery` de /config) sans aucune implémentation :
 * le registre ne contenait que la course, et l'app cliente simulait le coursier.
 */
const AUTH = { 'x-admin-token': 'orion-admin-dev' };
const ORIGIN = { lat: 5.3236, lng: -4.0217 };       // Plateau
const DEST = { lat: 5.3599, lng: -3.9876 };         // Cocody Riviera

test('Livraison : le service est enregistré et produit un devis', async (t) => {
  const { buildApp } = await import('../src/app.js');
  const { app } = await buildApp();
  t.after(() => app.close());

  // Le service doit apparaître dans le catalogue public.
  const services = (await app.inject({ method: 'GET', url: '/services' })).json().services as string[];
  assert.ok(services.includes('delivery'), `catalogue = ${services.join(',')}`);

  const r = await app.inject({ method: 'POST', url: '/pricing/estimate', payload: {
    serviceType: 'delivery', origin: ORIGIN, destination: DEST, category: 'moyen',
  } });
  assert.equal(r.statusCode, 200);
  const q = r.json().quote;
  assert.equal(q.serviceType, 'delivery');
  assert.equal(q.category, 'moyen');
  assert.equal(q.currency, 'XOF');
  assert.ok(q.amount > 0);
  assert.ok(q.lockId, 'devis verrouillable');
  assert.equal(q.amount % 50, 0, 'arrondi au multiple de 50 (le FCFA n’a pas de centimes)');
  assert.equal(q.breakdown.insurance, 0, 'l’assurance ORION couvre les personnes, pas les colis');
  assert.equal(q.breakdown.traffic, 0, 'le trafic est intégré au prix, jamais facturé à part');
});

test('Livraison : la taille du colis renchérit le prix (petit < moyen < grand)', async (t) => {
  const { buildApp } = await import('../src/app.js');
  const { app } = await buildApp();
  t.after(() => app.close());

  const quote = async (category: string) => (await app.inject({
    method: 'POST', url: '/pricing/estimate',
    payload: { serviceType: 'delivery', origin: ORIGIN, destination: DEST, category },
  })).json().quote.amount as number;

  const [petit, moyen, grand] = [await quote('petit'), await quote('moyen'), await quote('grand')];
  assert.ok(petit < moyen, `petit (${petit}) < moyen (${moyen})`);
  assert.ok(moyen < grand, `moyen (${moyen}) < grand (${grand})`);
});

test('Livraison : moins chère qu’une course voiture, quelle que soit la taille du colis', async (t) => {
  // Chaque devis est pris sur une instance NEUVE : un devis compte comme une demande
  // (surge), donc des mesures successives sur la même instance se gonflent l'une l'autre.
  const { buildApp } = await import('../src/app.js');
  const une = async (payload: object) => {
    const { app } = await buildApp();
    const q = (await app.inject({ method: 'POST', url: '/pricing/estimate', payload })).json().quote;
    await app.close();
    return q;
  };

  const course = await une({ serviceType: 'ride', origin: ORIGIN, destination: DEST, category: 'bronze' });
  for (const taille of ['petit', 'moyen', 'grand']) {
    const livr = await une({ serviceType: 'delivery', origin: ORIGIN, destination: DEST, category: taille });
    // Une moto portant un colis ne doit jamais coûter plus qu'une voiture portant
    // une personne : le barème hérité de la maquette facturait 22 à 30 % de PLUS.
    assert.ok(livr.amount < course.amount,
      `colis ${taille} (${livr.amount}) doit rester sous la course bronze (${course.amount})`);
  }

  const petit = await une({ serviceType: 'delivery', origin: ORIGIN, destination: DEST, category: 'petit' });
  assert.ok(petit.etaSeconds < course.etaSeconds, 'la moto arrive avant la voiture');
  assert.equal(petit.distanceMeters, course.distanceMeters, 'même trajet, même distance');
});

test('Livraison : hors Côte d’Ivoire refusée, et code promo de la console appliqué', async (t) => {
  const { buildApp } = await import('../src/app.js');
  const { app } = await buildApp();
  t.after(() => app.close());

  // Hors zone de service.
  const hors = await app.inject({ method: 'POST', url: '/pricing/estimate', payload: {
    serviceType: 'delivery', origin: ORIGIN, destination: { lat: 48.85, lng: 2.35 },
  } });
  assert.equal(hors.statusCode, 400);

  // La console crée un code promo : il doit s'appliquer aussi aux livraisons.
  const up = await app.inject({ method: 'PUT', url: '/admin/promos', headers: AUTH, payload: {
    code: 'COLIS20', kind: 'percent', value: 20, active: true,
  } });
  assert.equal(up.statusCode, 200);

  const est = async (promoCode?: string) => (await app.inject({
    method: 'POST', url: '/pricing/estimate',
    payload: { serviceType: 'delivery', origin: ORIGIN, destination: DEST, category: 'moyen', promoCode },
  })).json().quote;

  const plein = await est();
  const remise = await est('COLIS20');
  assert.ok(remise.breakdown.discount > 0, 'remise appliquée');
  assert.ok(remise.amount < plein.amount, `${remise.amount} < ${plein.amount}`);
});

test('Livraison : une course de livraison peut être créée depuis le devis', async (t) => {
  const { buildApp } = await import('../src/app.js');
  const { app } = await buildApp();
  t.after(() => app.close());

  // Un coursier à moto ET une voiture bronze, tous deux tout près du point de retrait.
  const drv = (await app.inject({ method: 'POST', url: '/drivers', payload: { name: 'Coursier Moto', category: 'moto' } })).json().driver.id;
  await app.inject({ method: 'POST', url: `/drivers/${drv}/online`, payload: { position: { lat: 5.3240, lng: -4.0220 } } });
  const voiture = (await app.inject({ method: 'POST', url: '/drivers', payload: { name: 'Berline Bronze', category: 'bronze' } })).json().driver.id;
  await app.inject({ method: 'POST', url: `/drivers/${voiture}/online`, payload: { position: { lat: 5.3237, lng: -4.0218 } } });

  const q = (await app.inject({ method: 'POST', url: '/pricing/estimate', payload: {
    serviceType: 'delivery', origin: ORIGIN, destination: DEST, category: 'moyen',
  } })).json().quote;

  const ride = await app.inject({ method: 'POST', url: '/rides',
    headers: { 'idempotency-key': 'livraison-1' },
    payload: { clientId: 'c-livraison', lockId: q.lockId } });
  assert.equal(ride.statusCode, 201);
  const created = ride.json().ride;
  assert.equal(created.quote.serviceType, 'delivery', 'la course garde le type livraison');
  assert.equal(created.quote.amount, q.amount, 'prix verrouillé : le montant du devis est conservé');
  // La taille du colis (« moyen ») n'est pas une gamme : la livraison va au coursier à
  // moto, jamais à la voiture pourtant plus proche.
  assert.ok(['accepted', 'driver_en_route'].includes(created.status), `un coursier est attribué (statut ${created.status})`);
  assert.equal(created.driverId, drv, 'la livraison part à moto');

  // Une course bronze, elle, ne part jamais à moto.
  const qc = (await app.inject({ method: 'POST', url: '/pricing/estimate', payload: {
    serviceType: 'ride', origin: ORIGIN, destination: DEST, category: 'bronze',
  } })).json().quote;
  const course = (await app.inject({ method: 'POST', url: '/rides', headers: { 'idempotency-key': 'course-1' },
    payload: { clientId: 'c-course', lockId: qc.lockId } })).json().ride;
  assert.equal(course.driverId, voiture, 'la course part en voiture');
});

test('Livraison : paiement mobile money enregistré de bout en bout (bac à sable), coursier libéré', async (t) => {
  const { buildApp } = await import('../src/app.js');
  const { app, container } = await buildApp();
  t.after(() => app.close());
  const coursier = (await app.inject({ method: 'POST', url: '/drivers', payload: { name: 'Coursier Moto', category: 'moto' } })).json().driver.id;
  await app.inject({ method: 'POST', url: `/drivers/${coursier}/online`, payload: { position: { lat: 5.3240, lng: -4.0220 } } });
  const recus: string[] = [];
  container.realtime.subscribe(`driver:${coursier}`, (m) => recus.push(m.type));

  const q = (await app.inject({ method: 'POST', url: '/pricing/estimate', payload: {
    serviceType: 'delivery', origin: ORIGIN, destination: DEST, category: 'petit',
  } })).json().quote;
  const ride = (await app.inject({ method: 'POST', url: '/rides', headers: { 'idempotency-key': 'livraison-om' },
    payload: { clientId: 'c-om', lockId: q.lockId, paymentMethod: 'orange_money' } })).json().ride;
  const r = container.rides.get(ride.id)!;
  r.status = 'completed';
  container.rides.persist(r);

  // Sans numéro : refus explicite, la course reste à payer (l'app ne doit pas annoncer un succès).
  const sans = (await app.inject({ method: 'POST', url: `/rides/${ride.id}/pay`, headers: { 'idempotency-key': 'om-0' }, payload: { method: 'orange_money' } })).json();
  assert.equal(sans.payment.status, 'failed');
  assert.equal(sans.rideStatus, 'completed');

  // Avec le numéro vérifié du client : confirmé par le bac à sable, course payée.
  const pay = await app.inject({ method: 'POST', url: `/rides/${ride.id}/pay`, headers: { 'idempotency-key': 'om-1' }, payload: { method: 'orange_money', phone: '+2250707070707' } });
  assert.equal(pay.statusCode, 200, pay.body);
  assert.equal(pay.json().rideStatus, 'paid');
  assert.ok(recus.includes('payment.received'), 'le coursier est prévenu du paiement');
  assert.equal(container.drivers.get(coursier)!.availability, 'online', 'le coursier est libéré');
  const note = await app.inject({ method: 'POST', url: `/rides/${ride.id}/rate`, payload: { stars: 5 } });
  assert.equal(note.statusCode, 200, note.body);
  // Tout le parcours est visible dans le journal du tableau de bord.
  const titres = container.tableau.journalRecent(20).map((e) => e.titre);
  assert.ok(titres.some((x) => x.startsWith('Paiement reçu')), titres.join(' | '));
  assert.ok(titres.some((x) => x.startsWith('Livraison notée 5')), titres.join(' | '));
});
