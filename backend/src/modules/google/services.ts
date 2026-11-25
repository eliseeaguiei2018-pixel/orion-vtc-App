import { createHash } from 'node:crypto';
import type { Container } from '../../container.js';
import { createRepository, type Repository } from '../../core/db/repository.js';
import { haversineMeters, type LatLng } from '../../core/geo.js';
import { COMMUNES } from '../charge/service.js';
import type { Ride } from '../rides/store.js';
import { voixHumaine } from '../voix/humaine.js';
import { refusDeCle, trousseauGoogle } from './cles.js';

/**
 * SERVICES GOOGLE DU SERVEUR — ce que la clé Google du serveur apporte en plus de la voix :
 *  - MÉTÉO (Weather API) : temps qu'il fait et pluie attendue dans chaque commune d'Abidjan.
 *    ORION Pro prévient le chauffeur (« forte pluie attendue à Cocody vers 15 h : la demande
 *    va monter ») et la console voit la ville d'un coup d'œil. 11 communes, toutes les
 *    30 minutes au plus : chaque chauffeur lit sa commune, il ne coûte aucun appel.
 *  - RECALAGE GPS (Roads API) : en fin de course, le tracé GPS du téléphone est collé aux
 *    routes réelles. Distance parcourue exacte, trajet propre dans la console et dans l'app
 *    du client, et écart GPS mesuré (un tracé loin de toute route trahit un faux GPS).
 *  - CARTE DU TRAJET (Static Maps) : une image du trajet (départ, arrêts, arrivée) pour
 *    l'historique du client et la fiche de la course dans la console.
 *  - POINT DE PRISE EN CHARGE (Street View) : la photo de la rue où attend le client, quand
 *    Google en a une (une partie d'Abidjan est couverte), pour que le chauffeur le repère.
 *
 * La clé n'est jamais envoyée aux applications : les images passent par le serveur. Chaque
 * service se coupe depuis la console, et ses appels du jour y sont comptés.
 */

export type ServiceGoogle = 'meteo' | 'recalage' | 'cartes' | 'streetview';
export const SERVICES_GOOGLE: ServiceGoogle[] = ['meteo', 'recalage', 'cartes', 'streetview'];
export type Recuperer = (url: string, init?: RequestInit) => Promise<Response>;

/* -------------------------------- Météo -------------------------------- */

export type NiveauAlerte = 'pluie' | 'forte_pluie' | 'orage';
export interface HeureMeteo { heure: string; type: string; description: string; temperature: number | null; probaPluie: number; pluieMm: number }
export interface Meteo {
  type: string;
  description: string;
  temperature: number | null;
  ressenti: number | null;
  humidite: number | null;
  jour: boolean;
  /** Pluie (ou orage) attendue dans les 6 prochaines heures, la plus proche. */
  alerte: { niveau: NiveauAlerte; heure: string; dansMinutes: number; description: string; probabilite: number } | null;
  heures: HeureMeteo[];
  majLe: string;
}

const PLUIE = /RAIN|SHOWER|THUNDER|DRIZZLE/;
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

interface HeureGoogle {
  interval?: { startTime?: string };
  weatherCondition?: { type?: string; description?: { text?: string } };
  temperature?: { degrees?: number };
  feelsLikeTemperature?: { degrees?: number };
  relativeHumidity?: number;
  isDaytime?: boolean;
  precipitation?: { probability?: { percent?: number }; qpf?: { quantity?: number } };
  thunderstormProbability?: number;
}

/** Lit la prévision horaire de Google et repère la prochaine pluie (probabilité ≥ 50 % ou temps pluvieux). */
export function analyserMeteo(heures: HeureGoogle[], maintenant = Date.now()): Meteo | null {
  if (heures.length === 0) return null;
  const h = heures.map((x): HeureMeteo & { orage: number; ressenti: number | null; humidite: number | null; jour: boolean } => ({
    heure: x.interval?.startTime ?? '',
    type: x.weatherCondition?.type ?? 'INCONNU',
    description: x.weatherCondition?.description?.text ?? '',
    temperature: num(x.temperature?.degrees),
    ressenti: num(x.feelsLikeTemperature?.degrees),
    humidite: num(x.relativeHumidity),
    jour: x.isDaytime !== false,
    probaPluie: num(x.precipitation?.probability?.percent) ?? 0,
    pluieMm: num(x.precipitation?.qpf?.quantity) ?? 0,
    orage: num(x.thunderstormProbability) ?? 0,
  }));
  const maintenantH = h[0]!;
  const pluvieuse = h.find((x) => PLUIE.test(x.type) || x.probaPluie >= 50 || x.pluieMm >= 1);
  let alerte: Meteo['alerte'] = null;
  if (pluvieuse) {
    const niveau: NiveauAlerte = /THUNDER/.test(pluvieuse.type) || pluvieuse.orage >= 40 ? 'orage'
      : /HEAVY/.test(pluvieuse.type) || pluvieuse.pluieMm >= 4 ? 'forte_pluie' : 'pluie';
    const debut = Date.parse(pluvieuse.heure);
    alerte = {
      niveau, heure: pluvieuse.heure, description: pluvieuse.description,
      dansMinutes: Number.isFinite(debut) ? Math.max(0, Math.round((debut - maintenant) / 60_000)) : 0,
      probabilite: Math.max(pluvieuse.probaPluie, PLUIE.test(pluvieuse.type) ? 60 : 0),
    };
  }
  return {
    type: maintenantH.type, description: maintenantH.description, temperature: maintenantH.temperature,
    ressenti: maintenantH.ressenti, humidite: maintenantH.humidite, jour: maintenantH.jour, alerte,
    heures: h.map(({ heure, type, description, temperature, probaPluie, pluieMm }) => ({ heure, type, description, temperature, probaPluie, pluieMm })),
    majLe: new Date(maintenant).toISOString(),
  };
}

/* ------------------------------ Polyligne ------------------------------ */

/** Polyligne encodée (format Google) : une longue liste de points tient dans l'adresse de l'image. */
export function encoderPolyligne(points: LatLng[]): string {
  let sortie = '';
  let pLat = 0, pLng = 0;
  const coder = (v: number) => {
    let x = v < 0 ? ~(v << 1) : v << 1;
    while (x >= 0x20) { sortie += String.fromCharCode((0x20 | (x & 0x1f)) + 63); x >>= 5; }
    sortie += String.fromCharCode(x + 63);
  };
  for (const p of points) {
    const lat = Math.round(p.lat * 1e5), lng = Math.round(p.lng * 1e5);
    coder(lat - pLat); coder(lng - pLng);
    pLat = lat; pLng = lng;
  }
  return sortie;
}

/** Garde au plus `max` points, régulièrement espacés (premier et dernier conservés). */
export function eclaircir<T>(pts: T[], max: number): T[] {
  if (pts.length <= max) return pts;
  const pas = (pts.length - 1) / (max - 1);
  return Array.from({ length: max }, (_, i) => pts[Math.round(i * pas)]!);
}

const longueur = (pts: LatLng[]) => pts.reduce((s, p, i) => (i === 0 ? 0 : s + haversineMeters(pts[i - 1]!, p)), 0);
const mediane = (v: number[]) => { if (!v.length) return 0; const s = [...v].sort((a, b) => a - b); return s[Math.floor(s.length / 2)]!; };

/* ------------------------------- Service ------------------------------- */

export interface Recalage { points: LatLng[]; distanceM: number; distanceGpsM: number; ecartMedianM: number; ecartMaxM: number; at: string }
export interface UsageService { jour: string; appels: number; erreurs: number; dernierAppel: string | null; derniereErreur: string | null }
interface Reglages { id: 'reglages'; actifs: Partial<Record<ServiceGoogle, boolean>>; majLe: string; majPar: string }
export interface OptionsServicesGoogle { recuperer?: Recuperer; maintenant?: () => number; env?: Record<string, string | undefined> }

const METEO_DUREE_MS = 30 * 60_000;
const IMAGE_DUREE_MS = 24 * 3600_000;
const STREETVIEW_DUREE_MS = 7 * 24 * 3600_000;
const IMAGES_MAX = 300;

export class ServicesGoogle {
  private readonly depot: Repository<Reglages> = createRepository<Reglages>('services_google');
  private readonly recuperer: Recuperer;
  private readonly maintenant: () => number;
  private readonly env: Record<string, string | undefined>;
  private readonly usage = new Map<ServiceGoogle, UsageService>();
  private meteoCache = new Map<string, { m: Meteo; at: number }>();
  private meteoEnCours = new Map<string, Promise<Meteo | null>>();
  private images = new Map<string, { octets: Buffer; type: string; at: number }>();
  private svMeta = new Map<string, { ok: boolean; date: string | null; source: string | null; pano: LatLng | null; at: number }>();

  constructor(private readonly container: Container, o: OptionsServicesGoogle = {}) {
    this.recuperer = o.recuperer ?? ((url, init) => fetch(url, init));
    this.maintenant = o.maintenant ?? Date.now;
    this.env = o.env ?? process.env;
  }

  /** Clé du serveur : GOOGLE_SERVER_API_KEY, sinon celle de la voix humaine (console ou variable). */
  cle(): string | null {
    return this.env.GOOGLE_SERVER_API_KEY?.trim() || voixHumaine(this.container).cle('google');
  }
  sourceCle(): 'variable' | 'voix_humaine' | null {
    if (this.env.GOOGLE_SERVER_API_KEY?.trim()) return 'variable';
    return voixHumaine(this.container).cle('google') ? 'voix_humaine' : null;
  }

  actif(s: ServiceGoogle): boolean {
    return Boolean(this.cle() || trousseauGoogle(this.container).secours().length) && this.depot.get('reglages')?.actifs?.[s] !== false;
  }
  reglerActifs(actifs: Partial<Record<ServiceGoogle, boolean>>, acteur: string): void {
    const avant = this.depot.get('reglages')?.actifs ?? {};
    this.depot.put({ id: 'reglages', actifs: { ...avant, ...actifs }, majLe: new Date(this.maintenant()).toISOString(), majPar: acteur });
  }
  etat() {
    const r = this.depot.get('reglages');
    const jour = new Date(this.maintenant()).toISOString().slice(0, 10);
    return {
      cle: { presente: Boolean(this.cle()), source: this.sourceCle(), fin: this.cle()?.slice(-4) ?? null },
      services: Object.fromEntries(SERVICES_GOOGLE.map((s) => {
        const u = this.usage.get(s);
        return [s, { actif: this.actif(s), coupe: r?.actifs?.[s] === false, appelsDuJour: u?.jour === jour ? u.appels : 0, erreursDuJour: u?.jour === jour ? u.erreurs : 0, dernierAppel: u?.dernierAppel ?? null, derniereErreur: u?.derniereErreur ?? null }];
      })) as Record<ServiceGoogle, { actif: boolean; coupe: boolean; appelsDuJour: number; erreursDuJour: number; dernierAppel: string | null; derniereErreur: string | null }>,
      majLe: r?.majLe ?? null, majPar: r?.majPar ?? null,
      // Clés de secours (fin seulement) : prises le jour où la principale est refusée.
      secours: trousseauGoogle(this.container).etat().secours,
    };
  }

  /**
   * Appel compté (par service et par jour) ; la clé n'apparaît jamais dans une erreur.
   * L'adresse porte `__CLE__` à la place de la clé : si Google refuse la clé principale
   * (supprimée, régénérée, restreinte), l'appel repart aussitôt avec une clé de secours.
   */
  private async appel(s: ServiceGoogle, url: string, init?: RequestInit): Promise<Response> {
    const jour = new Date(this.maintenant()).toISOString().slice(0, 10);
    const u = this.usage.get(s);
    const e: UsageService = u && u.jour === jour ? u : { jour, appels: 0, erreurs: 0, dernierAppel: null, derniereErreur: u?.derniereErreur ?? null };
    e.dernierAppel = new Date(this.maintenant()).toISOString();
    this.usage.set(s, e);
    const trousseau = trousseauGoogle(this.container);
    const cles = trousseau.ordre(this.cle(), s);
    const masquer = (m: string) => cles.reduce((t, c) => t.split(c).join('••••'), m).slice(0, 200);
    let derniere: Response | null = null;
    for (const cle of cles) {
      e.appels += 1;
      try {
        const res = await this.recuperer(url.split('__CLE__').join(encodeURIComponent(cle)), { ...init, signal: AbortSignal.timeout(12_000) });
        const json = (res.headers.get('content-type') ?? '').includes('json');
        if (res.ok && !json) return res;
        const corps = await res.text();
        const rejouable = new Response(corps, { status: res.status, headers: res.headers });
        if (res.ok && !refusDeCle(res.status, corps)) return rejouable;
        e.erreurs += 1;
        let m = `${res.status}`;
        try { const j = JSON.parse(corps) as { error?: { message?: string }; error_message?: string; status?: string }; m += ` ${j.error?.message ?? j.error_message ?? j.status ?? ''}`; } catch { /* corps non JSON */ }
        e.derniereErreur = masquer(m);
        derniere = rejouable;
        // Refus de la demande elle-même (lieu sans données, paramètre) : une autre clé n'y changerait rien.
        if (!refusDeCle(res.status, corps)) return rejouable;
        trousseau.marquerRefusee(cle, s);
      } catch (err) {
        e.erreurs += 1;
        e.derniereErreur = masquer(err instanceof Error ? err.message : 'réseau');
        throw err;
      }
    }
    return derniere ?? new Response('{}', { status: 503 });
  }

  private ranger(cle: string, octets: Buffer, type: string): void {
    this.images.set(cle, { octets, type, at: this.maintenant() });
    if (this.images.size > IMAGES_MAX) this.images.delete(this.images.keys().next().value!);
  }

  /* ------------------------------ Météo ------------------------------ */

  /** Météo d'un point (prévision horaire sur 6 h) — gardée 30 minutes par carré d'environ 2 km. */
  async meteo(p: LatLng): Promise<Meteo | null> {
    if (!this.actif('meteo')) return null;
    const cle = `${p.lat.toFixed(2)},${p.lng.toFixed(2)}`;
    const garde = this.meteoCache.get(cle);
    if (garde && this.maintenant() - garde.at < METEO_DUREE_MS) return garde.m;
    let enCours = this.meteoEnCours.get(cle);
    if (!enCours) {
      enCours = (async () => {
        const url = `https://weather.googleapis.com/v1/forecast/hours:lookup?key=__CLE__&location.latitude=${p.lat}&location.longitude=${p.lng}&hours=6&languageCode=fr`;
        try {
          const res = await this.appel('meteo', url);
          if (!res.ok) return garde?.m ?? null;
          const j = (await res.json()) as { forecastHours?: HeureGoogle[] };
          const m = analyserMeteo(j.forecastHours ?? [], this.maintenant());
          if (m) this.meteoCache.set(cle, { m, at: this.maintenant() });
          return m ?? garde?.m ?? null;
        } catch { return garde?.m ?? null; }
      })().finally(() => this.meteoEnCours.delete(cle));
      this.meteoEnCours.set(cle, enCours);
    }
    return enCours;
  }

  /** Les communes d'Abidjan (11 appels au plus toutes les 30 minutes, partagés par tous). */
  async meteoCommunes(): Promise<Array<{ commune: string; centre: LatLng; meteo: Meteo | null }>> {
    if (!this.actif('meteo')) return [];
    return Promise.all(COMMUNES.map(async (c) => ({ commune: c.nom, centre: c.centre, meteo: await this.meteo(c.centre) })));
  }

  /** Pour un chauffeur : la météo de sa commune et les communes où la pluie arrive (≤ 3 h). */
  async meteoChauffeur(p: LatLng): Promise<{ commune: string; meteo: Meteo | null; alertes: Array<{ commune: string; alerte: NonNullable<Meteo['alerte']> }> } | null> {
    if (!this.actif('meteo')) return null;
    const proche = [...COMMUNES].sort((a, b) => haversineMeters(p, a.centre) - haversineMeters(p, b.centre))[0]!;
    const toutes = await this.meteoCommunes();
    const ici = toutes.find((c) => c.commune === proche.nom)?.meteo ?? null;
    const alertes = toutes
      .filter((c) => c.meteo?.alerte && c.meteo.alerte.dansMinutes <= 180)
      .map((c) => ({ commune: c.commune, alerte: c.meteo!.alerte! }))
      .sort((a, b) => a.alerte.dansMinutes - b.alerte.dansMinutes);
    return { commune: proche.nom, meteo: ici, alertes };
  }

  /* ---------------------------- Recalage GPS ---------------------------- */

  /** Colle un tracé GPS aux routes (paquets de 100 points qui se chevauchent d'un point). */
  async recaler(trace: LatLng[]): Promise<Recalage | null> {
    if (!this.actif('recalage') || trace.length < 2) return null;
    const pts = eclaircir(trace, 400);
    const sortie: LatLng[] = [];
    const ecarts: number[] = [];
    for (let debut = 0; debut < pts.length - 1; debut += 99) {
      const lot = pts.slice(debut, debut + 100);
      const chemin = lot.map((p) => `${p.lat.toFixed(6)},${p.lng.toFixed(6)}`).join('|');
      const res = await this.appel('recalage', `https://roads.googleapis.com/v1/snapToRoads?key=__CLE__&interpolate=true&path=${chemin}`);
      if (!res.ok) return null;
      const j = (await res.json()) as { snappedPoints?: Array<{ location: { latitude: number; longitude: number }; originalIndex?: number }> };
      for (const s of j.snappedPoints ?? []) {
        const q = { lat: s.location.latitude, lng: s.location.longitude };
        if (typeof s.originalIndex === 'number' && lot[s.originalIndex]) ecarts.push(haversineMeters(lot[s.originalIndex]!, q));
        const der = sortie[sortie.length - 1];
        if (!der || der.lat !== q.lat || der.lng !== q.lng) sortie.push(q);
      }
    }
    if (sortie.length < 2) return null;
    return {
      points: eclaircir(sortie, 500).map((p) => ({ lat: Math.round(p.lat * 1e6) / 1e6, lng: Math.round(p.lng * 1e6) / 1e6 })),
      distanceM: Math.round(longueur(sortie)),
      distanceGpsM: Math.round(longueur(pts)),
      ecartMedianM: Math.round(mediane(ecarts)),
      ecartMaxM: Math.round(Math.max(0, ...ecarts)),
      at: new Date(this.maintenant()).toISOString(),
    };
  }

  /* --------------------------- Carte du trajet --------------------------- */

  /** Image du trajet : tracé recalé (course finie), sinon itinéraire prévu ; départ, arrêts, arrivée. */
  async carteTrajet(ride: Ride, largeur = 640, hauteur = 320): Promise<{ octets: Buffer; type: string } | null> {
    if (!this.actif('cartes')) return null;
    const rec = ride.recalage;
    const chemin: LatLng[] = rec?.points?.length ? rec.points
      : ride.itineraire?.geometrie?.length ? ride.itineraire.geometrie
        : [ride.origin, ride.destination];
    const arrets = ride.quote.stops ?? [];
    const cleImage = createHash('sha1').update(JSON.stringify([ride.id, chemin.length, rec?.at ?? '', arrets.length, largeur, hauteur])).digest('hex');
    const garde = this.images.get(cleImage);
    if (garde && this.maintenant() - garde.at < IMAGE_DUREE_MS) return garde;
    const u = new URL('https://maps.googleapis.com/maps/api/staticmap');
    u.searchParams.set('size', `${Math.min(640, largeur)}x${Math.min(640, hauteur)}`);
    u.searchParams.set('scale', '2');
    u.searchParams.set('format', 'jpg');
    u.searchParams.set('language', 'fr');
    u.searchParams.set('region', 'CI');
    u.searchParams.append('style', 'feature:poi|visibility:off');
    u.searchParams.append('style', 'feature:transit|visibility:off');
    u.searchParams.append('path', `color:0x16a34aff|weight:5|enc:${encoderPolyligne(eclaircir(chemin, 300))}`);
    u.searchParams.append('markers', `color:0x16a34a|label:A|${ride.origin.lat},${ride.origin.lng}`);
    arrets.slice(0, 5).forEach((a, i) => u.searchParams.append('markers', `color:0xf59e0b|label:${i + 1}|${a.lat},${a.lng}`));
    u.searchParams.append('markers', `color:0xdc2626|label:B|${ride.destination.lat},${ride.destination.lng}`);
    u.searchParams.set('key', 'CLEPLACE');
    try {
      const res = await this.appel('cartes', u.toString().replace('key=CLEPLACE', 'key=__CLE__'));
      if (!res.ok || !(res.headers.get('content-type') ?? '').startsWith('image/')) return null;
      const octets = Buffer.from(await res.arrayBuffer());
      this.ranger(cleImage, octets, res.headers.get('content-type') ?? 'image/jpeg');
      return { octets, type: res.headers.get('content-type') ?? 'image/jpeg' };
    } catch { return null; }
  }

  /* ------------------------ Point de prise en charge ------------------------ */

  /**
   * Google a-t-il une photo DE LA RUE à moins de 60 m ? (métadonnées gratuites, gardées 7 jours)
   * Seules les images de Google et des projets publics (ATP MCA Côte d'Ivoire…) sont retenues :
   * une photo déposée par un particulier (panorama pris d'un toit, intérieur) ne montre pas la rue.
   */
  async streetViewDispo(p: LatLng): Promise<{ disponible: boolean; date: string | null; source: string | null }> {
    if (!this.actif('streetview')) return { disponible: false, date: null, source: null };
    const m = await this.svMetadonnees(p);
    return { disponible: m.ok, date: m.date, source: m.source };
  }

  private async svMetadonnees(p: LatLng): Promise<{ ok: boolean; date: string | null; source: string | null; pano: LatLng | null; at: number }> {
    const cle = `${p.lat.toFixed(4)},${p.lng.toFixed(4)}`;
    const g = this.svMeta.get(cle);
    if (g && this.maintenant() - g.at < STREETVIEW_DUREE_MS) return g;
    try {
      const res = await this.appel('streetview', `https://maps.googleapis.com/maps/api/streetview/metadata?key=__CLE__&location=${p.lat},${p.lng}&radius=60&source=outdoor`);
      const j = res.ok ? (await res.json()) as { status?: string; date?: string; copyright?: string; location?: { lat: number; lng: number } } : {};
      const source = (j.copyright ?? '').replace(/^©\s*/, '').trim() || null;
      const ok = j.status === 'OK' && SOURCES_RUE.test(source ?? '');
      const r = { ok, date: j.date ?? null, source, pano: j.location ? { lat: j.location.lat, lng: j.location.lng } : null, at: this.maintenant() };
      this.svMeta.set(cle, r);
      return r;
    } catch { return { ok: false, date: null, source: null, pano: null, at: this.maintenant() }; }
  }

  /** Photo de la rue, caméra tournée vers le point où attend le client. */
  async streetViewImage(p: LatLng): Promise<{ octets: Buffer; type: string } | null> {
    if (!this.actif('streetview')) return null;
    const m = await this.svMetadonnees(p);
    if (!m.ok) return null;
    const cleImage = `sv:${p.lat.toFixed(4)},${p.lng.toFixed(4)}`;
    const g = this.images.get(cleImage);
    if (g && this.maintenant() - g.at < STREETVIEW_DUREE_MS) return g;
    const cap = m.pano && haversineMeters(m.pano, p) > 4 ? `&heading=${cap360(m.pano, p).toFixed(0)}` : '';
    try {
      const res = await this.appel('streetview', `https://maps.googleapis.com/maps/api/streetview?key=__CLE__&size=640x360&location=${p.lat},${p.lng}&radius=60&source=outdoor&fov=90&pitch=-4${cap}&return_error_code=true`);
      if (!res.ok) return null;
      const octets = Buffer.from(await res.arrayBuffer());
      this.ranger(cleImage, octets, res.headers.get('content-type') ?? 'image/jpeg');
      return { octets, type: res.headers.get('content-type') ?? 'image/jpeg' };
    } catch { return null; }
  }
}

/** Images de rue retenues : Google, et les projets publics (ATP MCA Côte d'Ivoire, ministères…). */
const SOURCES_RUE = /google|projet|project|mca|minist|gouv|govern/i;

/** Cap (0–360°) pour regarder du point de prise de vue vers le client. */
function cap360(de: LatLng, vers: LatLng): number {
  const r = Math.PI / 180;
  const y = Math.sin((vers.lng - de.lng) * r) * Math.cos(vers.lat * r);
  const x = Math.cos(de.lat * r) * Math.sin(vers.lat * r) - Math.sin(de.lat * r) * Math.cos(vers.lat * r) * Math.cos((vers.lng - de.lng) * r);
  return (Math.atan2(y, x) / r + 360) % 360;
}

const instances = new WeakMap<Container, ServicesGoogle>();
/** Services Google d'un serveur (un par conteneur). */
export function servicesGoogle(c: Container, o?: OptionsServicesGoogle): ServicesGoogle {
  let s = instances.get(c);
  if (!s || o) { s = new ServicesGoogle(c, o); instances.set(c, s); }
  return s;
}
