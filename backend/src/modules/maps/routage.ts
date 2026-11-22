import { haversineMeters, type LatLng } from '../../core/geo.js';
import { classerItineraires, PEAGES, type Peage } from '../geo-ci/abidjan.js';

/**
 * ITINÉRAIRE ROUTIER RÉEL (Côte d'Ivoire).
 *
 * Le tracé suit le réseau routier d'OpenStreetMap : routes, ponts (Félix-Houphouët-
 * Boigny, Charles-de-Gaulle, Henri-Konan-Bédié, Alassane-Ouattara…), échangeurs et
 * voies nouvelles, à mesure qu'ils sont cartographiés. Le calcul est confié à un
 * serveur OSRM (OSRM_URL) : le serveur public de démonstration par défaut, un serveur
 * ORION dédié en production (même API, extrait Côte d'Ivoire d'OpenStreetMap).
 *
 * Si le calcul échoue (réseau, serveur saturé), on renvoie un tracé de repli plutôt
 * qu'une erreur : la course ne doit jamais être bloquée par la carte.
 */

export interface EtapeItineraire {
  nom: string;
  distanceMeters: number;
  /** Manœuvre OSRM : depart, turn, roundabout, arrive… */
  type: string;
  modificateur?: string;
}

/**
 * Manœuvre de guidage (navigation de l'app chauffeur) : TOUTES les étapes OSRM, avec la
 * position exacte du point de manœuvre — y compris les bretelles d'échangeur sans nom,
 * les ronds-points (numéro de sortie) et les embranchements.
 */
export interface Manoeuvre {
  /** depart, turn, new name, continue, merge, on ramp, off ramp, fork, end of road, roundabout, rotary, exit roundabout, arrive… */
  type: string;
  /** left, slight left, sharp left, right, slight right, sharp right, straight, uturn. */
  modificateur?: string;
  /** Nom de la voie empruntée après la manœuvre (ou sa référence, ex. A100). */
  nom: string;
  /** Distance parcourue sur cette voie jusqu'à la manœuvre suivante. */
  distanceMeters: number;
  /** Point où effectuer la manœuvre. */
  position: LatLng;
  /** Rond-point : numéro de la sortie à prendre. */
  sortie?: number;
}

export interface Itineraire {
  distanceMeters: number;
  durationSeconds: number;
  /** Points du tracé, dans l'ordre (lat/lng). */
  geometrie: LatLng[];
  etapes: EtapeItineraire[];
  /** Guidage pas à pas (vide pour un tracé de repli). */
  manoeuvres: Manoeuvre[];
  /** Ponts empruntés, dans l'ordre (repérés par leur nom). */
  ponts: string[];
  provider: 'osrm' | 'repli';
}

/** Emprise de la Côte d'Ivoire (avec marge) : le service n'est pas un calculateur mondial gratuit. */
export const EMPRISE_CI = { latMin: 4.0, latMax: 11.0, lngMin: -8.8, lngMax: -2.3 };
export const dansLEmprise = (p: LatLng) =>
  p.lat >= EMPRISE_CI.latMin && p.lat <= EMPRISE_CI.latMax && p.lng >= EMPRISE_CI.lngMin && p.lng <= EMPRISE_CI.lngMax;

type Fetch = typeof fetch;

/** Compteurs du calcul d'itinéraire (supervision informatique, test de charge). */
export interface EtatRoutage {
  actifs: number;
  enFile: number;
  osrm: number;
  cache: number;
  /** Rafale trop forte : tracé de repli rendu tout de suite, sans attendre OSRM. */
  repliSaturation: number;
  repliErreur: number;
}

export class Routage {
  private readonly cache = new Map<string, Itineraire>();
  /** Demandes identiques en cours : un seul appel OSRM, partagé. */
  private readonly enCours = new Map<string, Promise<Itineraire>>();
  private actifs = 0;
  private readonly file: Array<() => void> = [];
  private readonly compteurs = { osrm: 0, cache: 0, repliSaturation: 0, repliErreur: 0 };

  constructor(
    private readonly baseUrl: string | undefined,
    private readonly fetchFn: Fetch = fetch,
    private readonly delaiMs = 6_000,
    private readonly capacite = 400,
    /**
     * RAFALES : 5 000 commandes d'un coup, c'est 10 000 itinéraires à calculer. Sans
     * borne, autant de requêtes partent en même temps vers OSRM : sockets épuisées,
     * serveur externe saturé (ou qui nous bannit), et des courses qui attendent leur
     * tracé. On limite les appels simultanés ; au-delà d'une file raisonnable, le tracé
     * de repli est rendu tout de suite. La course n'attend jamais la carte.
     */
    private readonly parallele = 8,
    private readonly fileMax = 64,
  ) {}

  get actif(): boolean {
    return Boolean(this.baseUrl);
  }

  etat(): EtatRoutage {
    return { actifs: this.actifs, enFile: this.file.length, ...this.compteurs };
  }

  /** Itinéraire passant par les points donnés (départ, arrêts éventuels, arrivée). */
  async itineraire(points: LatLng[]): Promise<Itineraire> {
    const cle = points.map((p) => `${p.lat.toFixed(5)},${p.lng.toFixed(5)}`).join(';');
    const enCache = this.cache.get(cle);
    if (enCache) { this.compteurs.cache += 1; return enCache; }
    if (!this.baseUrl) return repli(points);
    const partage = this.enCours.get(cle);
    if (partage) return partage;
    if (this.actifs >= this.parallele && this.file.length >= this.fileMax) {
      this.compteurs.repliSaturation += 1;
      return repli(points);
    }
    const promesse = this.calculer(cle, points).finally(() => this.enCours.delete(cle));
    this.enCours.set(cle, promesse);
    return promesse;
  }

  private async calculer(cle: string, points: LatLng[]): Promise<Itineraire> {
    if (this.actifs >= this.parallele) await new Promise<void>((ok) => this.file.push(ok));
    this.actifs += 1;
    try {
      const resultat = await this.osrm(points).catch(() => null);
      if (!resultat) { this.compteurs.repliErreur += 1; return repli(points); }
      this.compteurs.osrm += 1;
      if (this.cache.size >= this.capacite) this.cache.delete(this.cache.keys().next().value!);
      this.cache.set(cle, resultat);
      return resultat;
    } finally {
      this.actifs -= 1;
      this.file.shift()?.();
    }
  }

  /**
   * ITINÉRAIRE CHOISI PAR LE CLIENT : par le pont à péage, ou par la voie normale.
   * OSRM propose des variantes ; on garde la plus rapide de la famille choisie. Sans voie
   * normale parmi elles, on passe par le contournement connu du péage (pont gratuit,
   * ancienne route). Faute de mieux, l'itinéraire habituel.
   */
  async itineraireSelonChoix(points: LatLng[], choix: 'peage' | 'normal', liste: Peage[] = PEAGES): Promise<Itineraire> {
    const habituel = await this.itineraire(points);
    if (!this.baseUrl || habituel.provider !== 'osrm') return habituel;
    const variantes = points.length === 2 ? await this.osrmTous(points, true).catch(() => [] as Itineraire[]) : [];
    let classe = classerItineraires([habituel, ...variantes], liste);
    const voulu = choix === 'peage' ? classe.peage : classe.normal;
    if (voulu) return voulu.route;
    if (choix === 'normal' && classe.peage) {
      const via = classe.peage.peages.map((p) => PEAGES.find((x) => x.id === p.id)?.contournement).filter((v): v is LatLng => Boolean(v));
      if (via.length > 0) {
        const detour = await this.itineraire([points[0]!, ...via, ...points.slice(1)]);
        classe = classerItineraires([detour], liste);
        if (classe.normal) return classe.normal.route;
      }
    }
    return habituel;
  }

  private async osrm(points: LatLng[]): Promise<Itineraire | null> {
    return (await this.osrmTous(points, false))[0] ?? null;
  }

  private async osrmTous(points: LatLng[], alternatives: boolean): Promise<Itineraire[]> {
    const coords = points.map((p) => `${p.lng.toFixed(6)},${p.lat.toFixed(6)}`).join(';');
    const url = `${this.baseUrl!.replace(/\/$/, '')}/route/v1/driving/${coords}?overview=full&geometries=geojson&steps=true${alternatives ? '&alternatives=3' : ''}`;
    const r = await this.fetchFn(url, { signal: AbortSignal.timeout(this.delaiMs), headers: { accept: 'application/json' } });
    if (!r.ok) return [];
    const json = (await r.json()) as OsrmReponse;
    if (json.code !== 'Ok' || !json.routes?.length) return [];
    return json.routes.map((route) => this.lire(route));
  }

  private lire(route: NonNullable<OsrmReponse['routes']>[number]): Itineraire {
    const etapes: EtapeItineraire[] = route.legs.flatMap((l) => l.steps.map((s) => ({
      nom: s.name || s.ref || '',
      distanceMeters: Math.round(s.distance),
      type: s.maneuver.type,
      modificateur: s.maneuver.modifier,
    })));
    const manoeuvres: Manoeuvre[] = route.legs.flatMap((l, iLeg) => l.steps
      // Arrivée à un arrêt intermédiaire puis redépart : une seule manœuvre « arrêt ».
      .filter((s) => !(iLeg > 0 && s.maneuver.type === 'depart'))
      .map((s) => ({
        type: s.maneuver.type,
        ...(s.maneuver.modifier ? { modificateur: s.maneuver.modifier } : {}),
        nom: s.name || s.ref || '',
        distanceMeters: Math.round(s.distance),
        position: s.maneuver.location ? { lat: s.maneuver.location[1], lng: s.maneuver.location[0] } : { lat: 0, lng: 0 },
        ...(s.maneuver.exit !== undefined ? { sortie: s.maneuver.exit } : {}),
      })))
      .filter((m) => m.position.lat !== 0 || m.position.lng !== 0);
    const ponts: string[] = [];
    for (const e of etapes) {
      if (/^pont\b/i.test(e.nom) && !ponts.includes(e.nom)) ponts.push(e.nom);
    }
    return {
      distanceMeters: Math.round(route.distance),
      durationSeconds: Math.round(route.duration),
      geometrie: route.geometry.coordinates.map(([lng, lat]) => ({ lat: lat!, lng: lng! })),
      etapes: etapes.filter((e) => e.nom || e.type === 'arrive' || e.type === 'depart'),
      manoeuvres,
      ponts,
      provider: 'osrm',
    };
  }
}

/** Tracé de repli : segments droits, distance corrigée de la sinuosité moyenne (×1,3). */
function repli(points: LatLng[]): Itineraire {
  let d = 0;
  for (let i = 1; i < points.length; i += 1) d += haversineMeters(points[i - 1]!, points[i]!);
  const route = Math.round(d * 1.3);
  return { distanceMeters: route, durationSeconds: Math.round((route / 1000 / 22) * 3600), geometrie: points, etapes: [], manoeuvres: [], ponts: [], provider: 'repli' };
}

/** Position à la fraction `t` (0..1) de la longueur d'un tracé. */
export function pointSurTrace(trace: LatLng[], t: number): LatLng {
  if (trace.length === 1) return trace[0]!;
  const longueurs: number[] = [0];
  for (let i = 1; i < trace.length; i += 1) longueurs.push(longueurs[i - 1]! + haversineMeters(trace[i - 1]!, trace[i]!));
  const total = longueurs[longueurs.length - 1]!;
  if (total === 0) return trace[0]!;
  const cible = Math.min(1, Math.max(0, t)) * total;
  let i = 1;
  while (i < longueurs.length - 1 && longueurs[i]! < cible) i += 1;
  const debut = longueurs[i - 1]!;
  const seg = longueurs[i]! - debut || 1;
  const f = (cible - debut) / seg;
  const a = trace[i - 1]!;
  const b = trace[i]!;
  return { lat: a.lat + (b.lat - a.lat) * f, lng: a.lng + (b.lng - a.lng) * f };
}

interface OsrmReponse {
  code: string;
  routes?: Array<{
    distance: number;
    duration: number;
    geometry: { coordinates: Array<[number, number]> };
    legs: Array<{ steps: Array<{ name: string; ref?: string; distance: number; maneuver: { type: string; modifier?: string; location?: [number, number]; exit?: number } }> }>;
  }>;
}
