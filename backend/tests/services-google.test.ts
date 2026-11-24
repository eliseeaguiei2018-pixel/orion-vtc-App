import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { analyserMeteo, eclaircir, encoderPolyligne, servicesGoogle } from '../src/modules/google/services.js';
import { voixHumaine } from '../src/modules/voix/humaine.js';

/**
 * SERVICES GOOGLE DU SERVEUR : météo et pluie par commune, recalage du tracé GPS en fin de
 * course, image du trajet, photo du point de prise en charge. Google est simulé : on vérifie
 * ce qui lui est demandé, la lecture des réponses, les droits et la coupure depuis la console.
 */
const AUTH = { 'x-admin-token': 'orion-admin-dev' };
const ORIGIN = { lat: 5.3236, lng: -4.0217 };
const DEST = { lat: 5.345, lng: -4.02 };
const JPG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);
const CLE = 'cle-serveur-de-test-9876';

const heure = (iso: string, type: string, proba: number, mm = 0, t = 27) => ({
  interval: { startTime: iso }, weatherCondition: { type, description: { text: type === 'CLEAR' ? 'Dégagé' : 'Averses' } },
  temperature: { degrees: t }, feelsLikeTemperature: { degrees: t + 3 }, relativeHumidity: 80, isDaytime: true,
  precipitation: { probability: { percent: proba }, qpf: { quantity: mm } },
});

test('météo : prochaine pluie repérée, niveau et délai', () => {
  const t0 = Date.parse('2026-11-24T12:00:00Z');
  const m = analyserMeteo([
    heure('2026-11-24T12:00:00Z', 'CLEAR', 0),
    heure('2026-11-24T13:00:00Z', 'PARTLY_CLOUDY', 20),
    heure('2026-11-24T14:00:00Z', 'HEAVY_RAIN_SHOWERS', 80, 6),
  ], t0)!;
  assert.equal(m.temperature, 27);
  assert.equal(m.ressenti, 30);
  assert.equal(m.description, 'Dégagé');
  assert.equal(m.alerte?.niveau, 'forte_pluie');
  assert.equal(m.alerte?.dansMinutes, 120);
  assert.equal(analyserMeteo([heure('2026-11-24T12:00:00Z', 'CLEAR', 0)], t0)!.alerte, null);
  assert.equal(analyserMeteo([heure('2026-11-24T12:00:00Z', 'THUNDERSTORM', 70)], t0)!.alerte?.niveau, 'orage');
});

test('polyligne encodée (format Google) et éclaircissement du tracé', () => {
  assert.equal(encoderPolyligne([{ lat: 38.5, lng: -120.2 }, { lat: 40.7, lng: -120.95 }, { lat: 43.252, lng: -126.453 }]), '_p~iF~ps|U_ulLnnqC_mqNvxq`@');
  const pts = Array.from({ length: 1000 }, (_, i) => i);
  const e = eclaircir(pts, 10);
  assert.equal(e.length, 10);
  assert.equal(e[0], 0);
  assert.equal(e[9], 999);
});

async function chauffeur(app: FastifyInstance, phone: string, name: string) {
  const otp = (await app.inject({ method: 'POST', url: '/drivers/auth/otp', payload: { phone } })).json();
  const v = (await app.inject({ method: 'POST', url: '/drivers/auth/verify', payload: { phone, code: otp.devCode, name } })).json();
  await app.inject({ method: 'POST', url: `/admin/drivers/${v.driver.id}/kyc`, headers: AUTH, payload: { status: 'active' } });
  await app.inject({ method: 'POST', url: `/drivers/${v.driver.id}/online`, headers: { authorization: `Bearer ${v.token}` }, payload: { position: ORIGIN } });
  return { id: v.driver.id as string, h: { authorization: `Bearer ${v.token}` } };
}

test('course : photo du point de prise en charge, trajet recalé à l’arrivée, image du trajet', async (t) => {
  const { app, container } = await buildApp();
  t.after(() => app.close());
  const appels: string[] = [];
  servicesGoogle(container, {
    env: { GOOGLE_SERVER_API_KEY: CLE },
    recuperer: async (url) => {
      appels.push(url);
      if (url.includes('weather.googleapis.com')) {
        return Response.json({ forecastHours: [heure(new Date().toISOString(), 'CLEAR', 0), heure(new Date(Date.now() + 3600_000).toISOString(), 'RAIN', 70, 2)] });
      }
      if (url.includes('streetview/metadata')) return Response.json({ status: 'OK', date: '2019-04', copyright: '© Projet ATP MCA Côte d\'Ivoire', location: { lat: 5.3238, lng: -4.0213 } });
      if (url.includes('maps/api/streetview') || url.includes('staticmap')) return new Response(JPG, { headers: { 'content-type': 'image/jpeg' } });
      if (url.includes('roads.googleapis.com')) {
        const n = new URL(url).searchParams.get('path')!.split('|').length;
        return Response.json({ snappedPoints: Array.from({ length: n }, (_, i) => ({ location: { latitude: 5.33 + i * 0.001, longitude: -4.02 }, originalIndex: i })) });
      }
      return new Response('{}', { status: 404 });
    },
  });
  const k = await chauffeur(app, '0701020790', 'Konan Yao');

  // Météo : la commune du chauffeur, et la pluie qui arrive dans l'heure.
  const met = (await app.inject({ method: 'GET', url: `/drivers/${k.id}/meteo?lat=5.3236&lng=-4.0217`, headers: k.h })).json().meteo;
  assert.equal(met.commune, 'Plateau');
  assert.equal(met.meteo.description, 'Dégagé');
  assert.ok(met.alertes.length >= 1 && met.alertes[0].alerte.niveau === 'pluie');
  const nbMeteo = appels.filter((u) => u.includes('weather')).length;
  assert.ok(nbMeteo <= 11, `11 communes au plus (${nbMeteo})`);
  await app.inject({ method: 'GET', url: `/drivers/${k.id}/meteo?lat=5.36&lng=-3.98`, headers: k.h });
  assert.equal(appels.filter((u) => u.includes('weather')).length, nbMeteo, 'un deuxième chauffeur ne coûte aucun appel');

  const o = (await app.inject({ method: 'POST', url: '/clients/auth/otp', payload: { phone: '0707070790' } })).json();
  const c = (await app.inject({ method: 'POST', url: '/clients/auth/verify', payload: { clientId: 'c-0707070790', phone: '0707070790', code: o.devCode, name: 'Aya Kouassi' } })).json();
  const ch = { authorization: `Bearer ${c.token}` };
  const q = (await app.inject({ method: 'POST', url: '/pricing/estimate', payload: { origin: ORIGIN, destination: DEST, category: 'argent' } })).json().quote;
  const cree = (await app.inject({ method: 'POST', url: '/rides', headers: { 'idempotency-key': 'g-1', ...ch }, payload: { clientId: c.client.id, lockId: q.lockId, paymentMethod: 'cash' } })).json();
  const id = cree.ride.id as string;
  await app.inject({ method: 'POST', url: `/rides/${id}/transition`, headers: k.h, payload: { to: 'driver_en_route' } });

  // Point de prise en charge : réservé au chauffeur, la clé ne sort pas du serveur.
  assert.deepEqual((await app.inject({ method: 'GET', url: `/rides/${id}/point-de-rencontre`, headers: k.h })).json(), { disponible: true, date: '2019-04', source: 'Projet ATP MCA Côte d\'Ivoire' });
  assert.equal((await app.inject({ method: 'GET', url: `/rides/${id}/point-de-rencontre`, headers: ch })).statusCode, 403);
  const sv = await app.inject({ method: 'GET', url: `/rides/${id}/point-de-rencontre.jpg`, headers: k.h });
  assert.equal(sv.statusCode, 200);
  assert.equal(sv.headers['content-type'], 'image/jpeg');
  assert.ok(!sv.body.includes(CLE));
  assert.match(appels.find((u) => u.includes('maps/api/streetview?'))!, /heading=\d+/, 'caméra tournée vers le client');

  // En course : des positions GPS, puis l'arrivée → recalage automatique sur les routes.
  await app.inject({ method: 'POST', url: `/rides/${id}/transition`, headers: k.h, payload: { to: 'arrived' } });
  await app.inject({ method: 'POST', url: `/rides/${id}/start`, headers: k.h, payload: { code: cree.codePriseEnCharge } });
  for (let i = 0; i < 6; i++) {
    await app.inject({ method: 'POST', url: `/drivers/${k.id}/location`, headers: k.h, payload: { position: { lat: 5.3236 + i * 0.0035, lng: -4.0217 + i * 0.0002 } } });
  }
  await app.inject({ method: 'POST', url: `/rides/${id}/transition`, headers: k.h, payload: { to: 'completed' } });
  for (let i = 0; i < 20 && !container.rides.get(id)!.recalage; i++) await new Promise((r) => setTimeout(r, 25));
  const rec = container.rides.get(id)!.recalage;
  assert.ok(rec, 'tracé recalé à l’arrivée');
  assert.ok(rec.points.length >= 2);
  assert.ok(rec.distanceM > 0);
  assert.ok(appels.some((u) => u.includes('roads.googleapis.com') && u.includes('interpolate=true')));

  // Image du trajet : le client de la course la voit ; un inconnu, non ; la console aussi.
  const carte = await app.inject({ method: 'GET', url: `/rides/${id}/carte.jpg`, headers: ch });
  assert.equal(carte.statusCode, 200);
  assert.deepEqual(carte.rawPayload, JPG);
  const urlCarte = appels.find((u) => u.includes('staticmap'))!;
  assert.match(decodeURIComponent(urlCarte), /path=color:0x16a34aff\|weight:5\|enc:/);
  assert.match(decodeURIComponent(urlCarte), /markers=color:0x16a34a\|label:A\|5\.3236,-4\.0217/);
  assert.equal((await app.inject({ method: 'GET', url: `/rides/${id}/carte.jpg` })).statusCode, 401);
  assert.equal((await app.inject({ method: 'GET', url: `/admin/courses/${id}/carte.jpg`, headers: AUTH })).statusCode, 200);

  // Console : état, appels du jour comptés, coupure d'un service.
  const etat = (await app.inject({ method: 'GET', url: '/admin/services-google', headers: AUTH })).json();
  assert.deepEqual(etat.cle, { presente: true, source: 'variable', fin: '9876' });
  assert.ok(etat.services.recalage.appelsDuJour >= 1);
  assert.ok(!JSON.stringify(etat).includes(CLE));
  const coupe = (await app.inject({ method: 'PUT', url: '/admin/services-google', headers: AUTH, payload: { actifs: { streetview: false } } })).json();
  assert.equal(coupe.services.streetview.actif, false);
  assert.equal(coupe.services.meteo.actif, true);
  const communes = (await app.inject({ method: 'GET', url: '/admin/meteo', headers: AUTH })).json().communes;
  assert.equal(communes.length, 11);
});

test('point de prise en charge : une photo déposée par un particulier (toit, intérieur) est écartée', async (t) => {
  const { app, container } = await buildApp();
  t.after(() => app.close());
  const s = servicesGoogle(container, { env: { GOOGLE_SERVER_API_KEY: CLE }, recuperer: async () => Response.json({ status: 'OK', date: '2019-12', copyright: '© M BB', location: { lat: 5.3236, lng: -4.0217 } }) });
  assert.deepEqual(await s.streetViewDispo({ lat: 5.3236, lng: -4.0217 }), { disponible: false, date: '2019-12', source: 'M BB' });
  assert.equal(await s.streetViewImage({ lat: 5.3236, lng: -4.0217 }), null);
});

test('sans clé Google : services éteints, rien n’est appelé, l’app continue', async (t) => {
  const { app, container } = await buildApp();
  t.after(() => app.close());
  let appels = 0;
  servicesGoogle(container, { env: {}, recuperer: async () => { appels++; return new Response('{}'); } });
  voixHumaine(container, { env: {} });
  const k = await chauffeur(app, '0701020791', 'Bamba Lassina');
  assert.equal((await app.inject({ method: 'GET', url: `/drivers/${k.id}/meteo?lat=5.33&lng=-4.02`, headers: k.h })).json().meteo, null);
  const etat = (await app.inject({ method: 'GET', url: '/admin/services-google', headers: AUTH })).json();
  assert.equal(etat.cle.presente, false);
  assert.equal(etat.services.meteo.actif, false);
  assert.equal(appels, 0);
});
