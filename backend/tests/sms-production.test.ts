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
  refusWhatsApp = 63003;
  const sansWhatsApp = await app.inject({ method: 'POST', url: '/clients/auth/otp', payload: { phone: '0101010101', canal: 'whatsapp' } });
  assert.match(sansWhatsApp.json().error.message, /ne semble pas utiliser WhatsApp/);

  // Le canal SMS reste celui par défaut : sans opérateur SMS, il est refusé à part.
  const sms = await app.inject({ method: 'POST', url: '/clients/auth/otp', payload: { phone: '0505050505' } });
  assert.equal(sms.statusCode, 503, sms.body);
  assert.match(sms.json().error.message, /SMS n’est pas encore activé/);
});
