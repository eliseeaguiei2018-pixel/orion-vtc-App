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

  // Un coursier en ligne près du point de retrait.
  const drv = (await app.inject({ method: 'POST', url: '/drivers', payload: { name: 'Coursier Moto', category: 'bronze' } })).json().driver.id;
  await app.inject({ method: 'POST', url: `/drivers/${drv}/online`, payload: { position: { lat: 5.3240, lng: -4.0220 } } });

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
});
