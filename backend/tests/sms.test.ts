import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { OrangeSms, TwilioSms, TwilioWhatsApp, creerWhatsApp, SmsError, messageCode, messageCodeWhatsApp } from '../src/modules/sms/index.js';
import { OtpStore } from '../src/modules/driver-app/auth.js';

/**
 * OPÉRATEUR SMS : les appels sont vérifiés contre les formats documentés d'Orange
 * (API SMS Côte d'Ivoire) et de Twilio, avec des réponses simulées.
 */
type Appel = { url: string; init: RequestInit };
function faux(reponses: Array<{ status: number; body: unknown }>) {
  const appels: Appel[] = [];
  const fn = (async (url: string, init: RequestInit) => {
    appels.push({ url, init });
    const r = reponses.shift() ?? { status: 500, body: {} };
    return new Response(JSON.stringify(r.body), { status: r.status, headers: { 'content-type': 'application/json' } });
  }) as unknown as typeof fetch;
  return { fn, appels };
}
const JETON = { status: 200, body: { token_type: 'Bearer', access_token: 'jeton-1', expires_in: 3600 } };
const ENVOYE = { status: 201, body: { outboundSMSMessageRequest: { resourceURL: 'https://api.orange.com/smsmessaging/v1/outbound/tel%3A%2B2250000/requests/abc123' } } };

test('Orange : jeton OAuth2 puis envoi au format de l’API SMS Côte d’Ivoire', async () => {
  const f = faux([JETON, ENVOYE, ENVOYE]);
  const sms = new OrangeSms({ clientId: 'id', clientSecret: 'secret', expediteur: 'tel:+2250000', nomExpediteur: 'ORION' }, f.fn);
  const r = await sms.envoyer('+2250708091011', 'Bonjour');
  assert.equal(r.id, 'abc123');

  const [jeton, envoi] = f.appels;
  assert.equal(jeton!.url, 'https://api.orange.com/oauth/v3/token');
  assert.equal((jeton!.init.headers as Record<string, string>).authorization, `Basic ${Buffer.from('id:secret').toString('base64')}`);
  assert.equal(jeton!.init.body, 'grant_type=client_credentials');

  assert.equal(envoi!.url, 'https://api.orange.com/smsmessaging/v1/outbound/tel%3A%2B2250000/requests');
  assert.equal((envoi!.init.headers as Record<string, string>).authorization, 'Bearer jeton-1');
  assert.deepEqual(JSON.parse(String(envoi!.init.body)), {
    outboundSMSMessageRequest: {
      address: 'tel:+2250708091011', senderAddress: 'tel:+2250000', senderName: 'ORION',
      outboundSMSTextMessage: { message: 'Bonjour' },
    },
  });

  // Second envoi : le jeton en cache est réutilisé (pas de nouvelle authentification).
  await sms.envoyer('+2250708091011', 'Encore');
  assert.equal(f.appels.length, 3);
  assert.equal(f.appels[2]!.url.includes('/oauth/'), false);
});

test('Orange : jeton refusé en cours de route, renouvelé une fois puis envoi réussi', async () => {
  const f = faux([JETON, { status: 401, body: {} }, { status: 200, body: { access_token: 'jeton-2', expires_in: 3600 } }, ENVOYE]);
  const sms = new OrangeSms({ clientId: 'id', clientSecret: 's', expediteur: 'tel:+2250000' }, f.fn);
  await sms.envoyer('+2250708091011', 'x');
  assert.equal(f.appels.length, 4);
  assert.equal((f.appels[3]!.init.headers as Record<string, string>).authorization, 'Bearer jeton-2');
});

test('Orange : un refus de l’opérateur remonte une erreur explicite', async () => {
  const f = faux([JETON, { status: 400, body: { requestError: { serviceException: { messageId: 'SVC0004', text: 'No valid addresses provided' } } } }]);
  const sms = new OrangeSms({ clientId: 'id', clientSecret: 's', expediteur: 'tel:+2250000' }, f.fn);
  await assert.rejects(sms.envoyer('+2250708091011', 'x'), (e: unknown) => e instanceof SmsError && /400 · No valid addresses/.test(e.message));
  const mauvais = faux([{ status: 401, body: { error: 'invalid_client' } }]);
  await assert.rejects(new OrangeSms({ clientId: 'x', clientSecret: 'y', expediteur: 'tel:+2250000' }, mauvais.fn).envoyer('+2250708091011', 'x'), /authentification refusée/);
});

test('Twilio : authentification Basic et corps de formulaire', async () => {
  const f = faux([{ status: 201, body: { sid: 'SM123' } }]);
  const sms = new TwilioSms({ accountSid: 'AC1', authToken: 'tok', serviceMessagerie: 'MG9' }, f.fn);
  assert.equal((await sms.envoyer('+2250708091011', 'Salut')).id, 'SM123');
  const a = f.appels[0]!;
  assert.equal(a.url, 'https://api.twilio.com/2010-04-01/Accounts/AC1/Messages.json');
  assert.equal((a.init.headers as Record<string, string>).authorization, `Basic ${Buffer.from('AC1:tok').toString('base64')}`);
  const corps = new URLSearchParams(String(a.init.body));
  assert.equal(corps.get('To'), '+2250708091011');
  assert.equal(corps.get('MessagingServiceSid'), 'MG9');
  assert.equal(corps.get('Body'), 'Salut');
});

test('WhatsApp (Twilio) : expéditeur et destinataire « whatsapp: », message libre, état relu jusqu’à l’envoi', async () => {
  const f = faux([{ status: 201, body: { sid: 'SMwa1', status: 'queued' } }, { status: 200, body: { status: 'queued' } }, { status: 200, body: { status: 'sent' } }]);
  const wa = new TwilioWhatsApp({ accountSid: 'AC1', authToken: 'tok', de: '+14155238886' }, f.fn, async () => {});
  assert.equal((await wa.envoyer('+2250708091011', '240726', 'texte')).id, 'SMwa1');
  const [envoi, lecture1] = f.appels;
  assert.equal(envoi!.url, 'https://api.twilio.com/2010-04-01/Accounts/AC1/Messages.json');
  const corps = new URLSearchParams(String(envoi!.init.body));
  assert.equal(corps.get('From'), 'whatsapp:+14155238886');
  assert.equal(corps.get('To'), 'whatsapp:+2250708091011');
  assert.equal(corps.get('Body'), 'texte');
  assert.equal(corps.get('ContentSid'), null);
  assert.equal(lecture1!.url, 'https://api.twilio.com/2010-04-01/Accounts/AC1/Messages/SMwa1.json');
  assert.equal(f.appels.length, 3, 'la lecture s’arrête dès que le message est parti');
});

test('WhatsApp (Twilio) : modèle d’authentification approuvé, le code en variable {{1}}', async () => {
  const f = faux([{ status: 201, body: { sid: 'SMwa2' } }, { status: 200, body: { status: 'delivered' } }]);
  const wa = new TwilioWhatsApp({ accountSid: 'AC1', authToken: 'tok', de: 'whatsapp:+2250700000000', modele: 'HX123' }, f.fn, async () => {});
  await wa.envoyer('+2250708091011', '240726', 'texte');
  const corps = new URLSearchParams(String(f.appels[0]!.init.body));
  assert.equal(corps.get('From'), 'whatsapp:+2250700000000');
  assert.equal(corps.get('ContentSid'), 'HX123');
  assert.deepEqual(JSON.parse(corps.get('ContentVariables')!), { 1: '240726' });
  assert.equal(corps.get('Body'), null);
});

test('WhatsApp (Twilio) : un refus signalé après l’envoi remonte avec son code (63015, bac à sable)', async () => {
  const f = faux([{ status: 201, body: { sid: 'SMwa3' } }, { status: 200, body: { status: 'failed', error_code: 63015 } }]);
  const wa = new TwilioWhatsApp({ accountSid: 'AC1', authToken: 'tok', de: '+14155238886' }, f.fn, async () => {});
  await assert.rejects(wa.envoyer('+2250708091011', '1', 'x'), (e: unknown) => e instanceof SmsError && e.codeOperateur === 63015);
  const refus = faux([{ status: 400, body: { code: 21211, message: 'Invalid To' } }]);
  await assert.rejects(new TwilioWhatsApp({ accountSid: 'AC1', authToken: 'tok', de: '+1' }, refus.fn, async () => {}).envoyer('+2250708091011', '1', 'x'),
    (e: unknown) => e instanceof SmsError && e.codeOperateur === 21211 && /400 · Invalid To/.test(e.message));
});

test('WhatsApp : absent tant que le numéro d’expédition n’est pas réglé ; message au code en gras', () => {
  assert.equal(creerWhatsApp({ TWILIO_ACCOUNT_SID: 'AC1', TWILIO_AUTH_TOKEN: 'tok' }), null);
  assert.ok(creerWhatsApp({ TWILIO_ACCOUNT_SID: 'AC1', TWILIO_AUTH_TOKEN: 'tok', TWILIO_WHATSAPP_FROM: '+14155238886' }));
  assert.ok(messageCodeWhatsApp('240726', 5, 'client').startsWith('*240726* est votre code ORION'));
});

test('le SMS tient en un seul message et commence par le code (remplissage automatique)', () => {
  const m = messageCode('240726', 5, 'client');
  assert.ok(m.startsWith('240726 '));
  assert.ok(m.length <= 160, `${m.length} caractères`);
  assert.match(messageCode('111111', 5, 'chauffeur'), /ORION Chauffeur/);
});

test('plafond : 5 codes par heure et par numéro, un SMS non parti ne compte pas', () => {
  mock.timers.enable({ apis: ['Date'], now: 1_000_000 });
  try {
    const otps = new OtpStore();
    for (let i = 0; i < 5; i++) {
      assert.ok('code' in otps.issue('+2250700000000'));
      mock.timers.tick(31_000); // au-delà du délai de 30 s entre deux codes
    }
    const refus = otps.issue('+2250700000000');
    assert.ok('plafond' in refus && refus.plafond);
    // Un envoi échoué est annulé : il ne consomme pas le quota du client.
    const autre = new OtpStore();
    autre.issue('+2250711111111');
    autre.revoke('+2250711111111');
    assert.ok('code' in autre.issue('+2250711111111'), 'après annulation, un nouveau code est accordé tout de suite');
  } finally {
    mock.timers.reset();
  }
});
