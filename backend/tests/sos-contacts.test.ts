import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildApp } from '../src/app.js';

/**
 * POSTE DE CONTACT SOS.
 *
 * Les numéros de secours étaient de simples étiquettes à l'écran : l'opérateur
 * composait à la main, et rien n'était conservé. En situation de crise, on perd des
 * secondes et, après coup, on ne peut plus établir qui a été joint ni quand.
 */
const JETON = { 'x-admin-token': 'orion-admin-dev' };

async function alerteOuverte(app: { inject: (o: object) => Promise<any> }) {
  const r = await app.inject({
    method: 'POST', url: '/safety/sos',
    payload: { userId: 'client-1', location: { lat: 5.348, lng: -4.002 } },
  });
  assert.ok(r.statusCode === 200 || r.statusCode === 201, r.body);
  return r.json().alert.id as string;
}

test('le dossier SOS porte un répertoire joignable, pas de simples étiquettes', async (t) => {
  const { app } = await buildApp();
  t.after(() => app.close());
  const id = await alerteOuverte(app);

  const d = await app.inject({ method: 'GET', url: `/admin/sos/${id}`, headers: JETON });
  assert.equal(d.statusCode, 200);
  const contacts = d.json().contacts as Array<{ id: string; numero: string; categorie: string }>;
  assert.ok(contacts.length >= 4, 'le répertoire est servi avec le dossier');
  for (const attendu of ['samu', 'police', 'pompiers']) {
    assert.ok(contacts.some((c) => c.id === attendu), `${attendu} joignable`);
  }
  // Les lignes internes et partenaires sont là aussi : direction, assurance, remorquage.
  assert.ok(contacts.some((c) => c.categorie === 'interne'));
  assert.ok(contacts.some((c) => c.categorie === 'partenaire'));
  assert.deepEqual(d.json().journalContacts, [], 'registre vide au départ');
});

test('chaque mise en relation est consignée AVANT la composition', async (t) => {
  const { app } = await buildApp();
  t.after(() => app.close());
  const id = await alerteOuverte(app);

  const appel = await app.inject({
    method: 'POST', url: `/admin/sos/${id}/contact`, headers: JETON,
    payload: { canal: 'appel', contactId: 'samu' },
  });
  assert.equal(appel.statusCode, 200);
  assert.equal(appel.json().lien, 'tel:185', 'le poste reçoit le lien de composition');
  const e = appel.json().entry;
  assert.equal(e.label, 'SAMU');
  assert.equal(e.issue, 'tentative', 'la tentative est tracée même si l’appel échoue ensuite');
  assert.ok(e.agent, 'l’auteur de l’appel est enregistré');

  // L'issue se renseigne juste après l'appel.
  const suite = await app.inject({
    method: 'POST', url: `/admin/sos/${id}/contact/${e.id}`, headers: JETON,
    payload: { issue: 'joint', compteRendu: 'Équipe dépêchée, ETA 8 min' },
  });
  assert.equal(suite.json().entry.issue, 'joint');
  assert.match(suite.json().entry.message, /ETA 8 min/);

  // Un SMS emporte son message dans le lien.
  const sms = await app.inject({
    method: 'POST', url: `/admin/sos/${id}/contact`, headers: JETON,
    payload: { canal: 'sms', contactId: 'astreinte-ops', message: 'Accident Plateau, renfort demandé' },
  });
  assert.match(sms.json().lien, /^sms:\+225/);
  assert.match(sms.json().lien, /renfort/);

  // Numéro libre : utile quand l'interlocuteur n'est pas au répertoire.
  const libre = await app.inject({
    method: 'POST', url: `/admin/sos/${id}/contact`, headers: JETON,
    payload: { canal: 'appel', numero: '+2250709080706', label: 'Témoin sur place' },
  });
  assert.equal(libre.json().entry.contactId, 'libre');

  // Le registre du dossier est complet et ordonné.
  const d = await app.inject({ method: 'GET', url: `/admin/sos/${id}`, headers: JETON });
  assert.equal(d.json().journalContacts.length, 3);
  // Les services prévenus apparaissent dans le dossier d'alerte (rapport de réquisition).
  assert.ok(d.json().alert.dispatchedTo.includes('SAMU'));

  // Et tout est journalisé pour l'audit direction.
  const journal = await app.inject({ method: 'GET', url: '/admin/audit', headers: JETON });
  assert.ok(journal.json().entries.some((x: { action: string }) => x.action === 'sos.contact'));
});

test('le répertoire est éditable depuis la console, et les secours protégés', async (t) => {
  const { app } = await buildApp();
  t.after(() => app.close());

  // Ajout d'un partenaire : un numéro d'astreinte change, jamais par un redéploiement.
  const ajout = await app.inject({
    method: 'PUT', url: '/admin/contacts', headers: JETON,
    payload: { label: 'Clinique partenaire Cocody', numero: '+2250711223344', categorie: 'partenaire', note: 'Urgences 24/7' },
  });
  assert.equal(ajout.statusCode, 200);
  const nouveau = ajout.json().contact;
  assert.equal(nouveau.id, 'clinique-partenaire-cocody');

  const liste = await app.inject({ method: 'GET', url: '/admin/contacts', headers: JETON });
  assert.ok(liste.json().contacts.some((c: { id: string }) => c.id === nouveau.id));

  // Modification du numéro.
  await app.inject({
    method: 'PUT', url: '/admin/contacts', headers: JETON,
    payload: { id: nouveau.id, label: 'Clinique partenaire Cocody', numero: '+2250711223399' },
  });
  const apres = await app.inject({ method: 'GET', url: '/admin/contacts', headers: JETON });
  assert.equal(apres.json().contacts.find((c: { id: string }) => c.id === nouveau.id).numero, '+2250711223399');

  // Suppression d'un partenaire : autorisée.
  const suppr = await app.inject({ method: 'DELETE', url: `/admin/contacts/${nouveau.id}`, headers: JETON });
  assert.equal(suppr.statusCode, 200);
  assert.ok(!suppr.json().contacts.some((c: { id: string }) => c.id === nouveau.id));

  // Suppression du SAMU : refusée. On peut le désactiver, jamais le perdre par mégarde.
  const refus = await app.inject({ method: 'DELETE', url: '/admin/contacts/samu', headers: JETON });
  assert.equal(refus.statusCode, 400);
  const toujours = await app.inject({ method: 'GET', url: '/admin/contacts', headers: JETON });
  assert.ok(toujours.json().contacts.some((c: { id: string }) => c.id === 'samu'));
});

test('un contact désactivé disparaît du poste de l’opérateur sans être perdu', async (t) => {
  const { app } = await buildApp();
  t.after(() => app.close());
  const id = await alerteOuverte(app);

  await app.inject({
    method: 'PUT', url: '/admin/contacts', headers: JETON,
    payload: { id: 'remorquage', label: 'Remorquage partenaire', numero: '+2250700000004', actif: false },
  });
  const d = await app.inject({ method: 'GET', url: `/admin/sos/${id}`, headers: JETON });
  assert.ok(!d.json().contacts.some((c: { id: string }) => c.id === 'remorquage'), 'retiré du poste');
  const rep = await app.inject({ method: 'GET', url: '/admin/contacts', headers: JETON });
  assert.ok(rep.json().contacts.some((c: { id: string }) => c.id === 'remorquage'), 'conservé au répertoire');
});
