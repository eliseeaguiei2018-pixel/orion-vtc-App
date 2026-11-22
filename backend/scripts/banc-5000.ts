import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';

/**
 * BANC « 5000 UTILISATEURS SIMULTANÉS » — test sur le terrain, en accéléré.
 *
 * De vrais comptes créés par les routes des applications (code de connexion, session),
 * de vraies connexions temps réel, de vraies courses de bout en bout, contre un serveur qui
 * tourne (pas une application en mémoire dans le même processus) :
 *
 *  - N chauffeurs (app chauffeur) : inscription, validation par la console (attribution du
 *    véhicule), mise en ligne à un endroit d'Abidjan, canal temps réel personnel, position
 *    toutes les 5 s (3 s en course), réponse aux offres, course jusqu'à l'encaissement ;
 *  - M clients (app cliente) : inscription, canal de configuration temps réel ouvert, consultation
 *    de prix ; une partie commande des courses (devis, commande, suivi, code, note) ;
 *  - quelques consoles de la direction : connexion, tableaux toutes les 6 s, canal /ws/console.
 *
 * Chaque téléphone simulé a sa propre adresse (en-tête X-Forwarded-For ; le serveur doit tourner
 * avec TRUST_PROXY_HOPS=1) : c'est ainsi que le limiteur voit de vrais téléphones distincts.
 *
 *   NODE_ENV=development TRUST_PROXY_HOPS=1 SIMULATE_RIDES=false LOG_LEVEL=warn node dist/server.js
 *   npx tsx scripts/banc-5000.ts --chauffeurs 1000 --clients 4000 --courses 800 --duree 180
 *
 * Mesures : temps de réponse par route (médiane, 95e, 99e centiles), erreurs et refus (429),
 * délai commande → offre chez le chauffeur, courses servies, retard de la boucle d'événements
 * du serveur, mémoire et processeur du serveur, connexions temps réel ouvertes.
 */
const arg = (nom: string, defaut: string) => {
  const i = process.argv.indexOf(`--${nom}`);
  return i > 0 && process.argv[i + 1] ? process.argv[i + 1]! : defaut;
};
const API = arg('api', 'http://localhost:3000');
const WS = API.replace(/^http/, 'ws');
const N_CHAUFFEURS = Number(arg('chauffeurs', '1000'));
const N_CLIENTS = Number(arg('clients', '4000'));
const N_COURSES = Number(arg('courses', '800'));
const DUREE_S = Number(arg('duree', '180'));
const N_CONSOLES = Number(arg('consoles', '3'));
const JETON_ADMIN = arg('jeton', 'orion-admin-dev');
const RAPPORT = arg('rapport', '');
const PID = Number(arg('pid', '0'));

const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));
const hasard = (a: number, b: number) => a + Math.random() * (b - a);
const ipDe = (i: number) => `41.${66 + (i >> 16) % 100}.${(i >> 8) & 255}.${i & 255}`;

/* ------------------------------- Mesures ------------------------------- */
class Serie {
  v: number[] = [];
  ajouter(x: number) { this.v.push(x); }
  centiles() {
    if (!this.v.length) return { n: 0, p50: 0, p95: 0, p99: 0, max: 0 };
    const s = Float64Array.from(this.v).sort();
    const q = (p: number) => Math.round(s[Math.min(s.length - 1, Math.floor(p * s.length))]!);
    return { n: s.length, p50: q(0.5), p95: q(0.95), p99: q(0.99), max: Math.round(s[s.length - 1]!) };
  }
}
const parRoute = new Map<string, Serie>();
const statuts = new Map<number, number>();
let erreursReseau = 0;
const noter = (route: string, ms: number, statut: number) => {
  (parRoute.get(route) ?? parRoute.set(route, new Serie()).get(route)!).ajouter(ms);
  statuts.set(statut, (statuts.get(statut) ?? 0) + 1);
};

async function appel<T>(route: string, methode: string, chemin: string, ip: string, corps?: unknown, entetes: Record<string, string> = {}): Promise<{ statut: number; data: T }> {
  const t0 = performance.now();
  try {
    const r = await fetch(`${API}${chemin}`, {
      method: methode,
      headers: { 'x-forwarded-for': ip, ...(corps !== undefined ? { 'content-type': 'application/json' } : {}), ...entetes },
      body: corps !== undefined ? JSON.stringify(corps) : undefined,
    });
    const texte = await r.text();
    noter(route, performance.now() - t0, r.status);
    let data: unknown = null;
    try { data = texte ? JSON.parse(texte) : null; } catch { /* corps non JSON */ }
    return { statut: r.status, data: data as T };
  } catch {
    erreursReseau += 1;
    noter(route, performance.now() - t0, 0);
    return { statut: 0, data: null as T };
  }
}

/* ------------------------------- Abidjan ------------------------------- */
// Communes du district (centre approximatif, rayon en degrés) : on y place chauffeurs et clients.
const COMMUNES = [
  { lat: 5.3236, lng: -4.0217, r: 0.010 }, // Plateau
  { lat: 5.3596, lng: -3.9903, r: 0.025 }, // Cocody
  { lat: 5.3007, lng: -3.9877, r: 0.015 }, // Marcory
  { lat: 5.2925, lng: -4.0027, r: 0.010 }, // Treichville
  { lat: 5.3644, lng: -4.0225, r: 0.012 }, // Adjamé
  { lat: 5.3456, lng: -4.0864, r: 0.030 }, // Yopougon
  { lat: 5.4204, lng: -4.0159, r: 0.030 }, // Abobo
  { lat: 5.2614, lng: -3.9268, r: 0.020 }, // Port-Bouët
  { lat: 5.3790, lng: -3.9420, r: 0.025 }, // Bingerville / Riviera
];
const pointAbidjan = () => {
  const c = COMMUNES[Math.floor(Math.random() * COMMUNES.length)]!;
  return { lat: +(c.lat + hasard(-c.r, c.r)).toFixed(5), lng: +(c.lng + hasard(-c.r, c.r)).toFixed(5) };
};

/* ------------------------------- Population ------------------------------- */
interface Chauffeur { i: number; ip: string; id: string; jeton: string; pos: { lat: number; lng: number }; ws?: WebSocket; enCourse: boolean }
interface Client { i: number; ip: string; id: string; jeton: string; ws?: WebSocket }
const chauffeurs: Chauffeur[] = [];
const clients: Client[] = [];
let wsOuverts = 0;
const codes = new Map<string, string>();       // course → code de prise en charge (donné par le passager)
const clientDeCourse = new Map<string, Client>();
const commandeLe = new Map<string, number>();
const offreRecueLe = new Map<string, number>(); // l'offre peut arriver avant la réponse à la commande
const delaiOffre = new Serie();
const dureeCourse = new Serie();
const entonnoir = { commandees: 0, attribuees: 0, sansChauffeur: 0, offresRecues: 0, acceptees: 0, terminees: 0, payees: 0, notees: 0, echecs: 0 };

function ouvrirWs(url: string, surMessage?: (m: { type: string; data?: unknown; [k: string]: unknown }) => void): WebSocket {
  const ws = new WebSocket(url);
  ws.onopen = () => { wsOuverts += 1; };
  ws.onclose = () => { wsOuverts = Math.max(0, wsOuverts - 1); };
  ws.onerror = () => { /* compté à la fermeture */ };
  if (surMessage) ws.onmessage = (ev) => { try { surMessage(JSON.parse(String(ev.data))); } catch { /* trame ignorée */ } };
  return ws;
}

async function parLots<T>(n: number, concurrence: number, fn: (i: number) => Promise<T>): Promise<void> {
  let suivant = 0;
  await Promise.all(Array.from({ length: Math.min(concurrence, n) }, async () => {
    while (suivant < n) { const i = suivant++; await fn(i); }
  }));
}

async function inscrireChauffeur(i: number): Promise<void> {
  const ip = ipDe(i + 1);
  const phone = `+22501${String(10000000 + i).slice(-8)}`;
  const otp = await appel<{ devCode?: string }>('POST /drivers/auth/otp', 'POST', '/drivers/auth/otp', ip, { phone });
  if (!otp.data?.devCode) return;
  const v = await appel<{ token: string; driver: { id: string } }>('POST /drivers/auth/verify', 'POST', '/drivers/auth/verify', ip, { phone, code: otp.data.devCode, name: `Chauffeur banc ${i}` });
  if (!v.data?.token) return;
  const id = v.data.driver.id;
  // La console valide le dossier et attribue le véhicule (gamme répartie).
  const gamme = i % 10 < 6 ? 'argent' : i % 10 < 9 ? 'or' : 'diamant';
  await appel('POST /admin/drivers/:id/attribution', 'POST', `/admin/drivers/${id}/attribution`, ipDe(500_000 + i),
    { category: gamme, vehicleModel: 'BYD Seal', vehiclePlate: `${1000 + (i % 9000)} BC 01`, valider: true }, { 'x-admin-token': JETON_ADMIN });
  const c: Chauffeur = { i, ip, id, jeton: v.data.token, pos: pointAbidjan(), enCourse: false };
  const auth = { authorization: `Bearer ${c.jeton}` };
  const on = await appel('POST /drivers/:id/online', 'POST', `/drivers/${id}/online`, ip, { position: c.pos }, auth);
  if (on.statut !== 200) return;
  c.ws = ouvrirWs(`${WS}/ws/drivers/${id}?token=${encodeURIComponent(c.jeton)}`, (m) => { if (m.type === 'ride.assigned') void surOffre(c, m.data as { ride: { id: string } }); });
  chauffeurs.push(c);
}

async function inscrireClient(i: number): Promise<void> {
  const ip = ipDe(100_000 + i);
  const phone = `+22507${String(10000000 + i).slice(-8)}`;
  const clientId = `banc-${randomUUID()}`;
  const otp = await appel<{ devCode?: string }>('POST /clients/auth/otp', 'POST', '/clients/auth/otp', ip, { phone });
  if (!otp.data?.devCode) return;
  const v = await appel<{ token: string; client: { id: string } }>('POST /clients/auth/verify', 'POST', '/clients/auth/verify', ip, { clientId, phone, code: otp.data.devCode, name: `Client banc ${i}` });
  if (!v.data?.token) return;
  const c: Client = { i, ip, id: v.data.client.id, jeton: v.data.token };
  // Comme l'app : canal de configuration publique ouvert en permanence.
  c.ws = ouvrirWs(`${WS}/ws/config`);
  clients.push(c);
}

/* ------------------------------- Courses ------------------------------- */
async function surOffre(c: Chauffeur, d: { ride: { id: string } }): Promise<void> {
  const rideId = d.ride.id;
  entonnoir.offresRecues += 1;
  const t = commandeLe.get(rideId);
  if (t) delaiOffre.ajouter(Date.now() - t); else offreRecueLe.set(rideId, Date.now());
  c.enCourse = true;
  const auth = { authorization: `Bearer ${c.jeton}` };
  await pause(hasard(1000, 3000)); // le temps de lire l'offre
  const ok = await appel('POST /drivers/:id/offers/:ride/accept', 'POST', `/drivers/${c.id}/offers/${rideId}/accept`, c.ip, {}, auth);
  if (ok.statut !== 200) { c.enCourse = false; return; }
  entonnoir.acceptees += 1;
  const debut = Date.now();
  const etape = (to: string) => appel('POST /rides/:id/transition', 'POST', `/rides/${rideId}/transition`, c.ip, { to }, auth);
  await etape('driver_en_route'); await pause(hasard(3000, 6000));
  await etape('arrived'); await pause(hasard(1000, 3000));
  const code = codes.get(rideId);
  const s = await appel('POST /rides/:id/start', 'POST', `/rides/${rideId}/start`, c.ip, { code }, auth);
  if (s.statut !== 200) { entonnoir.echecs += 1; c.enCourse = false; return; }
  await pause(hasard(6000, 12000));
  const fin = await etape('completed');
  if (fin.statut === 200) entonnoir.terminees += 1;
  const pay = await appel('POST /rides/:id/pay', 'POST', `/rides/${rideId}/pay`, c.ip, { method: 'cash' }, { ...auth, 'idempotency-key': `cash-${rideId}` });
  if (pay.statut === 200) entonnoir.payees += 1;
  dureeCourse.ajouter(Date.now() - debut);
  const client = clientDeCourse.get(rideId);
  if (client) {
    const n = await appel('POST /rides/:id/rate', 'POST', `/rides/${rideId}/rate`, client.ip, { stars: 5 }, { authorization: `Bearer ${client.jeton}` });
    if (n.statut === 200) entonnoir.notees += 1;
  }
  c.enCourse = false;
  await appel('POST /drivers/:id/online', 'POST', `/drivers/${c.id}/online`, c.ip, { position: c.pos }, auth);
}

async function commander(client: Client): Promise<void> {
  const origin = pointAbidjan();
  const destination = pointAbidjan();
  const auth = { authorization: `Bearer ${client.jeton}` };
  const est = await appel<{ quote?: { lockId: string } }>('POST /pricing/estimate', 'POST', '/pricing/estimate', client.ip, { origin, destination, category: 'argent' }, auth);
  if (!est.data?.quote?.lockId) { entonnoir.echecs += 1; return; }
  const t0 = Date.now();
  const r = await appel<{ ride: { id: string; status: string }; codePriseEnCharge: string | null }>('POST /rides', 'POST', '/rides', client.ip,
    { clientId: client.id, lockId: est.data.quote.lockId, paymentMethod: 'cash' }, { ...auth, 'idempotency-key': randomUUID() });
  if (r.statut !== 201 || !r.data?.ride) { entonnoir.echecs += 1; return; }
  entonnoir.commandees += 1;
  const rideId = r.data.ride.id;
  commandeLe.set(rideId, t0);
  const recue = offreRecueLe.get(rideId);
  if (recue) delaiOffre.ajouter(recue - t0);
  if (r.data.codePriseEnCharge) codes.set(rideId, r.data.codePriseEnCharge);
  clientDeCourse.set(rideId, client);
  if (r.data.ride.status === 'accepted') entonnoir.attribuees += 1; else entonnoir.sansChauffeur += 1;
  // Suivi en direct, comme l'app (fermé à la fin).
  const ws = ouvrirWs(`${WS}/ws/rides/${rideId}`);
  setTimeout(() => { try { ws.close(); } catch { /* ignore */ } }, 60_000);
}

/* ------------------------------- Consoles ------------------------------- */
async function console_(k: number, fin: number): Promise<void> {
  const ip = `10.1.0.${k + 2}`;
  const l = await appel<{ token: string }>('POST /admin/login', 'POST', '/admin/login', ip, { username: 'admin', password: 'orion-admin-dev' });
  if (!l.data?.token) return;
  const auth = { authorization: `Bearer ${l.data.token}` };
  const b = await appel<{ billet: string }>('POST /admin/ws-billet', 'POST', '/admin/ws-billet', ip, {}, auth);
  if (b.data?.billet) ouvrirWs(`${WS}/ws/console?billet=${encodeURIComponent(b.data.billet)}`);
  while (Date.now() < fin) {
    await Promise.all([
      appel('GET /admin/overview', 'GET', '/admin/overview', ip, undefined, auth),
      appel('GET /admin/rides', 'GET', '/admin/rides?page=1', ip, undefined, auth),
      appel('GET /admin/fleet/live', 'GET', '/admin/fleet/live', ip, undefined, auth),
      appel('GET /admin/drivers', 'GET', '/admin/drivers?page=1', ip, undefined, auth),
      appel('GET /admin/primes', 'GET', '/admin/primes', ip, undefined, auth),
    ]);
    await pause(6000);
  }
}

/* ------------------------------- Serveur ------------------------------- */
const serveur: Array<{ t: number; rssMo: number; cpu: number; boucleP99: number; connexions: number; wsBanc: number }> = [];
async function suivreServeur(fin: number, t0: number): Promise<void> {
  while (Date.now() < fin) {
    let rssMo = 0, cpu = 0;
    if (PID) {
      try {
        const [rss, pc] = execFileSync('ps', ['-o', 'rss=,pcpu=', '-p', String(PID)]).toString().trim().split(/\s+/);
        rssMo = Math.round(Number(rss) / 1024); cpu = Number(pc);
      } catch { /* processus introuvable */ }
    }
    const m = await appel<{ serveur?: { boucleMs?: { p99: number }; connexionsTempsReel?: number } }>('GET /admin/systeme/mesures', 'GET', '/admin/systeme/mesures', '10.9.9.9', undefined, { 'x-admin-token': JETON_ADMIN });
    serveur.push({ t: Math.round((Date.now() - t0) / 1000), rssMo, cpu, boucleP99: m.data?.serveur?.boucleMs?.p99 ?? 0, connexions: m.data?.serveur?.connexionsTempsReel ?? 0, wsBanc: wsOuverts });
    await pause(3000);
  }
}

/* ------------------------------- Déroulé ------------------------------- */
(async () => {
  const t0 = Date.now();
  console.log(`Banc ORION : ${N_CHAUFFEURS} chauffeurs, ${N_CLIENTS} clients, ${N_COURSES} courses, ${N_CONSOLES} consoles, ${DUREE_S} s`);
  const finInscriptions = Date.now() + 3600_000;
  void suivreServeur(finInscriptions, t0);

  await parLots(N_CHAUFFEURS, 100, inscrireChauffeur);
  console.log(`  ${chauffeurs.length} chauffeurs en ligne (${((Date.now() - t0) / 1000).toFixed(0)} s)`);
  await parLots(N_CLIENTS, 200, inscrireClient);
  console.log(`  ${clients.length} clients connectés (${((Date.now() - t0) / 1000).toFixed(0)} s) · ${wsOuverts} canaux temps réel ouverts`);

  const debutActivite = Date.now();
  const fin = debutActivite + DUREE_S * 1000;
  // Positions des chauffeurs : toutes les 5 s (3 s en course), décalées dans le temps.
  const positions = chauffeurs.map((c) => setInterval(() => {
    c.pos = { lat: +(c.pos.lat + hasard(-0.0008, 0.0008)).toFixed(5), lng: +(c.pos.lng + hasard(-0.0008, 0.0008)).toFixed(5) };
    void appel('POST /drivers/:id/location', 'POST', `/drivers/${c.id}/location`, c.ip, { position: c.pos }, { authorization: `Bearer ${c.jeton}` });
  }, c.enCourse ? 3000 : 5000 + (c.i % 50) * 20));
  // Clients qui consultent les prix (environ un sur six par minute).
  const consultations = setInterval(() => {
    for (let k = 0; k < Math.ceil(clients.length / 6 / 12); k += 1) {
      const c = clients[Math.floor(Math.random() * clients.length)]!;
      void appel('POST /pricing/estimate', 'POST', '/pricing/estimate', c.ip, { origin: pointAbidjan(), destination: pointAbidjan(), category: 'argent' }, { authorization: `Bearer ${c.jeton}` });
    }
  }, 5000);
  const consoles = Array.from({ length: N_CONSOLES }, (_, k) => console_(k, fin));
  // Commandes réparties sur les deux premiers tiers du test.
  const espacement = (DUREE_S * 1000 * 0.66) / Math.max(1, N_COURSES);
  for (let k = 0; k < N_COURSES && Date.now() < fin; k += 1) {
    void commander(clients[Math.floor(Math.random() * clients.length)]!);
    await pause(espacement);
  }
  while (Date.now() < fin) await pause(1000);
  positions.forEach(clearInterval);
  clearInterval(consultations);
  await Promise.all(consoles);
  // Laisse finir les courses en cours (au plus 40 s).
  for (let k = 0; k < 40 && chauffeurs.some((c) => c.enCourse); k += 1) await pause(1000);

  const routes = Object.fromEntries([...parRoute.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([r, s]) => [r, s.centiles()]));
  const total = [...parRoute.values()].reduce((s, x) => s + x.v.length, 0);
  const rapport = {
    parametres: { chauffeurs: N_CHAUFFEURS, clients: N_CLIENTS, courses: N_COURSES, consoles: N_CONSOLES, dureeActiviteS: DUREE_S },
    population: { chauffeursEnLigne: chauffeurs.length, clientsConnectes: clients.length, canauxTempsReelMax: Math.max(...serveur.map((s) => s.wsBanc), wsOuverts) },
    requetes: { total, parSeconde: Math.round(total / ((Date.now() - t0) / 1000)), statuts: Object.fromEntries(statuts), erreursReseau },
    entonnoir,
    delaiCommandeOffreMs: delaiOffre.centiles(),
    dureeCourseSimuleeMs: dureeCourse.centiles(),
    routes,
    serveur: {
      rssMoMax: Math.max(0, ...serveur.map((s) => s.rssMo)),
      cpuMax: Math.max(0, ...serveur.map((s) => s.cpu)),
      boucleP99MaxMs: Math.max(0, ...serveur.map((s) => s.boucleP99)),
      connexionsMax: Math.max(0, ...serveur.map((s) => s.connexions)),
      echantillons: serveur,
    },
    dureeTotaleS: Math.round((Date.now() - t0) / 1000),
  };
  if (RAPPORT) writeFileSync(RAPPORT, JSON.stringify(rapport, null, 2));
  const { echantillons: _e, ...resumeServeur } = rapport.serveur;
  console.log(JSON.stringify({ ...rapport, routes: undefined, serveur: resumeServeur }, null, 2));
  for (const [r, c] of Object.entries(routes)) console.log(`  ${r.padEnd(40)} n=${String(c.n).padStart(6)}  p50=${String(c.p50).padStart(4)} ms  p95=${String(c.p95).padStart(5)} ms  p99=${String(c.p99).padStart(5)} ms`);
  process.exit(0);
})();
