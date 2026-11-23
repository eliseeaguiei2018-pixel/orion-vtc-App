/*
 * COPIE pour l'application cliente (prix hors connexion) de backend/src/modules/geo-ci/traficItineraire.ts :
 * même grille horaire, mêmes points de blocage, même calcul. Le test prix-application.test.ts
 * exige le même résultat des deux côtés. La densité des quartiers vient de tarifServeur.ts.
 */
type LatLng = { lat: number; lng: number };
function haversineMeters(a: LatLng, b: LatLng): number {
  const R = 6_371_000;
  const rad = (d: number) => (d * Math.PI) / 180;
  const h = Math.sin(rad(b.lat - a.lat) / 2) ** 2 + Math.sin(rad(b.lng - a.lng) / 2) ** 2 * Math.cos(rad(a.lat)) * Math.cos(rad(b.lat));
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}
let densiteAu: (p: LatLng) => number = () => 1;
/** Densité du quartier au point p (zones du serveur, recopiées dans tarifServeur.ts). */
export function brancherDensite(f: (p: LatLng) => number): void { densiteAu = f; }

/**
 * TRAFIC SUR L'ITINÉRAIRE — ce que les embouteillages d'Abidjan ajoutent au prix d'une course.
 *
 * L'itinéraire est découpé tous les ~150 m. Chaque tronçon reçoit un niveau (fluide, dense,
 * embouteillé) selon l'heure à Abidjan (pointes du matin et du soir en semaine, samedi plus
 * léger, dimanche calme, nuit fluide), la densité du quartier traversé et les POINTS DE
 * BLOCAGE connus (ponts, carrefours, gares) qui bouchent aux heures de pointe. Le prix suit :
 *  - la part du trajet en trafic dense (+densePct) et en embouteillage (+embouteillagePct) ;
 *  - chaque point de blocage traversé pendant qu'il est bouché (+parBouchonPct chacun) ;
 *  - le tout plafonné (plafondPct).
 * Quand l'application a mesuré le trafic réel du trajet (durée avec et sans trafic, Google),
 * cette mesure ne peut que relever le prix, jamais le baisser : le serveur garde la main.
 *
 * L'heure est celle d'Abidjan (GMT toute l'année) : aucune dépendance au fuseau du serveur.
 */
export type NiveauTrafic = 'fluid' | 'dense' | 'jam';
export type Periode = 'nuit' | 'calme' | 'journee' | 'midi' | 'pointe' | 'soiree';

export interface ReglesTrafic {
  actif: boolean;
  /** % ajouté au prix pour un trajet entièrement en trafic dense. */
  densePct: number;
  /** % ajouté au prix pour un trajet entièrement embouteillé. */
  embouteillagePct: number;
  /** % ajouté pour CHAQUE point de blocage traversé pendant qu'il est bouché. */
  parBouchonPct: number;
  /** Nombre maximal de points de blocage comptés sur un trajet. */
  maxBouchons: number;
  /** Plafond de tout ce que le trafic peut ajouter, en %. */
  plafondPct: number;
  /** Heures de pointe en semaine (heure d'Abidjan, « HH:MM »). */
  pointeMatin: [string, string];
  pointeSoir: [string, string];
  /** Nuit : trafic fluide partout. */
  nuit: [string, string];
}

export const REGLES_TRAFIC_DEFAUT: ReglesTrafic = {
  actif: true, densePct: 10, embouteillagePct: 20, parBouchonPct: 4, maxBouchons: 4, plafondPct: 35,
  pointeMatin: ['06:30', '09:30'], pointeSoir: ['16:30', '20:00'], nuit: ['21:30', '05:30'],
};

/** Point de blocage : bouche aux heures de pointe (et le samedi pour les marchés). */
export interface PointBlocage { id: string; nom: string; centre: LatLng; rayonM: number; samedi?: boolean }

/** Coordonnées relevées dans l'index des lieux d'Abidjan (OpenStreetMap, Overture). */
export const POINTS_BLOCAGE: readonly PointBlocage[] = [
  { id: 'pont-fhb', nom: 'Ponts du Plateau (FHB)', centre: { lat: 5.3168, lng: -4.0155 }, rayonM: 750 },
  { id: 'indenie', nom: 'Carrefour de l’Indénié', centre: { lat: 5.3400, lng: -4.0200 }, rayonM: 550 },
  { id: 'adjame-liberte', nom: 'Adjamé Liberté', centre: { lat: 5.3546, lng: -4.0164 }, rayonM: 550 },
  { id: 'adjame-renault', nom: 'Adjamé Renault', centre: { lat: 5.3559, lng: -4.0209 }, rayonM: 450 },
  { id: 'adjame-forum', nom: 'Forum des marchés d’Adjamé', centre: { lat: 5.3460, lng: -4.0250 }, rayonM: 600, samedi: true },
  { id: 'riviera-2', nom: 'Carrefour Riviera 2', centre: { lat: 5.3531, lng: -3.9796 }, rayonM: 500 },
  { id: 'rond-point-3e-pont', nom: 'Rond-point du 3e pont (HKB)', centre: { lat: 5.3295, lng: -3.9804 }, rayonM: 500 },
  { id: 'duncan', nom: 'Carrefour Duncan', centre: { lat: 5.3778, lng: -3.9973 }, rayonM: 450 },
  { id: 'latrille', nom: 'Boulevard Latrille', centre: { lat: 5.3600, lng: -3.9990 }, rayonM: 650 },
  { id: 'siporex', nom: 'Carrefour Siporex', centre: { lat: 5.3560, lng: -4.0750 }, rayonM: 550 },
  { id: 'gesco', nom: 'Rond-point de Gesco', centre: { lat: 5.3585, lng: -4.1013 }, rayonM: 550 },
  { id: 'abobo-gare', nom: 'Abobo Gare', centre: { lat: 5.4210, lng: -4.0175 }, rayonM: 600, samedi: true },
  { id: 'solibra', nom: 'Carrefour Solibra – Grand Carrefour', centre: { lat: 5.2995, lng: -3.9990 }, rayonM: 600, samedi: true },
  { id: 'echangeur-marcory', nom: 'Échangeur de Marcory', centre: { lat: 5.2960, lng: -3.9810 }, rayonM: 450 },
  { id: 'akwaba', nom: 'Carrefour Akwaba (aéroport)', centre: { lat: 5.2675, lng: -3.9615 }, rayonM: 500 },
];

const minutes = (hhmm: string): number => {
  const [h, m] = hhmm.split(':').map(Number);
  return ((h ?? 0) * 60 + (m ?? 0)) % 1440;
};
const dans = (t: number, [a, b]: [string, string]): boolean => {
  const debut = minutes(a);
  const fin = minutes(b);
  return debut <= fin ? t >= debut && t < fin : t >= debut || t < fin;
};

/** Période de circulation à Abidjan (GMT, sans heure d'été). */
export function periodeAbidjan(at: Date, r: ReglesTrafic = REGLES_TRAFIC_DEFAUT): Periode {
  const t = at.getUTCHours() * 60 + at.getUTCMinutes();
  const jour = at.getUTCDay(); // 0 dimanche … 6 samedi
  if (dans(t, r.nuit)) return 'nuit';
  if (jour === 0) return dans(t, ['17:00', '20:00']) ? 'soiree' : 'calme';
  if (jour === 6) return dans(t, ['10:00', '14:00']) || dans(t, ['17:00', '20:00']) ? 'journee' : 'calme';
  if (dans(t, r.pointeMatin) || dans(t, r.pointeSoir)) return 'pointe';
  if (dans(t, ['12:00', '14:00'])) return 'midi';
  return t >= minutes(r.pointeSoir[1]) ? 'soiree' : 'journee';
}

/** Point de blocage qui bouche à ce moment-là, au point p (ou null). */
function blocageActif(p: LatLng, periode: Periode, samedi: boolean): PointBlocage | null {
  for (const b of POINTS_BLOCAGE) {
    if (haversineMeters(p, b.centre) > b.rayonM) continue;
    if (periode === 'pointe' || (samedi && b.samedi && periode === 'journee')) return b;
  }
  return null;
}

const pres = (p: LatLng): boolean => POINTS_BLOCAGE.some((b) => haversineMeters(p, b.centre) <= b.rayonM);

/** Niveau d'un tronçon : heure, densité du quartier, points de blocage. */
export function niveauTroncon(p: LatLng, at: Date, r: ReglesTrafic = REGLES_TRAFIC_DEFAUT): { niveau: NiveauTrafic; blocage: PointBlocage | null } {
  const periode = periodeAbidjan(at, r);
  if (periode === 'nuit') return { niveau: 'fluid', blocage: null };
  const samedi = at.getUTCDay() === 6;
  const blocage = blocageActif(p, periode, samedi);
  if (blocage) return { niveau: 'jam', blocage };
  const densite = densiteAu(p);
  switch (periode) {
    // Heure de pointe : dense partout, embouteillé dans les quartiers les plus chargés.
    case 'pointe': return { niveau: densite >= 1.25 ? 'jam' : 'dense', blocage: null };
    case 'midi': return { niveau: densite >= 1.1 || pres(p) ? 'dense' : 'fluid', blocage: null };
    case 'journee': return { niveau: densite >= 1.15 || pres(p) ? 'dense' : 'fluid', blocage: null };
    case 'soiree': return { niveau: pres(p) || densite >= 1.25 ? 'dense' : 'fluid', blocage: null };
    default: return { niveau: 'fluid', blocage: null };
  }
}

export interface TraficTrajet {
  niveau: NiveauTrafic;
  /** Facteur de durée (1, 1,15 ou 1,35) : temps annoncés (approche, arrivée). */
  facteur: number;
  periode: Periode;
  /** Ce que le trafic ajoute au prix, en %. */
  pct: number;
  /** Part du trajet en trafic dense et embouteillé (0 à 1). */
  partDense: number;
  partBouchon: number;
  /** Points de blocage traversés pendant qu'ils sont bouchés. */
  bouchons: string[];
  /** 'itineraire' : calcul du serveur ; 'mesure' : trafic réel mesuré, plus fort. */
  source: 'itineraire' | 'mesure';
}

/** Points tous les ~pas mètres le long de la polyligne (au moins ses extrémités). */
export function echantillonner(trace: LatLng[], pas = 150): Array<{ p: LatLng; m: number }> {
  const out: Array<{ p: LatLng; m: number }> = [];
  for (let i = 0; i + 1 < trace.length; i++) {
    const a = trace[i]!;
    const b = trace[i + 1]!;
    const d = haversineMeters(a, b);
    const n = Math.max(1, Math.ceil(d / pas));
    for (let k = 0; k < n; k++) {
      const f = (k + 0.5) / n;
      out.push({ p: { lat: a.lat + (b.lat - a.lat) * f, lng: a.lng + (b.lng - a.lng) * f }, m: d / n });
    }
  }
  return out;
}

/**
 * Trafic d'un trajet : `trace` est l'itinéraire par la route (ou, à défaut, les points du
 * trajet en ligne droite). `mesure` : durées avec et sans trafic relevées sur la route réelle.
 */
export function traficTrajet(
  trace: LatLng[],
  at = new Date(),
  r: ReglesTrafic = REGLES_TRAFIC_DEFAUT,
  mesure?: { avecTraficS: number; sansTraficS: number } | null,
): TraficTrajet {
  const periode = periodeAbidjan(at, r);
  const points = echantillonner(trace.length >= 2 ? trace : [trace[0]!, trace[0]!]);
  let total = 0;
  let dense = 0;
  let bouchon = 0;
  const bouchons = new Set<string>();
  for (const { p, m } of points) {
    const t = niveauTroncon(p, at, r);
    total += m;
    if (t.niveau === 'dense') dense += m;
    if (t.niveau === 'jam') bouchon += m;
    if (t.blocage) bouchons.add(t.blocage.nom);
  }
  const partDense = total > 0 ? dense / total : 0;
  const partBouchon = total > 0 ? bouchon / total : 0;
  const liste = [...bouchons].slice(0, Math.max(0, r.maxBouchons));
  let pct = r.actif ? partDense * r.densePct + partBouchon * r.embouteillagePct + liste.length * r.parBouchonPct : 0;
  let source: TraficTrajet['source'] = 'itineraire';
  // Trafic réel mesuré sur la route (durée avec / sans trafic) : il ne fait que relever le prix.
  if (r.actif && mesure && mesure.sansTraficS > 60 && mesure.avecTraficS > 0) {
    const ratio = mesure.avecTraficS / mesure.sansTraficS;
    const mesurePct = Math.max(0, (ratio - 1.1) * 50);
    if (mesurePct > pct) { pct = mesurePct; source = 'mesure'; }
  }
  pct = Math.round(Math.min(Math.max(0, pct), Math.max(0, r.plafondPct)) * 10) / 10;
  const embouteille = partBouchon >= 0.25 || pct >= 0.75 * r.embouteillagePct + r.parBouchonPct;
  const niveau: NiveauTrafic = !r.actif ? 'fluid' : embouteille && pct > 0 ? 'jam' : pct >= r.densePct / 2 ? 'dense' : 'fluid';
  return { niveau, facteur: niveau === 'jam' ? 1.35 : niveau === 'dense' ? 1.15 : 1, periode, pct, partDense, partBouchon, bouchons: liste, source };
}

/** Normalise des règles enregistrées (champs manquants : valeurs par défaut). */
export function reglesTrafic(r?: Partial<ReglesTrafic> | null): ReglesTrafic {
  return { ...REGLES_TRAFIC_DEFAUT, ...(r ?? {}) };
}

/** Facteur de durée au point p (temps d'approche des chauffeurs autour du client). */
export function facteurAuPoint(p: LatLng, at = new Date(), r: ReglesTrafic = REGLES_TRAFIC_DEFAUT): number {
  if (!r.actif) return 1;
  const { niveau } = niveauTroncon(p, at, r);
  return niveau === 'jam' ? 1.35 : niveau === 'dense' ? 1.15 : 1;
}
