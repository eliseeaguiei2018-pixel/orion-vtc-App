import { monitorEventLoopDelay, type IntervalHistogram } from 'node:perf_hooks';

/**
 * MESURES DU SERVEUR, en continu et à coût quasi nul.
 *
 * Ce que le service informatique doit voir quand la plateforme est sous pression :
 * débit de requêtes, temps de réponse (médiane, 95e et 99e centiles), erreurs, refus
 * du limiteur, retard de la boucle d'événements (si elle bloque, TOUT ralentit : API,
 * WebSocket, alertes SOS), messages temps réel émis, mémoire.
 *
 * Fenêtre glissante de 10 secondes, dans des tableaux typés circulaires : aucune
 * allocation par requête, aucun journal qui grossit sans fin.
 */
const CAPACITE = 1 << 17; // 131 072 requêtes dans la fenêtre : au-delà, les plus anciennes sortent
const FENETRE_MS = 10_000;

export interface MesureRoute { route: string; requetes: number; p50: number; p95: number; p99: number }

export interface InstantaneMesures {
  depuis: string;
  fenetreSecondes: number;
  requetesParSeconde: number;
  tempsReponseMs: { p50: number; p95: number; p99: number; max: number };
  erreurs5xx: number;
  refus429: number;
  routes: MesureRoute[];
  boucleMs: { p50: number; p99: number; max: number };
  tempsReelParSeconde: number;
  connexionsTempsReel: number;
  memoireMo: number;
}

export class Mesures {
  private readonly instants = new Float64Array(CAPACITE);
  private readonly durees = new Float32Array(CAPACITE);
  private readonly statuts = new Uint16Array(CAPACITE);
  private readonly routesIdx = new Uint16Array(CAPACITE);
  private readonly routes: string[] = [];
  private readonly indexRoute = new Map<string, number>();
  private n = 0;
  private readonly envois = new Float64Array(64);
  private readonly boucle: IntervalHistogram;
  private connexions = 0;
  private readonly debut = new Date().toISOString();

  constructor() {
    this.boucle = monitorEventLoopDelay({ resolution: 10 });
    this.boucle.enable();
    // Histogramme de la boucle remis à zéro régulièrement : on veut l'état récent.
    const raz = setInterval(() => this.boucle.reset(), FENETRE_MS);
    raz.unref?.();
  }

  noterRequete(route: string, dureeMs: number, statut: number, maintenant = Date.now()): void {
    let r = this.indexRoute.get(route);
    if (r === undefined) {
      if (this.routes.length >= 4000) r = 0; // routes inconnues en masse : regroupées
      else { r = this.routes.length; this.routes.push(route); this.indexRoute.set(route, r); }
    }
    const i = this.n % CAPACITE;
    this.instants[i] = maintenant;
    this.durees[i] = dureeMs;
    this.statuts[i] = statut;
    this.routesIdx[i] = r;
    this.n += 1;
  }

  /** Messages temps réel envoyés (WebSocket), comptés par seconde. */
  noterEnvois(nombre: number, maintenant = Date.now()): void {
    const s = Math.floor(maintenant / 1000);
    const i = s % 64;
    // La case contient [seconde * 1e6 + compte] : remise à zéro implicite au changement de seconde.
    const v = this.envois[i]!;
    this.envois[i] = Math.floor(v / 1e6) === s ? v + nombre : s * 1e6 + nombre;
  }

  connexionOuverte(): void { this.connexions += 1; }
  connexionFermee(): void { this.connexions = Math.max(0, this.connexions - 1); }

  instantane(maintenant = Date.now()): InstantaneMesures {
    const limite = maintenant - FENETRE_MS;
    const total = Math.min(this.n, CAPACITE);
    const durees: number[] = [];
    const parRoute = new Map<number, number[]>();
    let e5 = 0;
    let e429 = 0;
    for (let k = 0; k < total; k += 1) {
      const i = (this.n - 1 - k) % CAPACITE;
      if (this.instants[i]! < limite) break;
      const d = this.durees[i]!;
      durees.push(d);
      const st = this.statuts[i]!;
      if (st >= 500) e5 += 1;
      if (st === 429) e429 += 1;
      const r = this.routesIdx[i]!;
      const liste = parRoute.get(r);
      if (liste) liste.push(d); else parRoute.set(r, [d]);
    }
    const centiles = (v: number[]) => {
      if (!v.length) return { p50: 0, p95: 0, p99: 0, max: 0 };
      const s = Float64Array.from(v).sort();
      const q = (p: number) => Math.round(s[Math.min(s.length - 1, Math.floor(p * s.length))]! * 10) / 10;
      return { p50: q(0.5), p95: q(0.95), p99: q(0.99), max: Math.round(s[s.length - 1]! * 10) / 10 };
    };
    const routes = [...parRoute.entries()]
      .map(([r, v]) => ({ route: this.routes[r] ?? '?', requetes: v.length, ...centiles(v) }))
      .sort((a, b) => b.requetes - a.requetes)
      .slice(0, 12)
      .map(({ route, requetes, p50, p95, p99 }) => ({ route, requetes, p50, p95, p99 }));
    const s = Math.floor(maintenant / 1000);
    let envois = 0;
    for (let k = 1; k <= 5; k += 1) {
      const v = this.envois[(s - k) % 64]!;
      if (Math.floor(v / 1e6) === s - k) envois += v % 1e6;
    }
    const ns = (x: number) => Math.round((x / 1e6) * 10) / 10;
    return {
      depuis: this.debut,
      fenetreSecondes: FENETRE_MS / 1000,
      requetesParSeconde: Math.round(durees.length / (FENETRE_MS / 1000)),
      tempsReponseMs: centiles(durees),
      erreurs5xx: e5,
      refus429: e429,
      routes,
      boucleMs: { p50: ns(this.boucle.percentile(50)), p99: ns(this.boucle.percentile(99)), max: ns(this.boucle.max) },
      tempsReelParSeconde: Math.round(envois / 5),
      connexionsTempsReel: this.connexions,
      memoireMo: Math.round(process.memoryUsage().rss / 1048576),
    };
  }
}
