import { test } from 'node:test';
import assert from 'node:assert/strict';

/**
 * EN PRODUCTION, LE CODE PART PAR SMS ET NE REVIENT JAMAIS DANS LA RÉPONSE.
 * Sans opérateur configuré, le serveur refuse clairement au lieu de laisser le client
 * attendre un SMS qui n'arrivera pas.
 */
process.env.NODE_ENV = 'production';
process.env.ADMIN_JWT_SECRET = 'secret-de-test-suffisamment-long-pour-la-production';
// Production complète : le serveur refuse de démarrer avec un secret public du dépôt.
process.env.DRIVER_JWT_SECRET = 'secret-chauffeur-de-test-suffisamment-long-0001';
process.env.CLIENT_JWT_SECRET = 'secret-client-de-test-suffisamment-long-00000001';
process.env.ADMIN_TOKEN = 'jeton-admin-de-test-suffisamment-long';
process.env.ADMIN_PASSWORD = 'Mot-de-passe-de-test-2026';

test('production sans opérateur : refus 503 explicite, client et chauffeur', async (t) => {
  const { buildApp } = await import('../src/app.js');
  const { app } = await buildApp();
  t.after(() => app.close());
  for (const url of ['/clients/auth/otp', '/drivers/auth/otp']) {
    const r = await app.inject({ method: 'POST', url, payload: { phone: '0708091011' } });
    assert.equal(r.statusCode, 503, r.body);
    assert.match(r.json().error.message, /SMS n’est pas encore activé/);
  }
});

test('production avec opérateur : le SMS contient le code, la réponse jamais', async (t) => {
  const { buildApp } = await import('../src/app.js');
  const { createContainer } = await import('../src/container.js');
  const envoyes: Array<{ numero: string; message: string }> = [];
  let enPanne = false;
  const container = createContainer();
  container.sms = {
    fournisseur: 'orange', reel: true,
    async envoyer(numero: string, message: string) {
      if (enPanne) throw new Error('réseau coupé');
      envoyes.push({ numero, message });
      return { id: 'm1' };
    },
  };
  const { app } = await buildApp(container);
  t.after(() => app.close());

  const r = await app.inject({ method: 'POST', url: '/clients/auth/otp', payload: { phone: '07 08 09 10 11' } });
  assert.equal(r.statusCode, 200, r.body);
  assert.equal(r.json().devCode, undefined);
  assert.equal(envoyes.length, 1);
  assert.equal(envoyes[0]!.numero, '+2250708091011');
  const code = envoyes[0]!.message.slice(0, 6);
  assert.match(code, /^\d{6}$/);
  const ok = await app.inject({ method: 'POST', url: '/clients/auth/verify', payload: { clientId: 'appareil-1', phone: '0708091011', code, name: 'Aya Kouassi' } });
  assert.equal(ok.statusCode, 200, ok.body);

  // Chauffeur : même opérateur, message dédié.
  const ch = await app.inject({ method: 'POST', url: '/drivers/auth/otp', payload: { phone: '0505050505' } });
  assert.equal(ch.statusCode, 200, ch.body);
  assert.match(envoyes[1]!.message, /ORION Chauffeur/);

  // Opérateur en panne : 502, et le client peut redemander aussitôt (pas de 429).
  enPanne = true;
  const panne = await app.inject({ method: 'POST', url: '/clients/auth/otp', payload: { phone: '0101010101' } });
  assert.equal(panne.statusCode, 502, panne.body);
  enPanne = false;
  const reprise = await app.inject({ method: 'POST', url: '/clients/auth/otp', payload: { phone: '0101010101' } });
  assert.equal(reprise.statusCode, 200, reprise.body);

  // Numéro étranger : refusé avant tout envoi (fraude aux SMS surtaxés).
  const etranger = await app.inject({ method: 'POST', url: '/clients/auth/otp', payload: { phone: '+44 7700 900123' } });
  assert.equal(etranger.statusCode, 400, etranger.body);
  assert.equal(envoyes.length, 3);
});

test('production, code par WhatsApp : refus clair sans numéro WhatsApp, envoi et vérification avec', async (t) => {
  const { buildApp } = await import('../src/app.js');
  const { createContainer } = await import('../src/container.js');
  const { SmsError } = await import('../src/modules/sms/index.js');

  // Sans numéro WhatsApp réglé : l'app ne propose pas le bouton, et le serveur refuse clairement.
  const sans = await buildApp();
  t.after(() => sans.app.close());
  const conf = await sans.app.inject({ method: 'GET', url: '/config' });
  assert.equal(conf.json().codeWhatsApp, false);
  const refus = await sans.app.inject({ method: 'POST', url: '/clients/auth/otp', payload: { phone: '0708091011', canal: 'whatsapp' } });
  assert.equal(refus.statusCode, 503, refus.body);
  assert.match(refus.json().error.message, /WhatsApp n’est pas encore activé/);

  // Avec WhatsApp : le code part sur WhatsApp (pas par SMS) et ouvre le compte.
  const parWhatsApp: Array<{ numero: string; code: string; message: string }> = [];
  let refusWhatsApp: number | null = null;
  const container = createContainer();
  container.sms = { fournisseur: 'console', reel: false, async envoyer() { throw new Error('aucun SMS ne doit partir'); } };
  container.whatsapp = {
    fournisseur: 'twilio',
    async envoyer(numero: string, code: string, message: string) {
      if (refusWhatsApp) throw new SmsError('Twilio WhatsApp : message failed', 200, refusWhatsApp);
      parWhatsApp.push({ numero, code, message });
      return { id: 'SMwa1' };
    },
  };
  const { app } = await buildApp(container);
  t.after(() => app.close());
  assert.equal((await app.inject({ method: 'GET', url: '/config' })).json().codeWhatsApp, true);

  const r = await app.inject({ method: 'POST', url: '/clients/auth/otp', payload: { phone: '07 08 09 10 11', canal: 'whatsapp' } });
  assert.equal(r.statusCode, 200, r.body);
  assert.equal(r.json().canal, 'whatsapp');
  assert.equal(r.json().devCode, undefined);
  assert.equal(parWhatsApp.length, 1);
  assert.equal(parWhatsApp[0]!.numero, '+2250708091011');
  assert.match(parWhatsApp[0]!.code, /^\d{6}$/);
  assert.ok(parWhatsApp[0]!.message.startsWith(`*${parWhatsApp[0]!.code}*`));
  const ok = await app.inject({ method: 'POST', url: '/clients/auth/verify', payload: { clientId: 'appareil-wa', phone: '0708091011', code: parWhatsApp[0]!.code, name: 'Awa Koné' } });
  assert.equal(ok.statusCode, 200, ok.body);

  // Testeur pas inscrit au bac à sable WhatsApp : il sait quoi faire, et peut redemander aussitôt.
  refusWhatsApp = 63015;
  const pasInscrit = await app.inject({ method: 'POST', url: '/clients/auth/otp', payload: { phone: '0101010101', canal: 'whatsapp' } });
  assert.equal(pasInscrit.statusCode, 502, pasInscrit.body);
  assert.match(pasInscrit.json().error.message, /message d’inscription/);
  refusWhatsApp = 131030;
  const pasAutorise = await app.inject({ method: 'POST', url: '/clients/auth/otp', payload: { phone: '0101010101', canal: 'whatsapp' } });
  assert.match(pasAutorise.json().error.message, /pas encore autorisé sur le WhatsApp de test/);
  refusWhatsApp = 63003;
  const sansWhatsApp = await app.inject({ method: 'POST', url: '/clients/auth/otp', payload: { phone: '0101010101', canal: 'whatsapp' } });
  assert.match(sansWhatsApp.json().error.message, /ne semble pas utiliser WhatsApp/);

  // Le canal SMS reste celui par défaut : sans opérateur SMS, il est refusé à part.
  const sms = await app.inject({ method: 'POST', url: '/clients/auth/otp', payload: { phone: '0505050505' } });
  assert.equal(sms.statusCode, 503, sms.body);
  assert.match(sms.json().error.message, /SMS n’est pas encore activé/);
});

test('production sans SMS : un testeur invité par la direction se connecte avec son code, et lui seul', async (t) => {
  const { buildApp } = await import('../src/app.js');
  const { app } = await buildApp();
  t.after(() => app.close());
  const DIRECTION = { 'x-admin-token': 'jeton-admin-de-test-suffisamment-long' };

  // La direction invite un chauffeur testeur et un client testeur.
  const ch = await app.inject({ method: 'POST', url: '/admin/testeurs', headers: DIRECTION, payload: { phone: '07 11 22 33 44', nom: 'Chauffeur testeur' } });
  assert.equal(ch.statusCode, 200, ch.body);
  const codeChauffeur = ch.json().testeur.code as string;
  assert.match(codeChauffeur, /^\d{6}$/);
  const cl = await app.inject({ method: 'POST', url: '/admin/testeurs', headers: DIRECTION, payload: { phone: '0555667788', nom: 'Client testeur', jours: 2 } });
  const codeClient = cl.json().testeur.code as string;
  const liste = await app.inject({ method: 'GET', url: '/admin/testeurs', headers: DIRECTION });
  assert.equal(liste.json().testeurs.length, 2);

  // Chauffeur invité : la demande de code passe (pas d'erreur SMS), le code d'invitation ouvre le compte.
  const otpCh = await app.inject({ method: 'POST', url: '/drivers/auth/otp', payload: { phone: '0711223344' } });
  assert.equal(otpCh.statusCode, 200, otpCh.body);
  assert.equal(otpCh.json().invitation, true);
  assert.equal(otpCh.json().devCode, undefined, 'le code ne revient jamais dans la réponse');
  const okCh = await app.inject({ method: 'POST', url: '/drivers/auth/verify', payload: { phone: '0711223344', code: codeChauffeur, name: 'Konan Yao' } });
  assert.ok([200, 201].includes(okCh.statusCode), okCh.body);
  assert.equal(okCh.json().driver.phone, '+2250711223344');

  // Client invité : idem, par le canal WhatsApp comme par SMS.
  const otpCl = await app.inject({ method: 'POST', url: '/clients/auth/otp', payload: { phone: '0555667788', canal: 'whatsapp' } });
  assert.equal(otpCl.statusCode, 200, otpCl.body);
  const mauvais = await app.inject({ method: 'POST', url: '/clients/auth/verify', payload: { clientId: 'appareil-t', phone: '0555667788', code: codeChauffeur === '000000' ? '111111' : '000000', name: 'Awa' } });
  assert.equal(mauvais.statusCode, 401, 'un autre code ne passe pas');
  const okCl = await app.inject({ method: 'POST', url: '/clients/auth/verify', payload: { clientId: 'appareil-t', phone: '0555667788', code: codeClient, name: 'Awa Koné' } });
  assert.equal(okCl.statusCode, 200, okCl.body);

  // Le code d'un testeur ne vaut rien pour un autre numéro : celui-ci reste soumis au SMS.
  const autre = await app.inject({ method: 'POST', url: '/clients/auth/otp', payload: { phone: '0101010199' } });
  assert.equal(autre.statusCode, 503, autre.body);

  // Invitation retirée : retour au SMS.
  const retrait = await app.inject({ method: 'DELETE', url: `/admin/testeurs/${encodeURIComponent('+2250711223344')}`, headers: DIRECTION });
  assert.equal(retrait.statusCode, 200, retrait.body);
  const apres = await app.inject({ method: 'POST', url: '/drivers/auth/otp', payload: { phone: '0711223344' } });
  assert.equal(apres.statusCode, 503, apres.body);
});

test('accès testeurs : réservé à la direction, code expiré refusé', async () => {
  const { AccesTesteurs } = await import('../src/modules/admin/testeurs.js');
  const memoire = new Map<string, { id: string }>();
  const repo = { get: (id: string) => memoire.get(id), put: (x: { id: string }) => { memoire.set(x.id, x); }, delete: (id: string) => { memoire.delete(id); }, all: () => [...memoire.values()] };
  let maintenant = Date.parse('2026-11-22T10:00:00Z');
  const acces = new AccesTesteurs(repo as never, () => maintenant);
  const a = acces.inviter({ phone: '+2250700000001', nom: 'Testeur', jours: 1, par: 'PDG' });
  assert.equal(acces.codePour('+2250700000001'), a.code);
  assert.equal(acces.codePour('+2250700000002'), undefined);
  maintenant += 86_400_000 + 1;
  assert.equal(acces.codePour('+2250700000001'), undefined, 'expiré au bout de la durée choisie');
  assert.equal(acces.liste()[0]!.actif, false);
  // Rechargé depuis le stockage (redémarrage du serveur) : l'invitation est toujours là.
  assert.equal(new AccesTesteurs(repo as never, () => maintenant).liste().length, 1);
});
