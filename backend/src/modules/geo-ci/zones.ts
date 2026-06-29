import { haversineMeters, type LatLng } from '../../core/geo.js';

/**
 * Plan directeur — Côte d'Ivoire.
 *
 * Référentiel géographique des zones opérationnelles : communes du Grand Abidjan
 * (et alentours) + principales villes du pays. Sert au découpage tarifaire (surge par
 * zone), à la validation de la zone de service, et à l'affichage des adresses.
 *
 * Les centroïdes sont approximatifs (granularité commune/ville). En production, on les
 * affine avec les limites administratives officielles (polygones) + Google Maps.
 */
export type ZoneKind = 'commune' | 'city' | 'hub';

export interface Zone {
  id: string;
  name: string;
  kind: ZoneKind;
  region: string;
  center: LatLng;
  /** Rayon indicatif (m) utilisé pour le rattachement le plus proche. */
  radiusMeters: number;
  /** Coefficient de demande de base de la zone (1 = normal). */
  demandFactor: number;
}

/** Communes et pôles du Grand Abidjan (cœur opérationnel). */
export const ABIDJAN_ZONES: Zone[] = [
  { id: 'abj-plateau', name: 'Plateau', kind: 'commune', region: 'Abidjan', center: { lat: 5.3236, lng: -4.0217 }, radiusMeters: 2500, demandFactor: 1.3 },
  { id: 'abj-cocody', name: 'Cocody', kind: 'commune', region: 'Abidjan', center: { lat: 5.3599, lng: -3.9876 }, radiusMeters: 6000, demandFactor: 1.2 },
  { id: 'abj-yopougon', name: 'Yopougon', kind: 'commune', region: 'Abidjan', center: { lat: 5.3370, lng: -4.0900 }, radiusMeters: 7000, demandFactor: 1.1 },
  { id: 'abj-abobo', name: 'Abobo', kind: 'commune', region: 'Abidjan', center: { lat: 5.4180, lng: -4.0160 }, radiusMeters: 6000, demandFactor: 1.0 },
  { id: 'abj-adjame', name: 'Adjamé', kind: 'commune', region: 'Abidjan', center: { lat: 5.3667, lng: -4.0167 }, radiusMeters: 3000, demandFactor: 1.25 },
  { id: 'abj-treichville', name: 'Treichville', kind: 'commune', region: 'Abidjan', center: { lat: 5.2944, lng: -4.0050 }, radiusMeters: 3000, demandFactor: 1.15 },
  { id: 'abj-marcory', name: 'Marcory', kind: 'commune', region: 'Abidjan', center: { lat: 5.2840, lng: -3.9890 }, radiusMeters: 3500, demandFactor: 1.15 },
  { id: 'abj-koumassi', name: 'Koumassi', kind: 'commune', region: 'Abidjan', center: { lat: 5.2880, lng: -3.9560 }, radiusMeters: 3500, demandFactor: 1.05 },
  { id: 'abj-portbouet', name: 'Port-Bouët', kind: 'commune', region: 'Abidjan', center: { lat: 5.2560, lng: -3.9260 }, radiusMeters: 5000, demandFactor: 1.1 },
  { id: 'abj-attecoube', name: 'Attécoubé', kind: 'commune', region: 'Abidjan', center: { lat: 5.3300, lng: -4.0400 }, radiusMeters: 3000, demandFactor: 1.0 },
  { id: 'abj-bingerville', name: 'Bingerville', kind: 'commune', region: 'Abidjan', center: { lat: 5.3550, lng: -3.8850 }, radiusMeters: 5000, demandFactor: 1.0 },
  { id: 'abj-songon', name: 'Songon', kind: 'commune', region: 'Abidjan', center: { lat: 5.3170, lng: -4.2540 }, radiusMeters: 6000, demandFactor: 0.95 },
  { id: 'abj-anyama', name: 'Anyama', kind: 'commune', region: 'Abidjan', center: { lat: 5.4940, lng: -4.0520 }, radiusMeters: 5000, demandFactor: 0.95 },
  { id: 'abj-grand-bassam', name: 'Grand-Bassam', kind: 'city', region: 'Sud-Comoé', center: { lat: 5.2118, lng: -3.7388 }, radiusMeters: 6000, demandFactor: 1.05 },
  // Pôles à forte demande (hubs).
  { id: 'hub-aeroport-fhb', name: 'Aéroport FHB (Port-Bouët)', kind: 'hub', region: 'Abidjan', center: { lat: 5.2614, lng: -3.9263 }, radiusMeters: 2000, demandFactor: 1.6 },
  { id: 'hub-gare-adjame', name: 'Gare routière Adjamé', kind: 'hub', region: 'Abidjan', center: { lat: 5.3580, lng: -4.0240 }, radiusMeters: 1500, demandFactor: 1.4 },
];

/** Principales villes de Côte d'Ivoire (extension nationale du service). */
export const CITY_ZONES: Zone[] = [
  { id: 'ci-yamoussoukro', name: 'Yamoussoukro', kind: 'city', region: 'Lacs', center: { lat: 6.8276, lng: -5.2893 }, radiusMeters: 12000, demandFactor: 1.1 },
  { id: 'ci-bouake', name: 'Bouaké', kind: 'city', region: 'Gbêkê', center: { lat: 7.6939, lng: -5.0303 }, radiusMeters: 12000, demandFactor: 1.1 },
  { id: 'ci-sanpedro', name: 'San-Pédro', kind: 'city', region: 'San-Pédro', center: { lat: 4.7485, lng: -6.6363 }, radiusMeters: 10000, demandFactor: 1.1 },
  { id: 'ci-korhogo', name: 'Korhogo', kind: 'city', region: 'Poro', center: { lat: 9.4580, lng: -5.6294 }, radiusMeters: 10000, demandFactor: 1.0 },
  { id: 'ci-daloa', name: 'Daloa', kind: 'city', region: 'Haut-Sassandra', center: { lat: 6.8770, lng: -6.4502 }, radiusMeters: 10000, demandFactor: 1.0 },
  { id: 'ci-man', name: 'Man', kind: 'city', region: 'Tonkpi', center: { lat: 7.4125, lng: -7.5538 }, radiusMeters: 9000, demandFactor: 1.0 },
  { id: 'ci-gagnoa', name: 'Gagnoa', kind: 'city', region: 'Gôh', center: { lat: 6.1319, lng: -5.9506 }, radiusMeters: 9000, demandFactor: 1.0 },
  { id: 'ci-abengourou', name: 'Abengourou', kind: 'city', region: 'Indénié-Djuablin', center: { lat: 6.7297, lng: -3.4964 }, radiusMeters: 9000, demandFactor: 1.0 },
  { id: 'ci-divo', name: 'Divo', kind: 'city', region: 'Lôh-Djiboua', center: { lat: 5.8390, lng: -5.3570 }, radiusMeters: 8000, demandFactor: 1.0 },
  { id: 'ci-soubre', name: 'Soubré', kind: 'city', region: 'Nawa', center: { lat: 5.7836, lng: -6.5936 }, radiusMeters: 8000, demandFactor: 1.0 },
  { id: 'ci-bondoukou', name: 'Bondoukou', kind: 'city', region: 'Gontougo', center: { lat: 8.0402, lng: -2.8000 }, radiusMeters: 8000, demandFactor: 1.0 },
  { id: 'ci-odienne', name: 'Odienné', kind: 'city', region: 'Kabadougou', center: { lat: 9.5000, lng: -7.5667 }, radiusMeters: 8000, demandFactor: 1.0 },
];

export const ALL_ZONES: Zone[] = [...ABIDJAN_ZONES, ...CITY_ZONES];

/** Bornes approximatives du territoire ivoirien (validation de la zone de service). */
export const COTE_DIVOIRE_BOUNDS = {
  minLat: 4.1,
  maxLat: 10.8,
  minLng: -8.7,
  maxLng: -2.4,
};

export function isWithinCotedIvoire(p: LatLng): boolean {
  return (
    p.lat >= COTE_DIVOIRE_BOUNDS.minLat &&
    p.lat <= COTE_DIVOIRE_BOUNDS.maxLat &&
    p.lng >= COTE_DIVOIRE_BOUNDS.minLng &&
    p.lng <= COTE_DIVOIRE_BOUNDS.maxLng
  );
}

/** Zone la plus proche d'un point (rattachement administratif approximatif). */
export function nearestZone(p: LatLng): { zone: Zone; distanceMeters: number } | null {
  let best: { zone: Zone; distanceMeters: number } | null = null;
  for (const zone of ALL_ZONES) {
    const distanceMeters = haversineMeters(p, zone.center);
    if (!best || distanceMeters < best.distanceMeters) best = { zone, distanceMeters };
  }
  return best;
}

/**
 * Coefficient de surge dépendant des zones d'origine/destination et de l'heure.
 * Heures de pointe Abidjan : 6h30-9h et 17h-20h (embouteillages).
 */
export function zoneSurge(origin: LatLng, destination: LatLng, at = new Date()): number {
  const o = nearestZone(origin)?.zone.demandFactor ?? 1;
  const d = nearestZone(destination)?.zone.demandFactor ?? 1;
  const base = Math.max(o, d);

  const hour = at.getHours();
  const peak = (hour >= 6 && hour < 9) || (hour >= 17 && hour < 20);
  const peakFactor = peak ? 1.25 : 1;

  // Borné pour rester transparent et acceptable pour l'usager.
  return Math.min(2, Math.round(base * peakFactor * 100) / 100);
}
