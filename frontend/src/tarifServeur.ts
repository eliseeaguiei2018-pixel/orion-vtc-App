/**
 * LE PRIX DU SERVEUR, DANS L'APPLICATION.
 *
 * Sans serveur relié, l'application calcule elle-même le prix. Ce fichier reproduit, règle
 * pour règle, le calcul du serveur ORION avec ses réglages d'origine : barème, facteur de la
 * commune de départ, frais de prise en charge des secteurs résidentiels, forfaits entre
 * zones, supplément de retour à vide, prix plancher, trafic selon l'heure et la densité des
 * zones traversées. Le prix affiché hors serveur est donc celui que le serveur annoncerait.
 *
 * Ce que seul un serveur relié connaît, et qui ne peut pas figurer ici :
 *  - la majoration de forte demande (plafonnée à 1,3 par défaut), qui dépend des commandes
 *    en cours dans le quartier ;
 *  - les réglages modifiés depuis la console (barème, zones, forfaits) ;
 *  - les codes promo.
 *
 * Sources recopiées : backend/src/modules/services/ride/pricing.ts (estimatePrice),
 * backend/src/modules/settings/service.ts (DEFAULT_ZONES, tripPricing),
 * backend/src/modules/geo-ci/zones.ts (ALL_ZONES, trafficInfo),
 * backend/src/modules/services/delivery/deliveryModule.ts (DELIVERY_TARIFF).
 * Le test backend/tests/prix-application.test.ts compare les deux calculs trajet par trajet :
 * il échoue dès qu'un côté change sans l'autre.
 *
 * Fichier sans dépendance (ni navigateur, ni réglages de build) : le test du serveur l'importe tel quel.
 */

export interface Pt { lat: number; lng: number }
export type NiveauTrafic = 'fluid' | 'dense' | 'jam';

/** Distance à vol d'oiseau en mètres (même formule que le serveur). */
export function distanceVol(a: Pt, b: Pt): number {
  const R = 6_371_000;
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.sin(dLng / 2) ** 2 * Math.cos(rad(a.lat)) * Math.cos(rad(b.lat));
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Barème des courses (DEFAULT_PRICING du serveur). */
export const BAREME = {
  baseFare: 300, perKm: 130, perMinute: 18, minFare: 600, avgSpeedKmh: 24,
  tvaRate: 0.05, feeRate: 0.1, insuranceRate: 0.02, trafficWeight: 0.6, stopFee: 250,
  bodySurcharge: { berline: 1, suv: 1.08 } as Record<string, number>,
} as const;

/** Barème des livraisons à moto (DELIVERY_TARIFF du serveur). */
export const BAREME_LIVRAISON = { baseFare: 220, perKm: 88, perMinute: 8, minFare: 500, avgSpeedKmh: 26 } as const;

/** Zone tarifaire : commune ou secteur résidentiel, avec ses règles de prix. */
export interface ZoneTarif {
  id: string; name: string; factor: number; lat: number; lng: number; radiusKm: number;
  /** Frais de prise en charge du secteur (F CFA), ajoutés au prix fixe. */
  pickupFee?: number;
  /** Forfaits vers d'autres zones : remplacent le calcul au kilomètre. */
  flatRates?: { toZoneId: string; price: number }[];
  /** Supplément quand la course se termine dans cette zone (retour à vide). */
  emptyReturnFee?: number;
  /** Prix plancher d'une course qui démarre dans ce secteur. */
  premiumFloor?: number;
}

/** Zones tarifaires d'origine (DEFAULT_ZONES du serveur). */
export const ZONES_TARIF: ZoneTarif[] = [
  { id: 'plateau', name: 'Plateau', factor: 1.05, lat: 5.3236, lng: -4.0217, radiusKm: 2.5 },
  { id: 'cocody', name: 'Cocody', factor: 1.0, lat: 5.3596, lng: -3.9903, radiusKm: 5 },
  { id: 'marcory', name: 'Marcory', factor: 1.0, lat: 5.3007, lng: -3.9877, radiusKm: 3.5 },
  { id: 'treichville', name: 'Treichville', factor: 0.95, lat: 5.2925, lng: -4.0027, radiusKm: 2.5 },
  { id: 'adjame', name: 'Adjamé', factor: 0.95, lat: 5.3644, lng: -4.0225, radiusKm: 2.5 },
  { id: 'yopougon', name: 'Yopougon', factor: 0.92, lat: 5.3456, lng: -4.0864, radiusKm: 6 },
  { id: 'abobo', name: 'Abobo', factor: 0.92, lat: 5.4204, lng: -4.0159, radiusKm: 6 },
  { id: 'aeroport', name: 'Aéroport (Port-Bouët)', factor: 1.1, lat: 5.2614, lng: -3.9268, radiusKm: 4 },
  { id: 'riviera-golf', name: 'Riviera Golf', factor: 1.15, lat: 5.3742, lng: -3.9721, radiusKm: 1.4, pickupFee: 200 },
  { id: 'deux-plateaux-vallon', name: 'Deux-Plateaux Vallon', factor: 1.1, lat: 5.3689, lng: -4.0004, radiusKm: 1.3, pickupFee: 150 },
  { id: 'cite-des-arts', name: 'Cocody Centre — Cité des Arts', factor: 1.08, lat: 5.3488, lng: -3.9962, radiusKm: 1.1, pickupFee: 100 },
  { id: 'cocody-danga', name: 'Cocody Danga', factor: 1.1, lat: 5.3391, lng: -4.0011, radiusKm: 1.0, pickupFee: 150 },
  { id: 'riviera-beverly-hills', name: 'Riviera Beverly Hills', factor: 1.18, lat: 5.3808, lng: -3.9611, radiusKm: 1.2, pickupFee: 250 },
  { id: 'marcory-zone4', name: 'Marcory Zone 4', factor: 1.08, lat: 5.2942, lng: -3.9846, radiusKm: 1.6, pickupFee: 100 },
];

/** Densité des communes, pôles et villes (ALL_ZONES du serveur) : `[id, lat, lng, densité]`. */
export const ZONES_DENSITE: readonly (readonly [string, number, number, number])[] = [
  ['abj-plateau', 5.3236, -4.0217, 1.3], ['abj-cocody', 5.3599, -3.9876, 1.2], ['abj-yopougon', 5.3370, -4.0900, 1.1],
  ['abj-abobo', 5.4180, -4.0160, 1.0], ['abj-adjame', 5.3667, -4.0167, 1.25], ['abj-treichville', 5.2944, -4.0050, 1.15],
  ['abj-marcory', 5.2840, -3.9890, 1.15], ['abj-koumassi', 5.2880, -3.9560, 1.05], ['abj-portbouet', 5.2560, -3.9260, 1.1],
  ['abj-attecoube', 5.3300, -4.0400, 1.0], ['abj-bingerville', 5.3550, -3.8850, 1.0], ['abj-songon', 5.3170, -4.2540, 0.95],
  ['abj-anyama', 5.4940, -4.0520, 0.95], ['abj-grand-bassam', 5.2118, -3.7388, 1.05],
  ['hub-aeroport-fhb', 5.2614, -3.9263, 1.6], ['hub-gare-adjame', 5.3580, -4.0240, 1.4],
  ['ci-yamoussoukro', 6.8276, -5.2893, 1.1], ['ci-bouake', 7.6939, -5.0303, 1.1], ['ci-sanpedro', 4.7485, -6.6363, 1.1],
  ['ci-korhogo', 9.4580, -5.6294, 1.0], ['ci-daloa', 6.8770, -6.4502, 1.0], ['ci-man', 7.4125, -7.5538, 1.0],
  ['ci-gagnoa', 6.1319, -5.9506, 1.0], ['ci-abengourou', 6.7297, -3.4964, 1.0], ['ci-divo', 5.8390, -5.3570, 1.0],
  ['ci-soubre', 5.7836, -6.5936, 1.0], ['ci-bondoukou', 8.0402, -2.8000, 1.0], ['ci-odienne', 9.5000, -7.5667, 1.0],
];

/** Zone tarifaire d'un point : celle dont le centre est le plus proche, dans son rayon. */
export function zoneTarif(p: Pt): ZoneTarif | undefined {
  let meilleure: ZoneTarif | undefined;
  let plusProche = Infinity;
  for (const z of ZONES_TARIF) {
    const d = distanceVol(p, z);
    if (d <= z.radiusKm * 1000 && d < plusProche) { meilleure = z; plusProche = d; }
  }
  return meilleure;
}

/** Règles géographiques d'un trajet : facteur et frais du départ, forfait A→B, retour à vide, plancher. */
export function reglesTrajet(origin: Pt, destination: Pt): {
  zone?: ZoneTarif; zoneFactor: number; pickupFee: number; flatAmount?: number; extraFee: number; premiumFloor?: number;
} {
  const depart = zoneTarif(origin);
  const arrivee = zoneTarif(destination);
  const forfait = arrivee ? depart?.flatRates?.find((f) => f.toZoneId === arrivee.id)?.price : undefined;
  return {
    zone: depart,
    zoneFactor: depart?.factor ?? 1,
    pickupFee: depart?.pickupFee ?? 0,
    flatAmount: forfait,
    extraFee: arrivee?.emptyReturnFee ?? 0,
    premiumFloor: depart?.premiumFloor,
  };
}

function densite(p: Pt): number {
  let d = 1;
  let plusProche = Infinity;
  for (const [, lat, lng, facteur] of ZONES_DENSITE) {
    const m = distanceVol(p, { lat, lng });
    if (m < plusProche) { plusProche = m; d = facteur; }
  }
  return d;
}

/** Trafic retenu pour le prix : heure de pointe d'Abidjan et densité des zones du trajet (trafficInfo du serveur). */
export function traficServeur(origin: Pt, destination: Pt, at: Date = new Date()): { level: NiveauTrafic; factor: number } {
  const heure = at.getHours();
  const pointe = (heure >= 6 && heure < 9) || (heure >= 17 && heure < 20);
  const journee = heure >= 9 && heure < 17;
  const d = Math.max(densite(origin), densite(destination));
  let score = 0;
  if (pointe) score += 2;
  else if (journee) score += 1;
  if (d >= 1.3) score += 2;
  else if (d >= 1.1) score += 1;
  if (score >= 4) return { level: 'jam', factor: 1.35 };
  if (score >= 2) return { level: 'dense', factor: 1.15 };
  return { level: 'fluid', factor: 1.0 };
}

const arrondi50 = (n: number) => Math.round(n / 50) * 50;

export interface DetailPrix {
  amount: number; trafficLevel: NiveauTrafic; trafficFactor: number;
  /** Zone tarifaire du départ, quand il y en a une. */
  zone?: string; zoneFactor: number; pickupFee: number;
  breakdown: { base: number; distance: number; time: number; surge: number; traffic: number; discount: number; subtotal: number; tva: number; fee: number; insurance: number };
}

/** Prix d'une course, comme `estimatePrice` du serveur (sans majoration de demande ni code promo). */
export function prixCourse(d: {
  origin: Pt; destination: Pt; stops?: Pt[];
  /** Distance du trajet par la route, en mètres. */
  distanceMeters: number;
  /** Multiplicateur et supplément TTC de la gamme (Argent, Or, Diamant). */
  multiplier: number; supplement?: number;
  bodyType?: string; insurance?: boolean; at?: Date;
}): DetailPrix {
  const s = BAREME;
  const m = d.multiplier;
  const carrosserie = s.bodySurcharge[d.bodyType ?? 'berline'] ?? 1;
  const trafic = traficServeur(d.origin, d.destination, d.at);
  const regles = reglesTrajet(d.origin, d.destination);
  const km = d.distanceMeters / 1000;
  // Temps facturé à vitesse libre : les embouteillages ne sont pas facturés à la minute.
  const minutes = (km / s.avgSpeedKmh) * 60;
  const arrets = d.stops?.length ?? 0;

  const base = s.baseFare * m * carrosserie;
  const distance = km * s.perKm * m * carrosserie;
  const temps = minutes * s.perMinute * m * carrosserie;
  const coutArrets = arrets * s.stopFee * m;
  const coefTrafic = 1 + (trafic.factor - 1) * s.trafficWeight;
  const auCompteur = (base + distance + temps + coutArrets) * coefTrafic * Math.max(0.1, regles.zoneFactor) + regles.pickupFee;
  const brut = (regles.flatAmount && regles.flatAmount > 0 ? regles.flatAmount : auCompteur) + regles.extraFee;
  const plancher = Math.max(brut, s.minFare * m, regles.premiumFloor ?? 0);

  const tauxTtc = 1 + s.tvaRate + s.feeRate + (d.insurance ? s.insuranceRate : 0);
  const amount = arrondi50(plancher * tauxTtc) + Math.max(0, d.supplement ?? 0);
  const subtotal = amount / tauxTtc;
  return {
    amount, trafficLevel: trafic.level, trafficFactor: trafic.factor,
    zone: regles.zone?.name, zoneFactor: regles.zoneFactor, pickupFee: regles.pickupFee,
    breakdown: {
      base: Math.round(base + coutArrets), distance: Math.round(distance), time: Math.round(temps), surge: 1,
      traffic: 0, discount: 0, subtotal: Math.round(subtotal),
      tva: Math.round(subtotal * s.tvaRate), fee: Math.round(subtotal * s.feeRate),
      insurance: d.insurance ? Math.round(subtotal * s.insuranceRate) : 0,
    },
  };
}

/** Prix d'une livraison à moto, comme le module de livraison du serveur. `tailleFacteur` : 1, 1,12 ou 1,25. */
export function prixLivraison(d: { origin: Pt; destination: Pt; distanceMeters: number; tailleFacteur: number; at?: Date }): DetailPrix {
  const b = BAREME_LIVRAISON;
  const f = d.tailleFacteur;
  const trafic = traficServeur(d.origin, d.destination, d.at);
  const zone = zoneTarif(d.origin);
  const km = d.distanceMeters / 1000;
  const minutes = (km / b.avgSpeedKmh) * 60;
  const base = b.baseFare * f;
  const distance = km * b.perKm * f;
  const temps = minutes * b.perMinute * f;
  const coefTrafic = 1 + (trafic.factor - 1) * BAREME.trafficWeight;
  const subtotal = Math.max((base + distance + temps) * coefTrafic * Math.max(0.1, zone?.factor ?? 1), b.minFare);
  const tva = subtotal * BAREME.tvaRate;
  const fee = subtotal * BAREME.feeRate;
  return {
    amount: arrondi50(subtotal + tva + fee), trafficLevel: trafic.level, trafficFactor: trafic.factor,
    zone: zone?.name, zoneFactor: zone?.factor ?? 1, pickupFee: 0,
    breakdown: {
      base: Math.round(base), distance: Math.round(distance), time: Math.round(temps), surge: 1,
      traffic: 0, discount: 0, subtotal: Math.round(subtotal), tva: Math.round(tva), fee: Math.round(fee), insurance: 0,
    },
  };
}
