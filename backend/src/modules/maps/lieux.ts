import type { LatLng } from '../../core/geo.js';
import { haversineMeters } from '../../core/geo.js';
import { nearestZone } from '../geo-ci/zones.js';
import { COMMUNES_ABIDJAN, QUARTIERS_ABIDJAN, type NiveauLieu } from './quartiers-abidjan.js';
import { POINTS_COMMUNES, SEGMENTS_LIMITES } from './limites-communes.js';

/**
 * NOM D'UNE POSITION GPS : quartier réel + commune, pour les 4 interfaces (recherche et
 * position du client, offre et course du chauffeur, dossiers SOS et télématique de la
 * console, statistiques par commune du tableau de bord).
 *
 * Avant : le centre de commune le plus proche — Angré (Cocody) devenait « Abobo », et le
 * chauffeur ne voyait que « Cocody » pour une prise en charge à Riviéra 2.
 *  - COMMUNE : limites communales OpenStreetMap (niveau 8). La position appartient à la
 *    commune dont le point central est joignable en ligne droite sans franchir de limite.
 *  - QUARTIER : le lieu OSM nommé le plus proche (quartier, sous-quartier, village), s'il
 *    est à moins de 1,2 km ; au-delà, on ne nomme que la commune (pas de nom inventé).
 */
export interface LieuResolu {
  quartier: string | null;
  niveau: NiveauLieu | null;
  commune: string | null;
  /** « Riviéra 2, Cocody » — ce qu'affichent les interfaces. */
  libelle: string;
}

const DISTANCE_QUARTIER_M = 1_200;

const croise = (ax: number, ay: number, bx: number, by: number, i: number) => {
  const x1 = SEGMENTS_LIMITES[i]!, y1 = SEGMENTS_LIMITES[i + 1]!, x2 = SEGMENTS_LIMITES[i + 2]!, y2 = SEGMENTS_LIMITES[i + 3]!;
  const d = (px: number, py: number, qx: number, qy: number, rx: number, ry: number) => (qx - px) * (ry - py) - (qy - py) * (rx - px);
  return (d(ax, ay, bx, by, x1, y1) > 0) !== (d(ax, ay, bx, by, x2, y2) > 0)
    && (d(x1, y1, x2, y2, ax, ay) > 0) !== (d(x1, y1, x2, y2, bx, by) > 0);
};

/** Commune du district d'Abidjan contenant la position ; null hors du district. */
export function communeDe(p: LatLng): string | null {
  const candidates = POINTS_COMMUNES
    .map((c) => ({ c, d: haversineMeters(p, c) }))
    .filter((x) => x.d < 25_000)
    .sort((a, b) => a.d - b.d);
  for (const { c } of candidates) {
    let libre = true;
    for (let i = 0; i < SEGMENTS_LIMITES.length; i += 4) if (croise(p.lng, p.lat, c.lng, c.lat, i)) { libre = false; break; }
    if (libre) return c.nom;
  }
  return null;
}

/** Lieu OSM nommé le plus proche (quartier, sous-quartier, village), à moins de 1,2 km. */
export function quartierProche(p: LatLng): { nom: string; niveau: NiveauLieu; distanceMeters: number } | null {
  let meilleur: { nom: string; niveau: NiveauLieu; distanceMeters: number } | null = null;
  for (const [nom, lat, lng, niveau] of QUARTIERS_ABIDJAN) {
    if (Math.abs(lat - p.lat) > 0.02 || Math.abs(lng - p.lng) > 0.02) continue;
    const d = haversineMeters(p, { lat, lng });
    if (d <= DISTANCE_QUARTIER_M && (!meilleur || d < meilleur.distanceMeters)) meilleur = { nom, niveau, distanceMeters: d };
  }
  return meilleur;
}

/** Quartier + commune d'une position ; hors d'Abidjan, la ville connue la plus proche. */
export function lieuDe(p: LatLng): LieuResolu {
  const commune = communeDe(p);
  if (commune) {
    const q = quartierProche(p);
    return { quartier: q?.nom ?? null, niveau: q?.niveau ?? null, commune, libelle: q ? `${q.nom}, ${commune}` : commune };
  }
  const z = nearestZone(p);
  const ville = z && z.distanceMeters < (z.zone.radiusMeters ?? 10_000) * 2 ? z.zone.name : null;
  return { quartier: null, niveau: null, commune: null, libelle: ville ?? `${p.lat.toFixed(4)}, ${p.lng.toFixed(4)}` };
}

/** Libellé d'un lieu du répertoire dans les résultats de recherche. */
export const LIBELLE_NIVEAU: Record<NiveauLieu, string> = {
  quartier: 'Quartier', 'sous-quartier': 'Sous-quartier', village: 'Village', hameau: 'Hameau', ile: 'Île',
};
export const communeParIndice = (i: number): string | null => (i >= 0 ? COMMUNES_ABIDJAN[i] ?? null : null);
