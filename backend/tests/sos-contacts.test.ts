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

test('joindre quelqu’un depuis N’IMPORTE QUELLE session, avec le même registre', async (t) => {
  const { app } = await buildApp();
  t.after(() => app.close());

  // Le support rappelle un client mécontent.
  const sup = await app.inject({
    method: 'POST', url: '/admin/contact', headers: JETON,
    payload: { dossierType: 'client', dossierId: 'client-8842', canal: 'appel', numero: '+2250102030405', label: 'Kouassi Aya' },
  });
  assert.equal(sup.statusCode, 200);
  assert.equal(sup.json().lien, 'tel:+2250102030405');
  assert.equal(sup.json().entry.dossierType, 'client');

  // La flotte appelle un chauffeur au sujet d'un litige.
  const flotte = await app.inject({
    method: 'POST', url: '/admin/contact', headers: JETON,
    payload: { dossierType: 'chauffeur', dossierId: 'drv-7', canal: 'whatsapp', numero: '+2250709080706', label: 'Mamadou Bamba', message: 'Merci de rappeler le service flotte' },
  });
  assert.match(flotte.json().lien, /^https:\/\/wa\.me\/225/);
  assert.match(flotte.json().lien, /rappeler/);

  // Chaque registre est propre à son dossier : pas de mélange.
  const jClient = await app.inject({ method: 'GET', url: '/admin/contact/journal?dossierType=client&dossierId=client-8842', headers: JETON });
  assert.equal(jClient.json().journal.length, 1);
  const jDriver = await app.inject({ method: 'GET', url: '/admin/contact/journal?dossierType=chauffeur&dossierId=drv-7', headers: JETON });
  assert.equal(jDriver.json().journal.length, 1);
  // Le répertoire est servi avec, pour proposer aussi les lignes internes.
  assert.ok(jDriver.json().contacts.length >= 4);

  // L'issue se renseigne de la même façon partout.
  const fin = await app.inject({
    method: 'POST', url: `/admin/contact/${flotte.json().entry.id}/issue`, headers: JETON,
    payload: { issue: 'messagerie', compteRendu: 'Message vocal laissé' },
  });
  assert.equal(fin.json().entry.issue, 'messagerie');
});

test('contacter exige le droit correspondant au dossier', async (t) => {
  const { app } = await buildApp();
  t.after(() => app.close());
  const { ROLE_PERMISSIONS } = await import('../src/modules/admin/roles.js');
  // Le support peut joindre un client, pas déclencher une liaison de crise.
  assert.ok(ROLE_PERMISSIONS.support.includes('clients:read'));
  assert.ok(!ROLE_PERMISSIONS.support.includes('alerts:write'));
  // L'analyste financier ne contacte ni client ni chauffeur.
  assert.ok(!ROLE_PERMISSIONS.financial_analyst.includes('clients:read'));
  assert.ok(!ROLE_PERMISSIONS.financial_analyst.includes('drivers:read'));
});

test('un compte entreprise peut enfin porter un numéro de donneur d’ordre', async (t) => {
  const { app } = await buildApp();
  t.after(() => app.close());

  const cree = await app.inject({
    method: 'PUT', url: '/admin/corporate', headers: JETON,
    payload: { name: 'Ambassade du Ghana', contactEmail: 'protocole@example.ci', contactPhone: '+2250708091011', creditLimit: 5_000_000 },
  });
  assert.equal(cree.statusCode, 200);
  const liste = await app.inject({ method: 'GET', url: '/admin/corporate', headers: JETON });
  const compte = liste.json().accounts.find((a: { name: string }) => a.name === 'Ambassade du Ghana');
  assert.equal(compte.contactPhone, '+2250708091011', 'le numéro est conservé');

  // Un compte en dépassement de ligne de crédit se relance au téléphone.
  const appel = await app.inject({
    method: 'POST', url: '/admin/contact', headers: JETON,
    payload: { dossierType: 'entreprise', dossierId: compte.id, canal: 'appel', numero: compte.contactPhone, label: compte.name },
  });
  assert.equal(appel.statusCode, 200);
  assert.equal(appel.json().entry.dossierType, 'entreprise');
});

test('la file de triage nomme l’usager au lieu de son identifiant technique', async (t) => {
  const { app, container } = await buildApp();
  t.after(() => app.close());

  // Le défaut : la file affichait « usager client-bro » — un identifiant tronqué.
  // L'agent SAMU ne pouvait ni nommer la personne ni l'appeler sans ouvrir le dossier.
  container.clients.touch('client-brou', { name: 'Brou Kacou', phone: '+2250709182736' });
  container.safety.raiseSos({
    userId: 'client-brou',
    location: { lat: 5.3456, lng: -4.0864 },
    note: 'Altercation à la prise en charge.',
  });

  const r = await app.inject({ method: 'GET', url: '/admin/sos', headers: { 'x-admin-token': 'orion-admin-dev' } });
  assert.equal(r.statusCode, 200);
  const a = r.json().alerts.find((x: { userId: string }) => x.userId === 'client-brou');
  assert.ok(a, 'alerte absente de la file');
  assert.equal(a.userName, 'Brou Kacou');
  assert.equal(a.userPhone, '+2250709182736');
  assert.equal(a.userKind, 'client');
});

test('une alerte déclenchée par un chauffeur le désigne comme chauffeur, joignable', async (t) => {
  const { app, container } = await buildApp();
  t.after(() => app.close());

  const d = container.drivers.upsert({
    id: 'sos-drv-1', name: 'Konan Yao', matricule: 'AB-114-CI', category: 'or',
    kycStatus: 'active', availability: 'online', ratingAvg: 4.9, ratingCount: 40,
    phone: '+2250701020304',
  });
  container.safety.raiseSos({ userId: d.id, location: { lat: 5.33, lng: -4.02 }, note: 'Agression signalée.', source: 'chauffeur' });

  const r = await app.inject({ method: 'GET', url: '/admin/sos', headers: { 'x-admin-token': 'orion-admin-dev' } });
  const a = r.json().alerts.find((x: { userId: string }) => x.userId === 'sos-drv-1');
  assert.equal(a.userName, 'Konan Yao');
  assert.equal(a.userKind, 'chauffeur');
  assert.equal(a.userPhone, '+2250701020304');
});
