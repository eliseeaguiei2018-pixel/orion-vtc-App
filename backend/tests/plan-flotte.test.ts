import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildApp } from '../src/app.js';

/**
 * SIMULATEUR DE FLOTTE (Mon poste du PDG) : le plan de croissance est enregistré sur le
 * serveur (retrouvé sur tous les appareils de la direction) et les mesures réelles du pilote
 * (flotte, courses par voiture, sans chauffeur, approche) servent à le recaler.
 */
const H = { 'x-admin-token': 'orion-admin-dev' };

test('Simulateur de flotte : plan par défaut, mesures du pilote, enregistrement et refus des valeurs absurdes', async (t) => {
  const { app, container } = await buildApp();
  t.after(() => app.close());

  // Une petite flotte pilote : deux voitures Argent et une moto, validées par ORION.
  for (const [name, category] of [['Pilote A', 'argent'], ['Pilote B', 'argent'], ['Pilote Moto', 'moto']] as const) {
    const id = (await app.inject({ method: 'POST', url: '/drivers', payload: { name, category } })).json().driver.id;
    await app.inject({ method: 'POST', url: `/admin/drivers/${id}/attribution`, headers: H, payload: { category, valider: true } });
  }
  assert.ok(container.drivers.list().filter((d) => d.kycStatus === 'active').length >= 3);

  const r0 = await app.inject({ method: 'GET', url: '/admin/direction/flotte', headers: H });
  assert.equal(r0.statusCode, 200, r0.body);
  const e0 = r0.json();
  assert.equal(e0.plan.objectifFlotte, 5000, 'le plan ORION prévoit 5 000 voitures');
  assert.equal(e0.plan.partVisee, 40);
  assert.ok(e0.mesures.flotte.argent >= 2 && e0.mesures.flotte.motos >= 1, JSON.stringify(e0.mesures.flotte));
  assert.equal(e0.mesures.flotte.voitures, e0.mesures.flotte.argent + e0.mesures.flotte.or + e0.mesures.flotte.diamant);
  assert.ok('coursesParVoitureJour' in e0.mesures && 'sansChauffeurPct' in e0.mesures && 'approcheMedianeMin' in e0.mesures);

  const plan = { ...e0.plan, partVisee: 25, coursesParVoitureJour: 16, objectifFlotte: 3000 };
  delete plan.modifie;
  const r1 = await app.inject({ method: 'POST', url: '/admin/direction/flotte', headers: H, payload: plan });
  assert.equal(r1.statusCode, 200, r1.body);
  assert.equal(r1.json().plan.partVisee, 25);
  assert.ok(r1.json().plan.modifie?.le, 'la console affiche qui a enregistré le plan, et quand');
  const r2 = (await app.inject({ method: 'GET', url: '/admin/direction/flotte', headers: H })).json();
  assert.equal(r2.plan.objectifFlotte, 3000, 'le plan enregistré est relu');
  assert.equal(r2.plan.coursesParVoitureJour, 16);

  const mauvais = await app.inject({ method: 'POST', url: '/admin/direction/flotte', headers: H, payload: { ...plan, gammes: { or: 80, diamant: 40 } } });
  assert.equal(mauvais.statusCode, 400, 'Or + Diamant au-delà de 100 % : refusé');
  const sansJeton = await app.inject({ method: 'GET', url: '/admin/direction/flotte' });
  assert.ok(sansJeton.statusCode === 401 || sansJeton.statusCode === 403);
});
