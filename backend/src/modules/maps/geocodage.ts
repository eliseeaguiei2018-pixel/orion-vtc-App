import type { LatLng } from '../../core/geo.js';
import { haversineMeters } from '../../core/geo.js';
import { ALL_ZONES } from '../geo-ci/zones.js';

/**
 * RECHERCHE DE LIEUX (adresse de départ ou de destination).
 *
 * L'app cliente ne savait chercher que dans une quinzaine de lieux écrits en dur : une
 * adresse réelle (« Riviera Palmeraie », « Pharmacie de la Paix », « Rue des Jardins »)
 * était introuvable. Deux sources, fusionnées :
 *
 *  1. le RÉPERTOIRE ORION (communes d'Abidjan, grandes villes, gares, aéroport), local,
 *     toujours disponible, insensible aux accents (« adjame » trouve « Adjamé ») ;
 *  2. OPENSTREETMAP via un service Photon (adresses, rues, commerces, établissements),
 *     limité à la Côte d'Ivoire et classé près de l'utilisateur. Hors ligne ou lent, il
 *     est simplement ignoré : la recherche ne reste jamais vide par sa faute.
 *
 * Chaque résultat porte ses COORDONNÉES : un lieu sans position ne sert à rien pour une
 * course. Le service Photon public est à usage modéré ; à fort volume, le pointer vers
 * une instance ORION (GEOCODEUR_URL) — même API.
 */
export interface LieuTrouve {
  id: string;
  nom: string;
  /** Quartier, commune, ville : ce qui permet de distinguer deux « Pharmacie du marché ». */
  secteur: string;
  location: LatLng;
  source: 'repertoire' | 'osm';
}

/** Emprise de la Côte d'Ivoire (ouest, sud, est, nord). */
const EMPRISE_CI = [-8.61, 4.34, -2.49, 10.74] as const;
const CACHE_MS = 10 * 60_000;
const CACHE_MAX = 500;
const DELAI_MS = 4_000;

const sansAccents = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[-'’]/g, ' ').replace(/\s+/g, ' ').trim();

type Fetcher = (url: string, init?: RequestInit) => Promise<Response>;

interface ProprietesPhoton {
  name?: string; street?: string; housenumber?: string; district?: string; locality?: string;
  city?: string; county?: string; state?: string; countrycode?: string; osm_id?: number; osm_type?: string;
}

export class Geocodeur {
  private readonly cache = new Map<string, { at: number; lieux: LieuTrouve[] }>();

  constructor(private readonly urlPhoton: string | null, private readonly fetcher: Fetcher = fetch) {}

  /** Répertoire local : communes, villes, gares, aéroport. */
  repertoire(q: string, pres?: LatLng): LieuTrouve[] {
    const cle = sansAccents(q);
    if (!cle) return [];
    const trouves = ALL_ZONES
      .map((z) => {
        const n = sansAccents(z.name);
        const rang = n === cle ? 0 : n.startsWith(cle) ? 1 : n.split(' ').some((m) => m.startsWith(cle)) ? 2 : n.includes(cle) ? 3 : -1;
        return { z, rang };
      })
      .filter((x) => x.rang >= 0)
      .sort((a, b) => a.rang - b.rang
        || (pres ? haversineMeters(pres, a.z.center) - haversineMeters(pres, b.z.center) : 0));
    return trouves.slice(0, 6).map(({ z }) => ({
      id: `zone:${z.id}`, nom: z.name, secteur: z.kind === 'commune' ? `Commune · ${z.region}` : z.region,
      location: z.center, source: 'repertoire' as const,
    }));
  }

  /** Recherche complète : OpenStreetMap (précis) puis le répertoire, sans doublon. */
  async rechercher(q: string, pres?: LatLng): Promise<LieuTrouve[]> {
    const requete = q.trim();
    if (requete.length < 2) return [];
    const local = this.repertoire(requete, pres);
    const distants = this.urlPhoton ? await this.photon(requete, pres) : [];
    const vus = new Set<string>();
    const tous: LieuTrouve[] = [];
    for (const l of [...distants, ...local]) {
      const cle = `${sansAccents(l.nom)}|${l.location.lat.toFixed(3)}|${l.location.lng.toFixed(3)}`;
      if (vus.has(cle)) continue;
      vus.add(cle);
      tous.push(l);
    }
    return tous.slice(0, 10);
  }

  private async photon(q: string, pres?: LatLng): Promise<LieuTrouve[]> {
    const cleCache = `${sansAccents(q)}|${pres ? `${pres.lat.toFixed(2)},${pres.lng.toFixed(2)}` : ''}`;
    const enCache = this.cache.get(cleCache);
    if (enCache && Date.now() - enCache.at < CACHE_MS) return enCache.lieux;

    const url = new URL('/api/', this.urlPhoton!);
    url.searchParams.set('q', q);
    url.searchParams.set('lang', 'fr');
    url.searchParams.set('limit', '8');
    url.searchParams.set('bbox', EMPRISE_CI.join(','));
    if (pres) { url.searchParams.set('lat', String(pres.lat)); url.searchParams.set('lon', String(pres.lng)); }
    let lieux: LieuTrouve[] = [];
    try {
      const ctrl = new AbortController();
      const minuteur = setTimeout(() => ctrl.abort(), DELAI_MS);
      const res = await this.fetcher(url.toString(), { signal: ctrl.signal, headers: { 'user-agent': 'ORION-VTC/1.0', accept: 'application/json' } });
      clearTimeout(minuteur);
      if (!res.ok) return [];
      const json = await res.json() as { features?: Array<{ properties?: ProprietesPhoton; geometry?: { coordinates?: [number, number] } }> };
      lieux = (json.features ?? [])
        .filter((f) => (f.properties?.countrycode ?? 'CI').toUpperCase() === 'CI' && Array.isArray(f.geometry?.coordinates))
        .map((f) => {
          const p = f.properties ?? {};
          const [lng, lat] = f.geometry!.coordinates!;
          const rue = [p.housenumber, p.street].filter(Boolean).join(' ');
          const nom = p.name ?? (rue || p.district || p.locality || p.city || 'Lieu');
          const secteur = [p.name && rue ? rue : null, p.district ?? p.locality, p.city ?? p.county ?? p.state]
            .filter((x): x is string => Boolean(x) && x !== nom)
            .filter((x, i, arr) => arr.indexOf(x) === i)
            .join(', ');
          return { id: `osm:${p.osm_type ?? ''}${p.osm_id ?? `${lat},${lng}`}`, nom, secteur: secteur || 'Côte d’Ivoire', location: { lat, lng }, source: 'osm' as const };
        });
    } catch {
      return []; // réseau lent ou service indisponible : le répertoire prend le relais
    }
    if (this.cache.size >= CACHE_MAX) this.cache.delete(this.cache.keys().next().value!);
    this.cache.set(cleCache, { at: Date.now(), lieux });
    return lieux;
  }
}
