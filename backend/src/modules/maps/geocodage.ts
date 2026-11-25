import type { LatLng } from '../../core/geo.js';
import { haversineMeters } from '../../core/geo.js';
import { ALL_ZONES } from '../geo-ci/zones.js';
import { QUARTIERS_ABIDJAN } from './quartiers-abidjan.js';
import { LIBELLE_NIVEAU, communeParIndice, quartierProche } from './lieux.js';
import { indexLieux, sansAccents } from './index-lieux.js';

/**
 * RECHERCHE DE LIEUX (adresse de départ ou de destination).
 *
 * L'app cliente ne savait chercher que dans une quinzaine de lieux écrits en dur : une
 * adresse réelle (« Riviera Palmeraie », « Pharmacie de la Paix », « Rue des Jardins »)
 * était introuvable. Deux sources, fusionnées :
 *
 *  1. le RÉPERTOIRE ORION, local et toujours disponible : communes, grandes villes, gares,
 *     aéroport, les lieux du Grand Abidjan extraits d'OpenStreetMap et NETTOYÉS (doublons
 *     fusionnés, niveau de chaque lieu, commune selon les limites OSM) : « Riviéra 2 —
 *     Quartier · Cocody », et l'INDEX DÉTAILLÉ du district (48 924 lieux : commerces,
 *     banques, sièges, écoles, lieux de culte, rues…), le même que celui des applications ;
 *     insensible aux accents (« adjame » trouve « Adjamé ») ; un nom de catégorie
 *     (« pharmacie », « mosquée », « banque ») donne les lieux de cette catégorie les plus
 *     proches, même si leur nom ne contient pas le mot ;
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
  /** Pictogramme du lieu (« pharmacy », « bank », « road »…), quand il vient de l'index détaillé. */
  categorie?: string;
}

/** Emprise de la Côte d'Ivoire (ouest, sud, est, nord). */
const EMPRISE_CI = [-8.61, 4.34, -2.49, 10.74] as const;
const CACHE_MS = 10 * 60_000;
const CACHE_MAX = 500;
const DELAI_MS = 4_000;
const MAX_RESULTATS = 12;

type Fetcher = (url: string, init?: RequestInit) => Promise<Response>;

interface ProprietesPhoton {
  name?: string; street?: string; housenumber?: string; district?: string; locality?: string;
  city?: string; county?: string; state?: string; countrycode?: string; osm_id?: number; osm_type?: string;
}

export class Geocodeur {
  private readonly cache = new Map<string, { at: number; lieux: LieuTrouve[] }>();

  constructor(private readonly urlPhoton: string | null, private readonly fetcher: Fetcher = fetch) {}

  /** Répertoire local : communes, villes, gares, aéroport, quartiers d'Abidjan, index détaillé du district. */
  repertoire(q: string, pres?: LatLng): LieuTrouve[] {
    const cle = sansAccents(q);
    if (!cle) return [];
    const rang = (n: string) => (n === cle ? 0 : n.startsWith(cle) ? 1 : n.split(' ').some((m) => m.startsWith(cle)) ? 2 : n.includes(cle) ? 3 : -1);
    type Candidat = LieuTrouve & { rang: number; poids: number; detail?: boolean };
    const candidats: Candidat[] = [];
    for (const z of ALL_ZONES) {
      const r = rang(sansAccents(z.name));
      if (r >= 0) candidats.push({ id: `zone:${z.id}`, nom: z.name, secteur: z.kind === 'commune' ? `Commune · ${z.region}` : z.region, location: z.center, source: 'repertoire', rang: r, poids: 0 });
    }
    const dejaQuartiers = new Set<string>();
    for (const [nom, lat, lng, niveau, iCommune] of QUARTIERS_ABIDJAN) {
      const n = sansAccents(nom);
      const r = rang(n);
      if (r < 0) continue;
      dejaQuartiers.add(n);
      const commune = communeParIndice(iCommune);
      // Les quartiers passent avant leurs subdivisions (« Zone 4 » avant « Zone 4a »).
      const poids = niveau === 'quartier' ? 1 : niveau === 'sous-quartier' ? 2 : 3;
      candidats.push({ id: `osm-lieu:${n.replace(/ /g, '-')}:${lat}`, nom, secteur: `${LIBELLE_NIVEAU[niveau]} · ${commune ?? 'Grand Abidjan'}`, location: { lat, lng }, source: 'repertoire', categorie: 'marker', rang: r, poids });
    }
    const ix = cle.length >= 2 ? indexLieux() : null;
    if (ix) {
      // Catégories demandées par leur nom (« pharmacie », « eglise », « supermarche »…).
      const visees = new Set<number>();
      if (cle.length >= 4) ix.motsCategories.forEach((mots, i) => { if (mots.some((m) => m.startsWith(cle))) visees.add(i); });
      const parCategorie: Candidat[] = [];
      for (let i = 0; i < ix.lieux.length; i++) {
        const r = rang(ix.cles[i]!);
        const c = ix.lieux[i]![3];
        const visee = visees.has(c);
        if (r < 0 && !visee) continue;
        const [libelle, pictogramme, rangCat] = ix.categories[c] ?? ['Lieu', 'dot', 3];
        if (rangCat === 0 && dejaQuartiers.has(ix.cles[i]!)) continue;
        const [nom, lat, lng, , iCommune] = ix.lieux[i]!;
        const lieu: Candidat = {
          id: `osm-poi:${i}`, nom, secteur: `${libelle} · ${ix.communes[iCommune] ?? 'Grand Abidjan'}`, location: { lat, lng },
          source: 'repertoire', categorie: pictogramme, detail: rangCat !== 0,
          // Un arrêt de bus porte souvent le nom d'un lieu (« Pharmacie », « Mosquée ») : il
          // passe après les vrais lieux de même nom.
          rang: visee ? 0.5 : r + (rangCat >= 5 ? 1.5 : 0) + (visees.size ? 1 : 0), poids: rangCat === 0 ? 1 : rangCat,
        };
        (visee ? parCategorie : candidats).push(lieu);
      }
      // « pharmacie », « mosquée »… : les plus proches de cette catégorie d'abord (il y en a des centaines).
      if (pres) parCategorie.sort((a, b) => haversineMeters(pres, a.location) - haversineMeters(pres, b.location));
      candidats.push(...parCategorie.slice(0, 10));
    }
    // À rang égal : la commune avant le quartier, puis le plus proche de l'utilisateur.
    candidats.sort((a, b) => a.rang - b.rang || (a.rang === 0.5 ? 0 : a.poids - b.poids)
      || (pres ? haversineMeters(pres, a.location) - haversineMeters(pres, b.location) : 0));
    // Un même nom à moins de 300 m (arrêt de bus et école « Riviéra Golf ») : un seul résultat.
    const retenus: Candidat[] = [];
    for (const c of candidats) {
      if (retenus.length >= MAX_RESULTATS) break;
      const n = sansAccents(c.nom);
      if (retenus.some((x) => sansAccents(x.nom) === n && haversineMeters(x.location, c.location) < 300)) continue;
      retenus.push(c);
    }
    return retenus.map(({ rang: _r, poids: _p, detail, ...l }) => {
      // Le quartier précis d'un commerce ou d'une rue : « Pharmacie · Riviéra 2, Cocody ».
      if (!detail) return l;
      const [libelle, commune] = l.secteur.split(' · ');
      const proche = quartierProche(l.location);
      const ou = proche && proche.distanceMeters < 1_200 ? (commune && commune !== 'Grand Abidjan' && commune !== proche.nom ? `${proche.nom}, ${commune}` : proche.nom) : commune;
      return { ...l, secteur: `${libelle} · ${ou}` };
    });
  }

  /** Recherche complète : OpenStreetMap (précis) puis le répertoire, sans doublon. */
  async rechercher(q: string, pres?: LatLng): Promise<LieuTrouve[]> {
    const requete = q.trim();
    if (requete.length < 2) return [];
    const local = this.repertoire(requete, pres);
    const distants = this.urlPhoton ? await this.photon(requete, pres) : [];
    // Un même lieu ne s'affiche qu'une fois : même nom (sans accents) à moins de 1,5 km,
    // qu'il vienne d'OpenStreetMap en ligne ou du répertoire (point et polygone confondus).
    const tous: LieuTrouve[] = [];
    for (const l of [...distants, ...local]) {
      const n = sansAccents(l.nom);
      if (tous.some((t) => sansAccents(t.nom) === n && haversineMeters(t.location, l.location) < 1_500)) continue;
      tous.push(l);
    }
    return tous.slice(0, MAX_RESULTATS);
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
