import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { enWav, synthetiser, texteAPrononcer, voixHumaine, type Recuperer } from '../src/modules/voix/humaine.js';

/**
 * VOIX HUMAINE : l'accueil est dit par une voix d'IA (Gemini, ChatGPT…) fabriquée sur le
 * serveur, préparée pendant l'approche et jouée à bord. Les appels aux fournisseurs sont
 * simulés : on vérifie ce qui leur est envoyé, le cache, la clé chiffrée et les droits.
 */
const AUTH = { 'x-admin-token': 'orion-admin-dev' };
const ORIGIN = { lat: 5.335, lng: -4.03 };
const DEST = { lat: 5.345, lng: -4.02 };
const MP3 = Buffer.from('ID3-son-de-test-mp3');

interface Appel { url: string; corps: Record<string, unknown>; entetes: Record<string, string> }
function fauxFournisseur(reponse: (url: string, corps: Record<string, unknown>) => Response) {
  const appels: Appel[] = [];
  const recuperer: Recuperer = async (url, init) => {
    const corps = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
    appels.push({ url, corps, entetes: (init?.headers ?? {}) as Record<string, string> });
    return reponse(url, corps);
  };
  return { appels, recuperer };
}
const json = (v: unknown, status = 200) => new Response(JSON.stringify(v), { status, headers: { 'content-type': 'application/json' } });

test('texte prononcé : sigles et symboles dits comme une personne', () => {
  assert.equal(texteAPrononcer('Bienvenue à bord d’ORION. Wi-Fi gratuit, pris en charge à 100 %.'), 'Bienvenue à bord d’Orion. wifi gratuit, pris en charge à 100 pour cent.');
  const wav = enWav(Buffer.alloc(48000), 24000);
  assert.equal(wav.subarray(0, 4).toString(), 'RIFF');
  assert.equal(wav.readUInt32LE(24), 24000);
  assert.equal(wav.length, 48044);
});

test('fournisseurs : consigne de ton et voix envoyées, repli Chirp 3 HD, WAV de Gemini', async () => {
  // Google : Gemini-TTS d'abord (consigne de ton), refusé ici → la même voix en Chirp 3 HD.
  const g = fauxFournisseur((_u, c) => ((c.voice as { modelName?: string }).modelName ? json({ error: { message: 'Gemini-TTS indisponible' } }, 400) : json({ audioContent: MP3.toString('base64') })));
  const a = await synthetiser({ fournisseur: 'google', cle: 'cle-google-test-123', voix: 'Sulafat', style: 'Voix chaleureuse', texte: 'Bonjour Monsieur, bienvenue à bord d’ORION.', recuperer: g.recuperer });
  assert.equal(g.appels.length, 2);
  assert.equal(g.appels[0]!.url, 'https://texttospeech.googleapis.com/v1/text:synthesize');
  assert.equal(g.appels[0]!.entetes['x-goog-api-key'], 'cle-google-test-123');
  assert.deepEqual(g.appels[0]!.corps.input, { prompt: 'Voix chaleureuse', text: 'Bonjour Monsieur, bienvenue à bord d’Orion.' });
  assert.deepEqual(g.appels[0]!.corps.voice, { languageCode: 'fr-FR', name: 'Sulafat', modelName: 'gemini-2.5-flash-tts' });
  assert.deepEqual(g.appels[1]!.corps.voice, { languageCode: 'fr-FR', name: 'fr-FR-Chirp3-HD-Sulafat' });
  assert.equal(a.modele, 'chirp3-hd');
  assert.equal(a.type, 'audio/mpeg');
  assert.deepEqual(a.octets, MP3);

  // Gemini (AI Studio) : son PCM 24 kHz emballé en WAV ; modèle renommé (404) → le suivant.
  const pcm = Buffer.alloc(4800, 1);
  const ge = fauxFournisseur((u) => (u.includes('gemini-3-tts') ? json({ error: { message: 'not found' } }, 404)
    : json({ candidates: [{ content: { parts: [{ inlineData: { mimeType: 'audio/L16;codec=pcm;rate=24000', data: pcm.toString('base64') } }] } }] })));
  const b = await synthetiser({ fournisseur: 'gemini', cle: 'cle-gemini-test-123', voix: 'Achird', style: 'Ton souriant', texte: 'Bonsoir Madame.', modele: 'gemini-3-tts', recuperer: ge.recuperer });
  assert.match(ge.appels[1]!.url, /models\/gemini-2\.5-flash-preview-tts:generateContent$/);
  const conf = ge.appels[1]!.corps.generationConfig as { responseModalities: string[]; speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: string } } } };
  assert.deepEqual(conf.responseModalities, ['AUDIO']);
  assert.equal(conf.speechConfig.voiceConfig.prebuiltVoiceConfig.voiceName, 'Achird');
  assert.equal(b.type, 'audio/wav');
  assert.equal(b.octets.length, 4800 + 44);

  // OpenAI : voix de ChatGPT, consigne de ton dans « instructions ».
  const o = fauxFournisseur(() => new Response(MP3, { status: 200, headers: { 'content-type': 'audio/mpeg' } }));
  const c = await synthetiser({ fournisseur: 'openai', cle: 'sk-test-openai-123', voix: 'marin', style: 'Chaleureuse', texte: 'Bonjour.', recuperer: o.recuperer });
  assert.equal(o.appels[0]!.url, 'https://api.openai.com/v1/audio/speech');
  assert.equal(o.appels[0]!.entetes.authorization, 'Bearer sk-test-openai-123');
  assert.deepEqual(o.appels[0]!.corps, { model: 'gpt-4o-mini-tts', voice: 'marin', input: 'Bonjour.', instructions: 'Chaleureuse', response_format: 'mp3' });
  assert.deepEqual(c.octets, MP3);

  // Gemini-TTS refusé (droit Vertex AI absent) : retenu, l'accueil suivant va droit à Chirp 3 HD.
  const v = fauxFournisseur((_u, c) => ((c.voice as { modelName?: string }).modelName ? json({ error: { message: 'Permission aiplatform.endpoints.predict denied' } }, 403) : json({ audioContent: MP3.toString('base64') })));
  const cleVertex = 'cle-sans-vertex-456';
  await synthetiser({ fournisseur: 'google', cle: cleVertex, voix: 'Achird', style: 'Chaleureux', texte: 'Bonjour.', recuperer: v.recuperer });
  assert.equal(v.appels.length, 2, 'Gemini-TTS refusé puis Chirp 3 HD');
  const suite = await synthetiser({ fournisseur: 'google', cle: cleVertex, voix: 'Achird', style: 'Chaleureux', texte: 'Bonsoir.', recuperer: v.recuperer });
  assert.equal(v.appels.length, 3, 'un seul appel ensuite');
  assert.equal((v.appels[2]!.corps.voice as { name: string }).name, 'fr-FR-Chirp3-HD-Achird');
  assert.equal(suite.modele, 'chirp3-hd');
  const direct = fauxFournisseur(() => json({ audioContent: MP3.toString('base64') }));
  await synthetiser({ fournisseur: 'google', cle: 'autre-cle-789', voix: 'Sulafat', style: '', texte: 'Bonjour.', modele: 'chirp3-hd', recuperer: direct.recuperer });
  assert.equal(direct.appels.length, 1, 'modèle « chirp3-hd » choisi : Chirp directement');

  // ElevenLabs : identifiant de voix obligatoire.
  await assert.rejects(synthetiser({ fournisseur: 'elevenlabs', cle: 'cle-eleven-123', voix: '', style: '', texte: 'Bonjour.', recuperer: o.recuperer }), /Voice ID/);
});

async function chauffeur(app: FastifyInstance, phone: string, name: string) {
  const otp = (await app.inject({ method: 'POST', url: '/drivers/auth/otp', payload: { phone } })).json();
  const v = (await app.inject({ method: 'POST', url: '/drivers/auth/verify', payload: { phone, code: otp.devCode, name } })).json();
  await app.inject({ method: 'POST', url: `/admin/drivers/${v.driver.id}/kyc`, headers: AUTH, payload: { status: 'active' } });
  await app.inject({ method: 'POST', url: `/drivers/${v.driver.id}/online`, headers: { authorization: `Bearer ${v.token}` }, payload: { position: ORIGIN } });
  return { id: v.driver.id as string, h: { authorization: `Bearer ${v.token}` } };
}

test('console : clé chiffrée jamais renvoyée, essai d’écoute, accueil préparé pendant l’approche', async (t) => {
  const { app, container } = await buildApp();
  t.after(() => app.close());
  const f = fauxFournisseur(() => json({ audioContent: MP3.toString('base64') }));
  voixHumaine(container, { recuperer: f.recuperer, env: {} });

  // Rien de réglé : la voix du téléphone parle (ORION Pro le sait).
  const k = await chauffeur(app, '0701020690', 'Konan Yao');
  assert.equal((await app.inject({ method: 'GET', url: `/drivers/${k.id}/voix-bord/humaine`, headers: k.h })).json().active, false);
  assert.equal((await app.inject({ method: 'GET', url: `/drivers/${k.id}/voix-bord/essai/audio`, headers: k.h })).statusCode, 409);

  // La direction choisit Google (voix Gemini) et colle sa clé.
  const CLE = 'AQ.cle-de-test-voix-google-0042';
  const put = await app.inject({ method: 'PUT', url: '/admin/voix-humaine', headers: AUTH, payload: { fournisseur: 'google', voix: { feminine: 'Vindemiatrix' }, cle: CLE } });
  assert.equal(put.statusCode, 200, put.body);
  const etat = put.json();
  assert.equal(etat.active, true);
  assert.deepEqual(etat.cles.google, { enregistree: true, source: 'console', fin: '0042' });
  assert.equal(etat.voix.google.feminine, 'Vindemiatrix');
  assert.equal(etat.voix.google.masculine, 'Achird');
  assert.ok(!JSON.stringify(etat).includes(CLE), 'la clé ne revient jamais');
  const lu = await app.inject({ method: 'GET', url: '/admin/voix-humaine', headers: AUTH });
  assert.ok(!lu.body.includes(CLE));
  const enBase = JSON.stringify((voixHumaine(container) as unknown as { depot: { all(): unknown[] } }).depot.all());
  assert.ok(enBase.includes('"cles"') && !enBase.includes(CLE), 'ni en clair dans la base (chiffrée)');
  assert.equal((await app.inject({ method: 'PUT', url: '/admin/voix-humaine', headers: AUTH, payload: { fournisseur: 'google', cle: 'a b c d e f g h' } })).statusCode, 400);

  // Essai d'écoute depuis la console : un son, la clé enregistrée envoyée à Google.
  const essai = await app.inject({ method: 'POST', url: '/admin/voix-humaine/essai', headers: AUTH, payload: { fournisseur: 'google', genre: 'masculine' } });
  assert.equal(essai.statusCode, 200, essai.body);
  assert.equal(essai.headers['content-type'], 'audio/mpeg');
  assert.equal(essai.headers['x-orion-voix'], 'google:Achird');
  assert.deepEqual(essai.rawPayload, MP3);
  assert.equal(f.appels.at(-1)!.entetes['x-goog-api-key'], CLE);
  assert.match(String((f.appels.at(-1)!.corps.input as { text: string }).text), /Madame Aya Kouassi/);

  // Course : le son de l'accueil se prépare dès l'approche, puis sert tel quel à bord.
  const o = (await app.inject({ method: 'POST', url: '/clients/auth/otp', payload: { phone: '0707070690' } })).json();
  const c = (await app.inject({ method: 'POST', url: '/clients/auth/verify', payload: { clientId: 'c-0707070690', phone: '0707070690', code: o.devCode, name: 'Yao Jean-Marc', civilite: 'M' } })).json();
  const ch = { authorization: `Bearer ${c.token}` };
  const q = (await app.inject({ method: 'POST', url: '/pricing/estimate', payload: { origin: ORIGIN, destination: DEST, category: 'argent' } })).json().quote;
  const cree = (await app.inject({ method: 'POST', url: '/rides', headers: { 'idempotency-key': 'vh-1', ...ch }, payload: { clientId: c.client.id, lockId: q.lockId, paymentMethod: 'cash' } })).json();
  const id = cree.ride.id as string;
  assert.equal((await app.inject({ method: 'GET', url: `/rides/${id}/bienvenue/audio`, headers: ch })).statusCode, 403, 'réservé au chauffeur');
  await app.inject({ method: 'POST', url: `/rides/${id}/transition`, headers: k.h, payload: { to: 'driver_en_route' } });
  const avant = f.appels.length;
  const son = await app.inject({ method: 'GET', url: `/rides/${id}/bienvenue/audio`, headers: k.h });
  assert.equal(son.statusCode, 200, son.body);
  assert.equal(son.headers['x-orion-voix'], 'google:Vindemiatrix', 'voix féminine pour un client');
  assert.match(String((f.appels.at(-1)!.corps.input as { text: string }).text), /Monsieur Yao Jean-Marc, bienvenue à bord d’Orion/);
  const empreinte = son.headers['x-orion-empreinte'];
  assert.ok(empreinte);

  await app.inject({ method: 'POST', url: `/rides/${id}/transition`, headers: k.h, payload: { to: 'arrived' } });
  await app.inject({ method: 'POST', url: `/rides/${id}/start`, headers: k.h, payload: { code: cree.codePriseEnCharge } });
  const m = (await app.inject({ method: 'GET', url: `/rides/${id}/bienvenue`, headers: k.h })).json();
  assert.equal(m.voixHumaine.empreinte, empreinte, 'le son préparé est celui de l’accueil');
  assert.equal(m.voixHumaine.pret, true);
  const encore = await app.inject({ method: 'GET', url: `/rides/${id}/bienvenue/audio`, headers: k.h });
  assert.deepEqual(encore.rawPayload, MP3);
  assert.equal(f.appels.length, avant + 1, 'fabriqué une seule fois');

  // Le fournisseur refuse (clé révoquée) : message clair, sans la clé ; l'app parle avec le téléphone.
  voixHumaine(container, { recuperer: async () => json({ error: { message: `API key not valid: ${CLE}` } }, 403), env: {} });
  await app.inject({ method: 'PUT', url: '/admin/voix-humaine', headers: AUTH, payload: { fournisseur: 'google', cle: CLE } });
  const refus = await app.inject({ method: 'POST', url: '/admin/voix-humaine/essai', headers: AUTH, payload: { fournisseur: 'google' } });
  assert.equal(refus.statusCode, 502);
  assert.match(refus.json().error.message, /API key not valid/);
  assert.ok(!refus.body.includes(CLE), 'la clé est masquée dans l’erreur');

  // Retour à la voix du téléphone.
  const off = (await app.inject({ method: 'PUT', url: '/admin/voix-humaine', headers: AUTH, payload: { fournisseur: 'aucun' } })).json();
  assert.equal(off.active, false);
  assert.equal(off.cles.google.enregistree, true, 'la clé reste gardée pour plus tard');
});
