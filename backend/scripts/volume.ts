import { writeFileSync } from 'node:fs';
import { buildApp } from '../src/app.js';
import type { Ride } from '../src/modules/rides/store.js';
import { issueDriverToken } from '../src/modules/driver-app/auth.js';
import { issueClientToken } from '../src/modules/clients/auth.js';
import type { Quote } from '../src/modules/services/types.js';

/**
 * BANC DE VOLUME : la console et le tableau de bord face à des millions de données.
 *
 * Charge en mémoire un historique massif (par défaut 1 000 000 de courses sur un an,
 * 2 écritures financières par course terminée, 20 000 chauffeurs, 300 000 clients), puis
 * chronomètre chaque lecture de la console et du tableau de bord, et les chemins chauds
 * des applications (position GPS d'un chauffeur, course en cours, historique client).
 *
 *   node --max-old-space-size=8192 --import tsx scripts/volume.ts
 *   VOLUME_COURSES=200000 … (taille réglable) ; VOLUME_RAPPORT=chemin.json
 */
const N = Number(process.env.VOLUME_COURSES ?? 1_000_000);
const CHAUFFEURS = Number(process.env.VOLUME_CHAUFFEURS ?? 20_000);
const CLIENTS = Number(process.env.VOLUME_CLIENTS ?? 300_000);
const JOURS = 365;
const AUTH = { 'x-admin-token': 'orion-admin-dev' };
const STATUTS: Array<[Ride['status'], number]> = [['rated', 46], ['paid', 30], ['completed', 8], ['cancelled', 9], ['no_driver', 7]];
const PAIEMENTS = ['orange_money', 'wave', 'mtn_momo', 'cash', 'card', 'moov_money'];
const GAMMES = ['bronze', 'argent', 'or', 'diamant'];
const tirer = <T>(l: Array<[T, number]>) => { let r = Math.random() * 100; for (const [v, p] of l) { r -= p; if (r <= 0) return v; } return l[0]![0]; };
const ms = (t: number) => Math.round((performance.now() - t) * 10) / 10;
const mo = () => Math.round(process.memoryUsage().heapUsed / 1048576);

async function main() {
  const { app, container } = await buildApp();
  const t0 = performance.now();

  for (let i = 0; i < CHAUFFEURS; i++) {
    const id = `vol-drv-${i}`;
    container.drivers.upsert({
      id, name: `Chauffeur ${i}`, matricule: `ORION-CI-${100000 + i}`, kycStatus: 'active', availability: 'offline',
      category: i % 6 === 5 ? 'moto' : GAMMES[i % 4]!, ratingAvg: 4.5 + (i % 50) / 100, ratingCount: 100 + (i % 900), phone: `+22507${String(10000000 + i)}`,
    } as never);
    if (i < 5000) await container.drivers.goOnline(id, { lat: 5.30 + (i % 70) * 0.002, lng: -4.08 + Math.floor(i / 70) * 0.002 });
  }
  for (let i = 0; i < CLIENTS; i++) container.clients.touch(`vol-cli-${i}`, { name: `Client ${i}`, phone: `+22505${String(10000000 + i)}` });
  const tCh = ms(t0);

  // Courses : réparties sur un an, plus récentes d'abord dans le temps ; ~3 000 en cours aujourd'hui.
  const maintenant = Date.now();
  const wallet = container.wallet;
  const t1 = performance.now();
  let ecritures = 0;
  for (let i = 0; i < N; i++) {
    const age = (i / N) * JOURS * 86_400_000;
    const cree = maintenant - JOURS * 86_400_000 + age + Math.random() * 60_000;
    const active = i >= N - 3000;
    let status: Ride['status'] = active ? (['accepted', 'driver_en_route', 'arrived', 'in_progress'] as const)[i % 4]! : tirer(STATUTS);
    // Une course terminée est payée dans l'heure : seules les deux dernières journées gardent
    // des courses « terminées, en attente de paiement ».
    if (status === 'completed' && maintenant - cree > 2 * 86_400_000) status = 'paid';
    const driverId = status === 'no_driver' ? undefined : `vol-drv-${i % CHAUFFEURS}`;
    const montant = 800 + (i % 60) * 75;
    const quote = {
      lockId: `vl${i}`, serviceType: i % 5 === 0 ? 'delivery' : 'ride', category: GAMMES[i % 4],
      origin: { lat: 5.30 + (i % 97) * 0.0012, lng: -4.08 + (i % 89) * 0.0013 }, destination: { lat: 5.34 + (i % 83) * 0.001, lng: -4.0 + (i % 79) * 0.001 },
      amount: montant, currency: 'XOF', distanceMeters: 2000 + (i % 80) * 100, etaSeconds: 600, trafficLevel: 'dense',
      breakdown: { base: 300, distance: 600, time: 200, surge: 1, traffic: 0, discount: 0, subtotal: montant, tva: 0, fee: 0, insurance: 0 },
    } as unknown as Quote;
    const at = (d: number) => new Date(cree + d).toISOString();
    const events: Ride['events'] = [{ type: 'created', at: at(0) }];
    if (driverId) events.push({ type: 'accepted', at: at(20_000) });
    if (status === 'completed' || status === 'paid' || status === 'rated') events.push({ type: 'completed', at: at(1_200_000) });
    if (status === 'paid' || status === 'rated') events.push({ type: 'paid', at: at(1_260_000) });
    if (status === 'rated') events.push({ type: 'rated', at: at(1_300_000), payload: { stars: 3 + (i % 3) } });
    if (status === 'cancelled') events.push({ type: 'cancelled', at: at(90_000) });
    const ride = {
      id: `vol-ride-${i}`, clientId: `vol-cli-${i % CLIENTS}`, driverId, serviceType: i % 5 === 0 ? 'delivery' : 'course', status,
      origin: quote.origin, destination: quote.destination, quote, events, paymentMethod: PAIEMENTS[i % PAIEMENTS.length],
      createdAt: at(0),
    } as unknown as Ride;
    container.rides.save(ride);
    if (driverId && (status === 'paid' || status === 'rated')) {
      wallet.importer({ driverId, type: 'ride_earning', amount: Math.round(montant * 0.8), rideId: ride.id, note: 'Course', at: at(1_260_000) });
      wallet.importer({ driverId, type: 'commission', amount: -Math.round(montant * 0.2), rideId: ride.id, note: 'Commission ORION', at: at(1_260_000) });
      ecritures += 2;
    }
  }
  for (let i = 0; i < 300; i++) container.safety.raiseSos({ userId: `vol-cli-${i}`, location: { lat: 5.33, lng: -4.0 }, rideId: `vol-ride-${N - 1 - i}`, source: 'client' });
  const tCo = ms(t1);
  console.log(`Chargement : ${N.toLocaleString('fr-FR')} courses, ${ecritures.toLocaleString('fr-FR')} écritures, ${CHAUFFEURS} chauffeurs, ${CLIENTS} clients · ${tCh} + ${tCo} ms · tas ${mo()} Mo`);

  /* ---------------- Chronométrage ---------------- */
  const resultats: Array<{ route: string; p50: number; max: number; octets: number; statut: number }> = [];
  const compresses: Array<{ route: string; brut: number; compresse: number; encodage: string }> = [];
  const mesurer = async (method: 'GET' | 'POST', url: string, opts: { headers?: Record<string, string>; payload?: unknown } = {}, repetitions = 3) => {
    const temps: number[] = [];
    let statut = 0;
    let octets = 0;
    for (let k = 0; k < repetitions; k++) {
      const t = performance.now();
      const r = await app.inject({ method, url, headers: opts.headers ?? AUTH, payload: opts.payload as never });
      temps.push(performance.now() - t);
      statut = r.statusCode; octets = r.rawPayload.length;
    }
    temps.sort((a, b) => a - b);
    const ligne = { route: `${method} ${url}`, p50: Math.round(temps[Math.floor(temps.length / 2)]! * 10) / 10, max: Math.round(temps[temps.length - 1]! * 10) / 10, octets, statut };
    resultats.push(ligne);
    console.log(`${String(ligne.p50).padStart(9)} ms  max ${String(ligne.max).padStart(9)}  ${String(octets).padStart(9)} o  ${statut}  ${ligne.route}`);
  };

  const lectures = [
    '/admin/overview', '/admin/stats?days=7', '/admin/stats?days=30', '/admin/rides?page=1&limit=50', '/admin/rides?page=5000&limit=50',
    '/admin/rides?status=in_progress&limit=50', '/admin/drivers?page=1&limit=50', '/admin/clients?page=1&limit=50', '/admin/search?q=Client%2042',
    '/admin/finance', '/admin/finance/cash-debt', '/admin/finance/gateways', '/admin/executive?days=30', '/admin/executive/livre?days=30&page=1',
    '/admin/liquidity', '/admin/treasury', '/admin/treasury/amortization', '/admin/green', '/admin/predict', '/admin/conversion', '/admin/fraud',
    '/admin/elasticity', '/admin/churn', '/admin/quality', '/admin/quality/csat', '/admin/sos', '/admin/alerts', '/admin/fleet/live', '/admin/crew',
    '/admin/vigilance', '/admin/mon-poste', '/admin/staff/productivity', '/admin/corporate', '/admin/reservations', '/admin/disputes',
    '/admin/drivers/expiring', '/admin/dashboard', '/admin/dashboard/analyse', '/admin/systeme/mesures',
    '/admin/executive/livre?days=365&page=1', '/admin/executive/livre?days=90&page=200', '/admin/executive?days=365',
    `/admin/rides/vol-ride-${N - 10}`, '/admin/drivers/vol-drv-42', '/admin/clients/vol-cli-42',
  ];
  console.log('\n— Console et tableau de bord —');
  const seulement = process.env.VOLUME_SEULEMENT?.split(',');
  for (const url of seulement ?? lectures) await mesurer('GET', url, {}, seulement ? 10 : 3);
  if (seulement) { await app.close(); return; }

  console.log('\n— Exports (écrits par tranches) —');
  await mesurer('GET', '/admin/rides.csv?jours=31', {}, 1);
  await mesurer('GET', '/admin/executive/livre.csv?days=90', {}, 1);

  console.log('\n— Poids sur le réseau (compression Brotli) —');
  for (const url of ['/admin/fleet/live', '/admin/sos', '/admin/dashboard', '/admin/executive?days=30']) {
    const brut = (await app.inject({ method: 'GET', url, headers: AUTH })).rawPayload.length;
    const r = await app.inject({ method: 'GET', url, headers: { ...AUTH, 'accept-encoding': 'br' } });
    compresses.push({ route: url, brut, compresse: r.rawPayload.length, encodage: String(r.headers['content-encoding'] ?? 'aucun') });
    console.log(`${String(brut).padStart(9)} o → ${String(r.rawPayload.length).padStart(8)} o  (${r.headers['content-encoding'] ?? 'aucun'})  ${url}`);
  }

  console.log('\n— Chemins chauds des applications (avec jetons) —');
  const chauffeur = { authorization: `Bearer ${issueDriverToken('vol-drv-7').token}` };
  const client = { authorization: `Bearer ${issueClientToken('vol-cli-7').token}` };
  await mesurer('GET', '/drivers/vol-drv-7/active-ride', { headers: chauffeur }, 5);
  await mesurer('GET', '/drivers/vol-drv-7/rides', { headers: chauffeur }, 5);
  await mesurer('POST', '/drivers/vol-drv-7/location', { headers: { ...chauffeur, 'content-type': 'application/json' }, payload: { position: { lat: 5.33, lng: -4.01 } } }, 20);
  await mesurer('GET', '/clients/vol-cli-7/history', { headers: client }, 5);
  const q = (await app.inject({ method: 'POST', url: '/pricing/estimate', payload: { origin: { lat: 5.32, lng: -4.02 }, destination: { lat: 5.36, lng: -3.99 }, category: 'bronze', clientId: 'vol-cli-9' } })).json().quote;
  const t = performance.now();
  const cmd = await app.inject({ method: 'POST', url: '/rides', headers: { 'idempotency-key': 'vol-1' }, payload: { clientId: 'vol-cli-9', lockId: q.lockId } });
  resultats.push({ route: 'POST /rides', p50: ms(t), max: ms(t), octets: cmd.rawPayload.length, statut: cmd.statusCode });
  console.log(`${String(ms(t)).padStart(9)} ms  POST /rides (${cmd.statusCode})`);

  const lents = resultats.filter((r) => r.p50 > 50).sort((a, b) => b.p50 - a.p50);
  console.log(`\nTas : ${mo()} Mo · ${lents.length} lecture(s) au-delà de 50 ms`);
  if (process.env.VOLUME_RAPPORT) writeFileSync(process.env.VOLUME_RAPPORT, JSON.stringify({ courses: N, ecritures, chauffeurs: CHAUFFEURS, clients: CLIENTS, chargementMs: tCh + tCo, tasMo: mo(), resultats, compresses }, null, 1));
  await app.close();
}

main().catch((e) => { console.error(e); process.exit(1); });
