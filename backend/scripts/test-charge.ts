import { existsSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import http from 'node:http';
import { pointDansAbidjan } from '../src/modules/charge/service.js';

/**
 * TEST DE CHARGE ORION : des milliers de courses commandées d'un coup, puis des
 * centaines d'alertes SOS, contre un serveur qui tourne (pas une application en
 * mémoire) : vraies routes HTTP, vrai dispatch, vrai temps réel.
 *
 *   TEST_CHARGE=true npm run dev                       (serveur de développement)
 *   npx tsx scripts/test-charge.ts --courses 5000 --sos 300
 *
 * Options : --api (http://localhost:3000), --jeton (jeton super admin), --courses,
 * --conducteurs, --sos, --vagues (vagues de SOS), --entre-vagues (s), --concurrence,
 * --etat (fichier JSON réécrit en continu, pour suivre le test en direct), --rapport,
 * --signal (chemin : la rafale attend `<chemin>.rafale`, la vague n attend `<chemin>.sos<n>` ;
 * sert à piloter le test pas à pas, par exemple pendant une démonstration filmée).
 *
 * Ce qui est mesuré : temps de réponse du devis, de la commande et du SOS (médiane,
 * 95e, 99e centiles), erreurs, courses servies et sans conducteur, délai d'arrivée de
 * chaque SOS sur le poste de supervision (WebSocket), délai d'affichage des commandes
 * au tableau de bord, et l'état du serveur pendant tout le test (boucle d'événements).
 */
const arg = (nom: string, defaut: string) => {
  const i = process.argv.indexOf(`--${nom}`);
  return i > 0 && process.argv[i + 1] ? process.argv[i + 1]! : defaut;
};
const API = arg('api', 'http://localhost:3000');
const JETON = arg('jeton', process.env.ORION_ADMIN_TOKEN ?? 'orion-admin-dev');
const COURSES = Number(arg('courses', '5000'));
const CONDUCTEURS = Number(arg('conducteurs', String(Math.round(COURSES * 1.12))));
const SOS = Number(arg('sos', '300'));
const VAGUES = Number(arg('vagues', '3'));
const ENTRE_VAGUES = Number(arg('entre-vagues', '8'));
const CONCURRENCE = Number(arg('concurrence', '250'));
const ATTENTE = Number(arg('attente', '0'));
const FICHIER_ETAT = arg('etat', '');
const RAPPORT = arg('rapport', '');
const SIGNAL = arg('signal', '');
/** Attend le fichier signal (sans signal configuré : part tout de suite). */
async function attendreSignal(suffixe: string) {
  if (!SIGNAL) return;
  while (!existsSync(`${SIGNAL}.${suffixe}`)) await pause(100);
}

const J = { 'content-type': 'application/json' };
const ADMIN = { ...J, 'x-admin-token': JETON };
const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));
const maintenant = () => performance.now();

/* ------------------------------- Mesures ------------------------------- */
class Serie {
  valeurs: number[] = [];
  ajouter(v: number) { this.valeurs.push(v); }
  centiles() {
    if (!this.valeurs.length) return { n: 0, p50: 0, p95: 0, p99: 0, max: 0 };
    const s = Float64Array.from(this.valeurs).sort();
    const q = (p: number) => Math.round(s[Math.min(s.length - 1, Math.floor(p * s.length))]!);
    return { n: s.length, p50: q(0.5), p95: q(0.95), p99: q(0.99), max: Math.round(s[s.length - 1]!) };
  }
}
const m = {
  phase: 'préparation',
  debut: Date.now(),
  devis: new Serie(), commande: new Serie(), sos: new Serie(),
  delaiSos: new Serie(), delaiTableau: new Serie(),
  envoyees: 0, creees: 0, attribuees: 0, sansConducteur: 0, erreurs: 0, erreursParCode: {} as Record<string, number>,
  sosEnvoyes: 0, sosCrees: 0, sosRecus: 0,
  journalRecus: 0, lotsRecus: 0,
  rafale: { debut: 0, fin: 0 },
  serveur: null as unknown,
  /** Pires valeurs relevées sur le serveur pendant tout le test. */
  pics: { boucleMaxMs: 0, requetesParSeconde: 0, memoireMo: 0, tempsReelParSeconde: 0 },
  /** Commandes par seconde, sur la dernière seconde. */
  fenetre: [] as number[],
};
const erreur = (code: string) => { m.erreurs += 1; m.erreursParCode[code] = (m.erreursParCode[code] ?? 0) + 1; };

/* ----------------------------- Temps réel ----------------------------- */
const envoiCourse = new Map<string, number>();
const envoiSos = new Map<string, number>();
const sosArrives = new Map<string, number>();
function ecouter(chemin: string, surMessage: (msg: { type: string; data?: any }) => void): WebSocket {
  // WebSocket natif de Node : il accepte des en-têtes (extension d'undici), ici le jeton.
  const ws = new WebSocket(`${API.replace(/^http/, 'ws')}${chemin}`, { headers: { 'x-admin-token': JETON } } as unknown as string[]);
  ws.addEventListener('message', (ev) => { try { surMessage(JSON.parse(String(ev.data))); } catch { /* trame illisible */ } });
  ws.addEventListener('error', () => console.error(`WebSocket ${chemin} : erreur de connexion`));
  return ws;
}

/* ------------------------------ Requêtes ------------------------------ */
/**
 * Client HTTP du générateur : connexions persistantes, une par « téléphone » en vol.
 * (fetch partage un seul pool interne : en rafale, une poignée de requêtes y restaient
 * coincées plusieurs secondes alors que le serveur les traitait en 3 ms.)
 */
const agent = new http.Agent({ keepAlive: true, maxSockets: CONCURRENCE + 20 });
const cible = new URL(API);
function appel<T>(chemin: string, corps: unknown, entetes: Record<string, string> = J): Promise<{ ok: boolean; statut: number; json: T }> {
  const donnees = JSON.stringify(corps);
  return new Promise((ok, echec) => {
    const req = http.request({
      agent, hostname: cible.hostname, port: cible.port || 80, path: chemin, method: 'POST',
      headers: { ...entetes, 'content-length': Buffer.byteLength(donnees) },
    }, (res) => {
      const morceaux: Buffer[] = [];
      res.on('data', (m: Buffer) => morceaux.push(m));
      res.on('end', () => {
        let json = {} as T;
        try { json = JSON.parse(Buffer.concat(morceaux).toString('utf8')) as T; } catch { /* corps vide */ }
        const statut = res.statusCode ?? 0;
        ok({ ok: statut >= 200 && statut < 300, statut, json });
      });
    });
    req.on('error', echec);
    req.end(donnees);
  });
}

const GAMMES = [['bronze', 50], ['argent', 28], ['or', 15], ['diamant', 7]] as const;
const COLIS = ['petit', 'moyen', 'grand'] as const;
const PAIEMENTS = ['orange_money', 'wave', 'mtn_momo', 'cash', 'card', 'orange_money', 'wave'] as const;
const gamme = () => { let r = Math.random() * 100; for (const [g, p] of GAMMES) { r -= p; if (r <= 0) return g; } return 'bronze'; };

async function commander(clientId: string): Promise<{ id: string; statut: string } | null> {
  const { point: origin } = pointDansAbidjan(0.009);
  const angle = Math.random() * 2 * Math.PI;
  const km = 2 + Math.random() * 7;
  const destination = { lat: origin.lat + (Math.sin(angle) * km) / 111, lng: origin.lng + (Math.cos(angle) * km) / 111 };
  const livraison = Math.random() < 0.18;
  const corps = livraison
    ? { serviceType: 'delivery', category: COLIS[Math.floor(Math.random() * 3)], origin, destination, clientId }
    : { origin, destination, category: gamme(), clientId };
  m.envoyees += 1;
  let t = maintenant();
  const devis = await appel<{ quote?: { lockId: string }; error?: { code?: string } }>('/pricing/estimate', corps).catch(() => null);
  m.devis.ajouter(maintenant() - t);
  if (!devis?.ok || !devis.json.quote) { erreur(`devis ${devis?.statut ?? 'réseau'}`); return null; }
  t = maintenant();
  const r = await appel<{ ride?: { id: string; status: string }; error?: { code?: string } }>('/rides', {
    clientId, lockId: devis.json.quote.lockId, paymentMethod: PAIEMENTS[Math.floor(Math.random() * PAIEMENTS.length)],
  }, { ...J, 'idempotency-key': randomUUID() }).catch(() => null);
  const fin = maintenant();
  m.commande.ajouter(fin - t);
  if (!r?.ok || !r.json.ride) { erreur(`commande ${r?.statut ?? 'réseau'}`); return null; }
  m.creees += 1;
  m.fenetre.push(Date.now());
  envoiCourse.set(r.json.ride.id, fin);
  // Attribuée : le simulateur a pu la passer « en route » avant même la réponse.
  if (r.json.ride.status === 'no_driver' || r.json.ride.status === 'searching') m.sansConducteur += 1; else m.attribuees += 1;
  return { id: r.json.ride.id, statut: r.json.ride.status };
}

/** Exécute `n` tâches avec au plus `c` en parallèle. */
async function enParallele<T>(n: number, c: number, tache: (i: number) => Promise<T>): Promise<T[]> {
  const res: T[] = new Array(n);
  let suivant = 0;
  await Promise.all(Array.from({ length: Math.min(c, n) }, async () => {
    while (suivant < n) { const i = suivant++; res[i] = await tache(i); }
  }));
  return res;
}

/* ------------------------------ État en direct ------------------------------ */
function etat() {
  const t = Date.now();
  m.fenetre = m.fenetre.filter((x) => t - x <= 1000);
  return {
    phase: m.phase,
    ecouleS: Math.round((t - m.debut) / 100) / 10,
    courses: { objectif: COURSES, envoyees: m.envoyees, creees: m.creees, attribuees: m.attribuees, sansConducteur: m.sansConducteur, parSeconde: m.fenetre.length },
    rafaleS: m.rafale.fin ? Math.round((m.rafale.fin - m.rafale.debut) / 100) / 10 : m.rafale.debut ? Math.round((t - m.rafale.debut) / 100) / 10 : 0,
    erreurs: m.erreurs, erreursParCode: m.erreursParCode,
    latencesMs: { devis: m.devis.centiles(), commande: m.commande.centiles(), sos: m.sos.centiles() },
    sos: { objectif: SOS, envoyes: m.sosEnvoyes, crees: m.sosCrees, recusSupervision: m.sosRecus, delaiMs: m.delaiSos.centiles() },
    tableau: { lignesRecues: m.journalRecus, lots: m.lotsRecus, delaiMs: m.delaiTableau.centiles() },
    serveur: m.serveur,
    pics: m.pics,
  };
}
const ecrireEtat = () => { if (FICHIER_ETAT) writeFileSync(FICHIER_ETAT, JSON.stringify(etat())); };

async function main() {
  console.log(`Test de charge ORION : ${COURSES} courses, ${SOS} SOS, ${CONDUCTEURS} conducteurs, ${CONCURRENCE} requêtes en parallèle → ${API}`);
  const suivi = setInterval(ecrireEtat, 400);
  const mesures = setInterval(async () => {
    try {
      const s = (await (await fetch(`${API}/admin/systeme/mesures`, { headers: ADMIN })).json()) as { serveur: { boucleMs: { max: number }; requetesParSeconde: number; memoireMo: number; tempsReelParSeconde: number } };
      m.serveur = s;
      m.pics.boucleMaxMs = Math.max(m.pics.boucleMaxMs, s.serveur.boucleMs.max);
      m.pics.requetesParSeconde = Math.max(m.pics.requetesParSeconde, s.serveur.requetesParSeconde);
      m.pics.memoireMo = Math.max(m.pics.memoireMo, s.serveur.memoireMo);
      m.pics.tempsReelParSeconde = Math.max(m.pics.tempsReelParSeconde, s.serveur.tempsReelParSeconde);
    } catch { /* serveur occupé */ }
  }, 1000);

  // 1. Flotte et clientèle de test.
  const prep = await appel<{ conducteurs: number; clients: string[]; parGamme: Record<string, number>; dureeMs: number; error?: unknown }>(
    '/admin/charge/preparer', { conducteurs: CONDUCTEURS, clients: COURSES }, ADMIN);
  if (!prep.ok) throw new Error(`Préparation refusée (${prep.statut}) : ${JSON.stringify(prep.json)}`);
  console.log(`Flotte prête : ${prep.json.conducteurs} conducteurs en ligne ${JSON.stringify(prep.json.parGamme)}, ${prep.json.clients.length} clients (${prep.json.dureeMs} ms)`);
  const clients = prep.json.clients;

  // 2. Écoute du temps réel, comme la supervision et le tableau de bord.
  const urgences = ecouter('/ws/emergency', (msg) => {
    if (msg.type !== 'emergency.alert' || !msg.data?.id) return;
    sosArrives.set(msg.data.id, maintenant());
    const envoye = envoiSos.get(msg.data.id);
    if (envoye !== undefined) { m.sosRecus += 1; m.delaiSos.ajouter(maintenant() - envoye); }
  });
  const tableau = ecouter('/ws/dashboard', (msg) => {
    if (msg.type !== 'journal.lot') return;
    m.lotsRecus += 1;
    m.journalRecus += Number(msg.data?.recus ?? 0);
    for (const e of msg.data?.entrees ?? []) {
      if (e.genre !== 'commande' || !e.rideId) continue;
      const envoye = envoiCourse.get(e.rideId);
      if (envoye !== undefined) m.delaiTableau.ajouter(maintenant() - envoye);
    }
  });
  await pause(1500 + ATTENTE * 1000);

  // 3. La rafale : toutes les commandes, aussi vite que le serveur les accepte.
  m.phase = 'prêt';
  await attendreSignal('rafale');
  m.phase = 'rafale';
  m.rafale.debut = Date.now();
  const courses = await enParallele(COURSES, CONCURRENCE, (i) => commander(clients[i % clients.length]!));
  m.rafale.fin = Date.now();
  console.log(`Rafale : ${m.creees} courses créées en ${((m.rafale.fin - m.rafale.debut) / 1000).toFixed(1)} s, ${m.attribuees} attribuées, ${m.sansConducteur} sans conducteur, ${m.erreurs} erreurs`);

  // 4. Les SOS, par vagues, sur des courses en cours.
  m.phase = 'sos';
  const cibles = courses.filter((c): c is { id: string; statut: string } => Boolean(c && c.statut !== 'no_driver' && c.statut !== 'searching'));
  const parVague = Math.ceil(SOS / VAGUES);
  for (let v = 0; v < VAGUES; v += 1) {
    m.phase = `sos ${v + 1}/${VAGUES} en attente`;
    await attendreSignal(`sos${v + 1}`);
    m.phase = `sos ${v + 1}/${VAGUES}`;
    const vague = cibles.slice(v * parVague, Math.min(SOS, (v + 1) * parVague));
    await enParallele(vague.length, 100, async (i) => {
      const ride = vague[i]!;
      m.sosEnvoyes += 1;
      const t = maintenant();
      const r = await appel<{ alert?: { id: string } }>(`/rides/${ride.id}/sos`, { by: Math.random() < 0.85 ? 'client' : 'chauffeur', note: 'Test de charge ORION' }).catch(() => null);
      const fin = maintenant();
      m.sos.ajouter(fin - t);
      if (!r?.ok || !r.json.alert) { erreur(`sos ${r?.statut ?? 'réseau'}`); return; }
      m.sosCrees += 1;
      envoiSos.set(r.json.alert.id, t);
      // L'alerte a pu arriver sur la supervision AVANT la réponse HTTP.
      const arrivee = sosArrives.get(r.json.alert.id);
      if (arrivee !== undefined) { m.sosRecus += 1; m.delaiSos.ajouter(arrivee - t); }
    });
    console.log(`Vague SOS ${v + 1}/${VAGUES} : ${m.sosCrees} alertes créées, ${m.sosRecus} reçues par la supervision`);
    if (v + 1 < VAGUES && !SIGNAL) await pause(ENTRE_VAGUES * 1000);
  }
  m.phase = 'observation';
  await pause(Number(arg('observer', '5')) * 1000);
  m.phase = 'terminé';
  ecrireEtat();
  clearInterval(suivi); clearInterval(mesures);
  urgences.close(); tableau.close();

  const rapport = etat();
  if (RAPPORT) writeFileSync(RAPPORT, JSON.stringify(rapport, null, 2));
  console.log(JSON.stringify(rapport, null, 2));
}

main().catch((e) => { console.error(e); process.exit(1); });
