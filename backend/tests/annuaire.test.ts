import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildApp } from '../src/app.js';

/**
 * ANNUAIRE DU PERSONNEL.
 *
 * Les comptes de la console ne venaient que de la configuration du serveur : ouvrir
 * un accès à une nouvelle trésorière ou à un chauffeur imposait d'éditer une variable
 * d'environnement et de redémarrer. Autant dire que personne n'aurait eu de compte.
 *
 * Ces tests vérifient le contrat : on crée un compte depuis la console, la personne
 * se connecte réellement avec, elle doit changer son mot de passe provisoire, et un
 * chef d'équipe ne peut pas se fabriquer un supérieur hiérarchique.
 */
const A = { 'x-admin-token': 'orion-admin-dev' };

type App = Awaited<ReturnType<typeof buildApp>>['app'];
const creer = (app: App, payload: Record<string, unknown>) =>
  app.inject({ method: 'POST', url: '/admin/accounts', headers: A, payload });

test('un compte créé depuis la console permet vraiment de se connecter', async (t) => {
  const { app } = await buildApp();
  t.after(() => app.close());

  const r = await creer(app, { name: 'Rose Aké', role: 'tresorier', service: 'Finances', phone: '0708091011' });
  assert.equal(r.statusCode, 200, r.body);
  const { account, motDePasseProvisoire } = r.json();
  assert.equal(account.username, 'rose.ake', 'identifiant dérivé du nom');
  assert.equal(account.mustChangePassword, true);
  assert.ok(motDePasseProvisoire.length >= 8);
  // Ni le sel ni l'empreinte ne doivent sortir du serveur.
  assert.equal(account.salt, undefined);
  assert.equal(account.hash, undefined);

  const login = await app.inject({
    method: 'POST', url: '/admin/login',
    payload: { username: 'rose.ake', password: motDePasseProvisoire },
  });
  assert.equal(login.statusCode, 200, login.body);
  assert.equal(login.json().account.role, 'tresorier');
  assert.equal(login.json().account.mustChangePassword, true, 'la console doit exiger le changement');
});

test('le mot de passe provisoire se change, et l’ancien cesse de fonctionner', async (t) => {
  const { app } = await buildApp();
  t.after(() => app.close());

  const { motDePasseProvisoire } = (await creer(app, { name: 'Serge Kouadio', role: 'manager' })).json();
  const login = await app.inject({ method: 'POST', url: '/admin/login', payload: { username: 'serge.kouadio', password: motDePasseProvisoire } });
  const jeton = { authorization: `Bearer ${login.json().token}` };

  const trop = await app.inject({ method: 'POST', url: '/admin/password', headers: jeton, payload: { ancien: motDePasseProvisoire, nouveau: 'court' } });
  assert.equal(trop.statusCode, 400, 'un mot de passe de 5 caractères doit être refusé');

  const ok = await app.inject({ method: 'POST', url: '/admin/password', headers: jeton, payload: { ancien: motDePasseProvisoire, nouveau: 'Abidjan-Plateau-2026' } });
  assert.equal(ok.statusCode, 200, ok.body);

  const ancien = await app.inject({ method: 'POST', url: '/admin/login', payload: { username: 'serge.kouadio', password: motDePasseProvisoire } });
  assert.equal(ancien.statusCode, 401, 'l’ancien mot de passe doit être mort');

  const nouveau = await app.inject({ method: 'POST', url: '/admin/login', payload: { username: 'serge.kouadio', password: 'Abidjan-Plateau-2026' } });
  assert.equal(nouveau.statusCode, 200);
  assert.equal(nouveau.json().account.mustChangePassword, false);
});

test('un chauffeur reçoit un accès rattaché à sa fiche, et ne voit que la sienne', async (t) => {
  const { app, container } = await buildApp();
  t.after(() => app.close());

  const d = container.drivers.upsert({
    id: 'drv-annuaire', name: 'Konan Yao', matricule: 'AB-114-CI', category: 'or',
    kycStatus: 'active', availability: 'offline', ratingAvg: 4.9, ratingCount: 40, phone: '+2250701020304',
  });

  // Sans fiche chauffeur, le compte n'a pas de sens : la personne se connecterait
  // sur un dossier vide sans comprendre pourquoi.
  const sans = await creer(app, { name: 'Fantôme', role: 'chauffeur' });
  assert.equal(sans.statusCode, 403);

  const r = await creer(app, { name: d.name, role: 'chauffeur', driverId: d.id, matricule: d.matricule });
  assert.equal(r.statusCode, 200, r.body);
  const { account, motDePasseProvisoire } = r.json();
  assert.equal(account.driverId, d.id);

  // Un seul accès par fiche : deux comptes, et l'on ne sait plus qui a déposé quoi.
  const doublon = await creer(app, { name: 'Konan Yao bis', role: 'chauffeur', driverId: d.id });
  assert.equal(doublon.statusCode, 409);

  const login = await app.inject({ method: 'POST', url: '/admin/login', payload: { username: account.username, password: motDePasseProvisoire } });
  assert.equal(login.statusCode, 200);
  assert.deepEqual(login.json().account.permissions, ['crew:self'], 'un chauffeur ne voit rien d’autre que son dossier');

  // Et il ne peut pas ouvrir la caisse ni les chiffres de l'entreprise.
  const jeton = { authorization: `Bearer ${login.json().token}` };
  const finance = await app.inject({ method: 'GET', url: '/admin/finance', headers: jeton });
  assert.equal(finance.statusCode, 403);
});

test('un chef d’équipe ne crée que des agents et chauffeurs, dans ses propres équipes', async (t) => {
  const { app, container } = await buildApp();
  t.after(() => app.close());

  const chef = (await creer(app, { name: 'Idrissa Barry', role: 'manager' })).json();
  container.teams.upsert({ id: 'flotte-ouest', name: 'Flotte Ouest', managerUsername: chef.account.username, managerName: 'Idrissa Barry' });
  container.teams.upsert({ id: 'flotte-nord', name: 'Flotte Nord', managerUsername: 'quelqun.dautre' });

  const login = await app.inject({ method: 'POST', url: '/admin/login', payload: { username: chef.account.username, password: chef.motDePasseProvisoire } });
  const jeton = { authorization: `Bearer ${login.json().token}` };

  // Dans son équipe, un agent : autorisé.
  const ok = await app.inject({
    method: 'POST', url: '/admin/accounts', headers: jeton,
    payload: { name: 'Prisca Akissi', role: 'agent', teamId: 'flotte-ouest' },
  });
  assert.equal(ok.statusCode, 200, ok.body);

  // Un directeur général : refusé. Nul ne se fabrique un supérieur.
  const promo = await app.inject({
    method: 'POST', url: '/admin/accounts', headers: jeton,
    payload: { name: 'Moi Le Patron', role: 'dg', teamId: 'flotte-ouest' },
  });
  assert.equal(promo.statusCode, 403);

  // Un agent dans l'équipe d'un autre : refusé.
  const voisin = await app.inject({
    method: 'POST', url: '/admin/accounts', headers: jeton,
    payload: { name: 'Agent Voisin', role: 'agent', teamId: 'flotte-nord' },
  });
  assert.equal(voisin.statusCode, 403);

  // Et sa liste ne montre que les siens.
  const liste = await app.inject({ method: 'GET', url: '/admin/accounts', headers: jeton });
  assert.equal(liste.statusCode, 200);
  const noms = liste.json().accounts.map((c: { name: string }) => c.name);
  assert.deepEqual(noms, ['Prisca Akissi']);
});

test('un compte désactivé ne peut plus se connecter, et nul ne se verrouille dehors', async (t) => {
  const { app } = await buildApp();
  t.after(() => app.close());

  const { account, motDePasseProvisoire } = (await creer(app, { name: 'Odette Assi', role: 'ops' })).json();

  const off = await app.inject({
    method: 'POST', url: `/admin/accounts/${account.username}/active`, headers: A,
    payload: { active: false, reason: 'Fin de contrat' },
  });
  assert.equal(off.statusCode, 200);
  assert.equal(off.json().account.active, false);
  assert.equal(off.json().account.disabledReason, 'Fin de contrat');

  const refus = await app.inject({ method: 'POST', url: '/admin/login', payload: { username: account.username, password: motDePasseProvisoire } });
  assert.equal(refus.statusCode, 401, 'un compte désactivé ne se connecte plus');

  const on = await app.inject({ method: 'POST', url: `/admin/accounts/${account.username}/active`, headers: A, payload: { active: true } });
  assert.equal(on.statusCode, 200);
  const reprise = await app.inject({ method: 'POST', url: '/admin/login', payload: { username: account.username, password: motDePasseProvisoire } });
  assert.equal(reprise.statusCode, 200);
});

test('le compte de secours défini dans la configuration reste intouchable depuis l’écran', async (t) => {
  const { app } = await buildApp();
  t.after(() => app.close());

  // Sans cela, une fausse manœuvre à l'écran pourrait fermer la porte à tout le monde.
  for (const url of ['/admin/accounts/admin/reset', '/admin/accounts/admin/active']) {
    const r = await app.inject({ method: 'POST', url, headers: A, payload: { active: false } });
    assert.equal(r.statusCode, 403, url);
  }
  const maj = await app.inject({ method: 'PUT', url: '/admin/accounts/admin', headers: A, payload: { name: 'Pirate' } });
  assert.equal(maj.statusCode, 403);

  // Et un homonyme créé à l'écran ne doit pas pouvoir le masquer.
  const doublon = await creer(app, { name: 'Admin Bis', role: 'viewer', username: 'admin' });
  assert.equal(doublon.statusCode, 409);
});

test('le DAF dépose des demandes et statue sur celles des autres — jamais sur la sienne', async (t) => {
  const { app } = await buildApp();
  t.after(() => app.close());

  const faire = async (payload: Record<string, unknown>) => {
    const c = await creer(app, payload);
    assert.equal(c.statusCode, 200, c.body);
    const { account, motDePasseProvisoire } = c.json();
    const l = await app.inject({ method: 'POST', url: '/admin/login', payload: { username: account.username, password: motDePasseProvisoire } });
    return { username: account.username as string, nom: payload.name as string, headers: { authorization: `Bearer ${l.json().token}` } };
  };

  const daf = await faire({ name: 'Franck Yeboua', role: 'daf', service: 'Finances' });
  const agent = await faire({ name: 'Céline Oulaï', role: 'ops' });

  // Il dépose comme tout le monde.
  const sienne = await app.inject({
    method: 'POST', url: '/admin/expenses', headers: daf.headers,
    payload: { requesterType: 'employee', amount: 180_000, category: 'materiel', neededDate: '2026-11-20', description: 'Deux écrans pour le pôle finance.' },
  });
  assert.ok(sienne.statusCode < 300, `dépôt DAF : ${sienne.statusCode} ${sienne.body}`);

  const autre = await app.inject({
    method: 'POST', url: '/admin/expenses', headers: agent.headers,
    payload: { requesterType: 'employee', amount: 60_000, category: 'deplacement', neededDate: '2026-11-15', description: 'Déplacement Bouaké pour audit flotte.' },
  });
  assert.ok(autre.statusCode < 300, `dépôt agent : ${autre.statusCode} ${autre.body}`);

  // Il statue sur celle de l'agent : c'est son métier.
  const ok = await app.inject({
    method: 'POST', url: `/admin/expenses/${autre.json().ticket.id}/decide`, headers: daf.headers,
    payload: { decision: 'approve', note: 'Mission validée par la direction des opérations.' },
  });
  assert.equal(ok.statusCode, 200, ok.body);

  // Mais pas sur la sienne : sans cette garde, le contrôle interne repose sur la
  // seule honnêteté d'une personne.
  const auto = await app.inject({
    method: 'POST', url: `/admin/expenses/${sienne.json().ticket.id}/decide`, headers: daf.headers,
    payload: { decision: 'approve' },
  });
  assert.equal(auto.statusCode, 403);
  assert.match(auto.json().error.message, /sa propre demande/);

  // Et une trésorière ne statue sur aucune : compter l'argent et décider de le
  // sortir sont deux métiers.
  const tresoriere = await faire({ name: 'Rose Aké', role: 'tresorier' });
  const refus = await app.inject({
    method: 'POST', url: `/admin/expenses/${sienne.json().ticket.id}/decide`, headers: tresoriere.headers,
    payload: { decision: 'approve' },
  });
  assert.equal(refus.statusCode, 403);
});
