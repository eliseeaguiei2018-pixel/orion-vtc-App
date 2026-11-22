/**
 * DISTRICT AUTONOME D'ABIDJAN ET PÉAGES — données géographiques partagées par le serveur et
 * l'application (copie exacte dans frontend/src/routesAbidjan.ts, comparée par
 * backend/tests/prix-application.test.ts).
 *
 *  - Limite du district (13 communes) : contour officiel OCHA / CNTIG (HDX, « cod-ab-civ »,
 *    2018), simplifié à 104 points (précision d'environ 250 m). Sert à deux règles :
 *    l'écart entre gammes passe de 5 % à 10 % quand la course sort d'Abidjan, et la mise à
 *    disposition à l'heure n'est proposée que dans le district.
 *  - Postes de péage (OpenStreetMap via Overture Maps, 2026-11) : pont Henri Konan Bédié,
 *    4ᵉ pont, Grand-Bassam, Attinguié, Thomasset. Montant pour un véhicule léger : 500 F
 *    au pont HKB et au 4ᵉ pont (relevé OpenStreetMap) ; 500 F par défaut ailleurs, réglable
 *    dans la console (Tarification).
 *
 * Fichier sans dépendance : le test du serveur l'importe tel quel.
 */
export interface PointGeo { lat: number; lng: number }

/** Contour du district, [lat, lng]. */
export const DISTRICT_ABIDJAN: ReadonlyArray<readonly [number, number]> = [
  [5.6009, -4.1618], [5.6051, -4.1793], [5.595, -4.199], [5.6008, -4.2094], [5.6002, -4.2452], [5.5941, -4.2618],
  [5.5807, -4.3616], [5.6018, -4.3931], [5.5336, -4.4611], [5.5301, -4.4573], [5.5316, -4.4469], [5.525, -4.4366],
  [5.5288, -4.42], [5.5226, -4.4105], [5.5264, -4.4016], [5.5261, -4.3855], [5.5119, -4.365], [5.5042, -4.3378],
  [5.4967, -4.3326], [5.4843, -4.3016], [5.4757, -4.3034], [5.4545, -4.2991], [5.4555, -4.2904], [5.4512, -4.2863],
  [5.434, -4.2868], [5.4327, -4.2906], [5.4239, -4.2911], [5.4201, -4.3112], [5.4019, -4.3179], [5.3928, -4.3063],
  [5.3085, -4.2959], [5.275, -4.2736], [5.2795, -4.2259], [5.2188, -4.2141], [5.2317, -4.1163], [5.2369, -4.1009],
  [5.2446, -4.0102], [5.2497, -4.0035], [5.2478, -3.972], [5.2215, -3.8514], [5.2282, -3.852], [5.2535, -3.84],
  [5.2508, -3.8149], [5.2699, -3.8181], [5.2853, -3.8049], [5.2715, -3.7851], [5.2974, -3.7163], [5.3045, -3.7239],
  [5.3128, -3.7458], [5.3279, -3.7461], [5.333, -3.7496], [5.3386, -3.7683], [5.3546, -3.7598], [5.3623, -3.7599],
  [5.3683, -3.7647], [5.3744, -3.7792], [5.3679, -3.787], [5.3813, -3.8076], [5.3769, -3.8224], [5.3707, -3.822],
  [5.3667, -3.8166], [5.373, -3.8293], [5.3819, -3.8285], [5.3872, -3.8337], [5.3906, -3.8291], [5.399, -3.8299],
  [5.4066, -3.8222], [5.4146, -3.8223], [5.4161, -3.8171], [5.4215, -3.8206], [5.4246, -3.8155], [5.4269, -3.8198],
  [5.4323, -3.8182], [5.4336, -3.824], [5.4299, -3.8273], [5.4395, -3.8283], [5.4387, -3.8348], [5.4544, -3.838],
  [5.4567, -3.8314], [5.4635, -3.8289], [5.4718, -3.8365], [5.4747, -3.8319], [5.4851, -3.8367], [5.4847, -3.8441],
  [5.4942, -3.8443], [5.5091, -3.8529], [5.5012, -3.8748], [5.5191, -3.8777], [5.5203, -3.8843], [5.547, -3.8989],
  [5.5536, -3.9116], [5.5614, -3.9148], [5.5583, -3.9196], [5.5608, -3.9283], [5.5717, -3.9275], [5.5891, -3.9401],
  [5.5824, -4.0294], [5.5879, -4.0382], [5.5745, -4.0715], [5.5757, -4.0993], [5.5846, -4.1295], [5.5987, -4.144],
  [5.5962, -4.1584], [5.6009, -4.1618],
];

/** Le point est-il dans le district autonome d'Abidjan ? (lancer de rayon sur le contour) */
export function dansDistrictAbidjan(p: PointGeo): boolean {
  let dedans = false;
  const c = DISTRICT_ABIDJAN;
  for (let i = 0, j = c.length - 1; i < c.length; j = i++) {
    const [yi, xi] = c[i]!; const [yj, xj] = c[j]!;
    if ((yi > p.lat) !== (yj > p.lat) && p.lng < ((xj - xi) * (p.lat - yi)) / (yj - yi) + xi) dedans = !dedans;
  }
  return dedans;
}

/** La course sort-elle d'Abidjan ? (départ, arrêts ou arrivée hors du district) */
export function sortDAbidjan(points: PointGeo[]): boolean {
  return points.some((p) => !dansDistrictAbidjan(p));
}

export interface Peage {
  id: string; nom: string; lat: number; lng: number;
  /** Montant pour un véhicule léger, en F CFA (réglable dans la console). */
  montant: number;
  /** Pont à péage : le client choisit entre ce pont et la voie normale. */
  pont: boolean;
  /**
   * Point de passage d'une voie normale qui évite ce péage (pont gratuit, ancienne route),
   * quand le calcul d'itinéraire n'en propose pas de lui-même.
   */
  contournement?: PointGeo;
}

export const PEAGES: Peage[] = [
  // Voie normale : par le pont Général-de-Gaulle (Plateau ↔ Treichville), gratuit.
  { id: 'hkb', nom: 'Pont Henri Konan Bédié', lat: 5.32741, lng: -3.98102, montant: 500, pont: true, contournement: { lat: 5.31640, lng: -4.01040 } },
  // Voie normale : par Adjamé et le boulevard Nangui-Abrogoua (sans le 4ᵉ pont).
  { id: 'pont4', nom: '4ᵉ pont (Yopougon – Plateau)', lat: 5.33573, lng: -4.04411, montant: 500, pont: true, contournement: { lat: 5.35560, lng: -4.02530 } },
  // Voie normale : l'ancienne route de Bassam, par Port-Bouët et Gonzagueville.
  { id: 'bassam', nom: 'Péage de Grand-Bassam', lat: 5.23431, lng: -3.81362, montant: 500, pont: false, contournement: { lat: 5.21600, lng: -3.85500 } },
  { id: 'attinguie', nom: "Péage d'Attinguié (autoroute du Nord)", lat: 5.47032, lng: -4.20152, montant: 500, pont: false },
  { id: 'thomasset', nom: 'Péage de Thomasset', lat: 5.56092, lng: -4.06886, montant: 500, pont: false },
];

/** Distance (m) d'un point à un segment, en projection locale (suffisant à l'échelle d'une ville). */
function distanceAuSegment(p: PointGeo, a: PointGeo, b: PointGeo): number {
  const kx = 111_320 * Math.cos((p.lat * Math.PI) / 180), ky = 110_540;
  const ax = (a.lng - p.lng) * kx, ay = (a.lat - p.lat) * ky, bx = (b.lng - p.lng) * kx, by = (b.lat - p.lat) * ky;
  const dx = bx - ax, dy = by - ay; const l2 = dx * dx + dy * dy;
  const t = l2 > 0 ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / l2)) : 0;
  return Math.hypot(ax + t * dx, ay + t * dy);
}

/**
 * Péages traversés par un itinéraire (son tracé) : un poste est franchi quand le tracé passe
 * à moins de 90 m de lui. `liste` : les péages de la console (par défaut, ceux ci-dessus).
 */
export function peagesSurTrace(trace: PointGeo[], liste: Peage[] = PEAGES): Peage[] {
  if (trace.length < 2) return [];
  return liste.filter((pg) => {
    for (let i = 1; i < trace.length; i++) if (distanceAuSegment(pg, trace[i - 1]!, trace[i]!) < 90) return true;
    return false;
  });
}

/** Un itinéraire candidat (Google ou ORION), avec sa durée et son tracé. */
export interface RouteCandidate { geometrie: PointGeo[]; distanceMeters: number; durationSeconds: number }
export interface ItineraireClasse<R extends RouteCandidate> { route: R; peages: Peage[] }

/**
 * Range des itinéraires candidats en deux familles : par un péage, ou par la voie normale.
 * Dans chaque famille, le plus rapide. La voie normale est écartée si elle est absurde
 * (plus de trois fois plus longue que le péage, plus 20 minutes).
 */
export function classerItineraires<R extends RouteCandidate>(routes: R[], liste: Peage[] = PEAGES): { peage: ItineraireClasse<R> | null; normal: ItineraireClasse<R> | null } {
  let peage: ItineraireClasse<R> | null = null;
  let normal: ItineraireClasse<R> | null = null;
  for (const route of routes) {
    if (!route.geometrie || route.geometrie.length < 2 || !(route.distanceMeters > 0)) continue;
    const franchis = peagesSurTrace(route.geometrie, liste);
    if (franchis.length > 0) { if (!peage || route.durationSeconds < peage.route.durationSeconds) peage = { route, peages: franchis }; }
    else if (!normal || route.durationSeconds < normal.route.durationSeconds) normal = { route, peages: [] };
  }
  if (peage && normal && normal.route.durationSeconds > peage.route.durationSeconds * 3 + 1200) normal = null;
  return { peage, normal };
}
