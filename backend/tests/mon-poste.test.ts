import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildApp } from '../src/app.js';

/**
 * « MON POSTE ».
 *
 * La console était organisée par sujet : il fallait ouvrir dix sessions pour
 * découvrir ce qui vous attendait, et un dossier pris en charge la veille se perdait
 * dans une liste commune. Cette vue regroupe ce qui porte le nom de l'employé.
 */
const A = { 'x-admin-token': 'orion-admin-dev' };

test('mon poste : vide au départ, et annonce l’identité et les droits', async (t) => {
  const { app } = await buildApp();
  t.after(() => app.close());

  const r = await app.inject({ method: 'GET', url: '/admin/mon-poste', headers: A });
  assert.equal(r.statusCode, 200);
  const p = r.json();
  assert.ok(p.identite.nom.length > 0);
  assert.ok(p.identite.roleLabel.length > 0, 'le rôle est affiché en clair, pas en code');
  assert.ok(Array.isArray(p.identite.permissions));
  assert.equal(p.bilan.dossiers, 0);
  assert.equal(p.bilan.demandes, 0);
});

test('une alerte prise en charge arrive sur MON poste, pas sur celui des autres', async (t) => {
  const { app } = await buildApp();
  t.after(() => app.close());

  const sos = await app.inject({
    method: 'POST', url: '/safety/sos',
    payload: { userId: 'client-1', location: { lat: 5.348, lng: -4.002 } },
  });
  const alertId = sos.json().alert.id as string;

  // Avant acceptation : l'alerte n'est à personne.
  const avant = (await app.inject({ method: 'GET', url: '/admin/mon-poste', headers: A })).json();
  assert.equal(avant.mesDossiers.length, 0);

  await app.inject({ method: 'POST', url: `/admin/sos/${alertId}/claim`, headers: A });

  const apres = (await app.inject({ method: 'GET', url: '/admin/mon-poste', headers: A })).json();
  const dossier = apres.mesDossiers.find((d: { id: string }) => d.id === alertId);
  assert.ok(dossier, 'le dossier est sur mon poste');
  assert.equal(dossier.type, 'sos');
  assert.equal(dossier.section, 'alerts', 'le dossier dit où le traiter');
  assert.equal(dossier.priorite, 1, 'une alerte passe avant tout le reste');
  assert.equal(apres.bilan.dossiers, 1);
});

test('mes demandes : ce que j’ai demandé et qui attend la décision d’un autre', async (t) => {
  const { app } = await buildApp();
  t.after(() => app.close());

  await app.inject({
    method: 'POST', url: '/admin/treasury/request', headers: A,
    payload: { amount: 1_500_000, destination: 'Caisse Abidjan', reason: 'Approvisionnement' },
  });
  await app.inject({
    method: 'POST', url: '/admin/expenses', headers: A,
    payload: { requesterType: 'employee', amount: 90_000, category: 'deplacement', neededDate: new Date().toISOString(), description: 'Mission Bouaké' },
  });

  const p = (await app.inject({ method: 'GET', url: '/admin/mon-poste', headers: A })).json();
  assert.ok(p.mesDemandes.some((d: { type: string }) => d.type === 'virement'));
  assert.ok(p.mesDemandes.some((d: { type: string }) => d.type === 'note_de_frais'));
  // Chaque demande porte son montant et son état : on ne relance pas à l'aveugle.
  for (const d of p.mesDemandes) {
    assert.ok(d.montant > 0 && d.statut.length > 0 && d.section.length > 0);
  }
});

test('« à traiter » ne propose que ce que mes droits me permettent d’ouvrir', async (t) => {
  const { app, container } = await buildApp();
  t.after(() => app.close());

  // On crée une vraie faille : un chauffeur en ligne sans dossier validé.
  const drv = await app.inject({ method: 'POST', url: '/drivers', payload: { name: 'Yao', category: 'bronze' } });
  const id = drv.json().driver.id as string;
  await app.inject({ method: 'POST', url: `/drivers/${id}/online`, payload: { position: { lat: 5.324, lng: -4.021 } } });

  const p = (await app.inject({ method: 'GET', url: '/admin/mon-poste', headers: A })).json();
  assert.ok(p.aTraiter.length > 0, 'le super admin voit les constats');
  for (const c of p.aTraiter) assert.ok(c.action.length > 0 && c.section.length > 0);

  // Un rôle sans droit sur les chauffeurs ne doit pas se voir proposer ce constat :
  // montrer une tâche qu'on ne peut pas ouvrir est pire que de ne rien montrer.
  const { ROLE_PERMISSIONS } = await import('../src/modules/admin/roles.js');
  assert.ok(!ROLE_PERMISSIONS.financial_analyst.includes('drivers:read'));
  const poste = await container.workspace.monPoste({
    name: 'Analyste', username: 'analyste', role: 'financial_analyst',
  } as never);
  assert.ok(!poste.aTraiter.some((c) => c.section === 'drivers'));
});

test('mon activité du jour reprend ce que J’AI fait, pas ce que d’autres ont fait', async (t) => {
  const { app } = await buildApp();
  t.after(() => app.close());

  await app.inject({ method: 'PUT', url: '/admin/pricing', headers: A, payload: { perKm: 275 } });
  const p = (await app.inject({ method: 'GET', url: '/admin/mon-poste', headers: A })).json();
  assert.ok(p.monActivite.some((a: { action: string }) => a.action.startsWith('pricing')));
  assert.equal(p.bilan.actionsAujourdhui, p.monActivite.length);
});
