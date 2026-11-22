import { useEffect, useMemo, useRef, useState } from 'react';
import { itineraire, type ItineraireRoute, type Manoeuvre } from '../api';
import type { LatLng } from './types';
import { haversine } from './format';
import { aTraduire, tr } from './i18n';
import { meilleureVoieNormale, PEAGES, peagesSurTrace, viasDeContournement } from '../routesAbidjan';

/**
 * NAVIGATION GUIDÉE DE L'APP CHAUFFEUR, sur la vraie carte de Côte d'Ivoire.
 *
 * L'itinéraire vient du serveur ORION (OSRM sur OpenStreetMap : ponts, échangeurs et
 * bretelles, voies nouvelles dès qu'elles sont cartographiées). À chaque position GPS,
 * on situe le véhicule sur le tracé, on annonce la prochaine manœuvre et sa distance,
 * on recalcule la distance et l'heure d'arrivée, et l'on refait l'itinéraire si le
 * chauffeur s'en écarte (déviation, route barrée, nouveau chantier).
 */

/** Distance (m) au tracé au-delà de laquelle le chauffeur est considéré hors itinéraire. */
export const ECART_MAX = 60;
/** Positions consécutives hors itinéraire avant de recalculer. */
const HORS_AVANT_RECALCUL = 3;
/** Délai minimal entre deux recalculs (protège le serveur d'itinéraires). */
const RECALCUL_MIN_MS = 20_000;

export interface ManoeuvrePlacee extends Manoeuvre {
  /** Distance du point de manœuvre depuis le début du tracé (m). */
  a: number;
}

export interface RouteGuidage {
  geometrie: LatLng[];
  /** Distance cumulée à chaque point du tracé (m). */
  cumul: number[];
  total: number;
  dureeSecondes: number;
  manoeuvres: ManoeuvrePlacee[];
  ponts: string[];
  fiable: boolean;
  cible: LatLng;
}

export interface Guidage {
  prochaine: (ManoeuvrePlacee & { distance: number }) | null;
  puis: ManoeuvrePlacee | null;
  parcouru: number;
  reste: number;
  resteSecondes: number;
  /** Distance du véhicule au tracé (m). */
  ecart: number;
  /** Partie du tracé encore à parcourir, depuis le véhicule. */
  restant: LatLng[];
  ponts: string[];
  fiable: boolean;
}

/* ------------------------------ Géométrie ------------------------------ */

const M_PAR_DEG_LAT = 110_540;
const mParDegLng = (lat: number) => 111_320 * Math.cos((lat * Math.PI) / 180);

/** Point le plus proche du véhicule sur le tracé (à partir du segment `depuis`). */
export function projeter(geo: LatLng[], cumul: number[], p: LatLng, depuis = 0): { index: number; parcouru: number; ecart: number } {
  if (geo.length < 2) return { index: 0, parcouru: 0, ecart: geo[0] ? haversine(p, geo[0]) : 0 };
  const kx = mParDegLng(p.lat);
  let meilleur = { index: depuis, parcouru: cumul[depuis] ?? 0, ecart: Infinity };
  for (let i = Math.max(0, depuis); i < geo.length - 1; i += 1) {
    const a = geo[i]!, b = geo[i + 1]!;
    const ax = (a.lng - p.lng) * kx, ay = (a.lat - p.lat) * M_PAR_DEG_LAT;
    const bx = (b.lng - p.lng) * kx, by = (b.lat - p.lat) * M_PAR_DEG_LAT;
    const dx = bx - ax, dy = by - ay;
    const l2 = dx * dx + dy * dy;
    const t = l2 > 0 ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / l2)) : 0;
    const ecart = Math.hypot(ax + t * dx, ay + t * dy);
    if (ecart < meilleur.ecart) {
      meilleur = { index: i, parcouru: cumul[i]! + t * (cumul[i + 1]! - cumul[i]!), ecart };
    }
  }
  return meilleur;
}

/** Point situé à `d` mètres du début du tracé. */
export function pointA(geo: LatLng[], cumul: number[], d: number): LatLng {
  if (geo.length < 2) return geo[0]!;
  if (d <= 0) return geo[0]!;
  const total = cumul[cumul.length - 1]!;
  if (d >= total) return geo[geo.length - 1]!;
  let i = 1;
  while (i < cumul.length - 1 && cumul[i]! < d) i += 1;
  const seg = cumul[i]! - cumul[i - 1]! || 1;
  const f = (d - cumul[i - 1]!) / seg;
  const a = geo[i - 1]!, b = geo[i]!;
  return { lat: a.lat + (b.lat - a.lat) * f, lng: a.lng + (b.lng - a.lng) * f };
}

/** Prépare un itinéraire pour le guidage : longueurs cumulées et manœuvres situées sur le tracé. */
export function preparer(route: ItineraireRoute, cible: LatLng): RouteGuidage {
  const geo = route.geometrie.length > 1 ? route.geometrie : [route.geometrie[0] ?? cible, cible];
  const cumul = [0];
  for (let i = 1; i < geo.length; i += 1) cumul.push(cumul[i - 1]! + haversine(geo[i - 1]!, geo[i]!));
  const total = cumul[cumul.length - 1]!;
  let depuis = 0;
  const manoeuvres: ManoeuvrePlacee[] = [];
  for (const m of route.manoeuvres ?? []) {
    // Les manœuvres se suivent sur le tracé : on cherche chacune après la précédente
    // (un itinéraire qui repasse au même carrefour ne mélange pas les étapes).
    const p = projeter(geo, cumul, m.position, depuis);
    depuis = p.index;
    manoeuvres.push({ ...m, a: m.type === 'arrive' ? total : p.parcouru });
  }
  return {
    geometrie: geo, cumul, total, dureeSecondes: route.durationSeconds || Math.round((total / 1000 / 22) * 3600),
    manoeuvres, ponts: route.ponts ?? [], fiable: route.provider === 'osrm', cible,
  };
}

/** Situe le véhicule sur l'itinéraire et annonce la suite. */
export function guider(g: RouteGuidage, position: LatLng): Guidage {
  const p = projeter(g.geometrie, g.cumul, position);
  const reste = Math.max(0, g.total - p.parcouru);
  const suivantes = g.manoeuvres.filter((m) => m.type !== 'depart' && m.a > p.parcouru + 8);
  const prochaine = suivantes[0] ?? null;
  return {
    prochaine: prochaine ? { ...prochaine, distance: Math.max(0, prochaine.a - p.parcouru) } : null,
    puis: suivantes[1] ?? null,
    parcouru: p.parcouru,
    reste,
    resteSecondes: g.total > 0 ? Math.round((g.dureeSecondes * reste) / g.total) : 0,
    ecart: p.ecart,
    restant: [position, ...g.geometrie.slice(p.index + 1)],
    ponts: g.ponts,
    fiable: g.fiable,
  };
}

/* ------------------------------- Textes -------------------------------- */

const DIRECTION: Record<string, string> = {
  left: aTraduire('Tournez à gauche'), right: aTraduire('Tournez à droite'),
  'slight left': aTraduire('Serrez à gauche'), 'slight right': aTraduire('Serrez à droite'),
  'sharp left': aTraduire('Tournez franchement à gauche'), 'sharp right': aTraduire('Tournez franchement à droite'),
  straight: aTraduire('Continuez tout droit'), uturn: aTraduire('Faites demi-tour'),
};
const cote = (m?: string) => (m?.includes('left') ? 'gauche' : m?.includes('right') ? 'droite' : '');

/**
 * Instruction à afficher (et à dire) pour une manœuvre, dans la langue du chauffeur.
 * `arrivee` : libellé du point d'arrivée (client, colis, destination).
 */
export function texteManoeuvre(m: Manoeuvre, arrivee?: string): string {
  switch (m.type) {
    case 'arrive': return arrivee ?? tr('Arrivée à destination');
    case 'depart': return tr('Démarrez');
    case 'on ramp':
      return cote(m.modificateur) === 'droite' ? tr('Prenez la bretelle de droite') : cote(m.modificateur) === 'gauche' ? tr('Prenez la bretelle de gauche') : tr('Prenez la bretelle');
    case 'off ramp':
      return cote(m.modificateur) === 'droite' ? tr('Sortez à droite') : cote(m.modificateur) === 'gauche' ? tr('Sortez à gauche') : tr('Prenez la sortie');
    case 'fork':
      return cote(m.modificateur) === 'droite' ? tr('Restez à droite') : cote(m.modificateur) === 'gauche' ? tr('Restez à gauche') : tr('Continuez sur la voie principale');
    case 'merge': return tr('Insérez-vous dans la circulation');
    case 'roundabout':
    case 'rotary':
    case 'roundabout turn':
      return m.sortie ? tr('Au rond-point, prenez la sortie {0}', [m.sortie]) : tr('Prenez le rond-point');
    case 'exit roundabout':
    case 'exit rotary':
      return tr('Sortez du rond-point');
    default:
      return tr(DIRECTION[m.modificateur ?? 'straight'] ?? 'Continuez tout droit');
  }
}

/** Distance lisible : « 350 m », « 1,2 km ». */
export function distanceLisible(m: number): string {
  if (m < 1000) return `${Math.max(10, Math.round(m / 10) * 10)} m`;
  return `${(m / 1000).toLocaleString('fr-FR', { maximumFractionDigits: 1 })} km`;
}

/** Angle de la flèche de manœuvre (0 = tout droit, 90 = à droite). */
export function angleFleche(m: Manoeuvre): number {
  const a: Record<string, number> = { straight: 0, 'slight right': 40, right: 90, 'sharp right': 135, uturn: 180, 'sharp left': -135, left: -90, 'slight left': -40 };
  return a[m.modificateur ?? 'straight'] ?? 0;
}

/* -------------------------------- Hook --------------------------------- */

/** Choix du client pour le trajet : par le pont à péage, ou par la voie normale. */
export interface ConsigneItineraire { choix: 'peage' | 'normal'; peages: string[] }

/**
 * Itinéraire qui respecte le choix du client. Le calcul habituel passe-t-il un péage alors
 * que le client a choisi la voie normale ? On repasse par le contournement de ce péage
 * (pont gratuit, ancienne route). A-t-il choisi le pont et le calcul l'évite-t-il ? On
 * passe par le poste de péage. Les postes déjà franchis (`passes`) ne sont plus imposés.
 */
async function itineraireSelonConsigne(depart: LatLng, vers: LatLng, consigne: ConsigneItineraire | null, passes: Set<string>): Promise<ItineraireRoute | null> {
  const r = await itineraire([depart, vers]);
  if (!consigne || !r) return r;
  const franchis = peagesSurTrace(r.geometrie);
  let via: LatLng[] = [];
  if (consigne.choix === 'normal' && franchis.length > 0) {
    // Points de contournement essayés en même temps ; la voie normale la plus rapide est suivie.
    const essais = await Promise.all(viasDeContournement(franchis).map((v) => itineraire([depart, ...v, vers]).catch(() => null)));
    return meilleureVoieNormale(essais.filter((x): x is ItineraireRoute => x !== null)) ?? r;
  } else if (consigne.choix === 'peage') {
    via = PEAGES.filter((p) => consigne.peages.includes(p.id) && !passes.has(p.id) && !franchis.some((f) => f.id === p.id)).map((p) => ({ lat: p.lat, lng: p.lng }));
  }
  if (via.length === 0) return r;
  const detour = await itineraire([depart, ...via, vers]);
  if (!detour) return r;
  const encore = peagesSurTrace(detour.geometrie);
  const respecte = consigne.choix === 'normal' ? encore.length === 0 : consigne.peages.every((id) => passes.has(id) || encore.some((p) => p.id === id));
  return respecte ? detour : r;
}

/**
 * Itinéraire guidé vers `cible` depuis la position du chauffeur. Calculé à chaque nouvelle
 * cible (client à rejoindre, puis destination), recalculé si le chauffeur s'écarte.
 * `consigne` : l'itinéraire choisi par le client (pont à péage ou voie normale), respecté
 * vers la destination.
 */
export function useNavigation(position: LatLng, cible: LatLng | null, consigne: ConsigneItineraire | null = null): { route: RouteGuidage | null; guidage: Guidage | null; recalcul: boolean } {
  const [route, setRoute] = useState<RouteGuidage | null>(null);
  const [recalcul, setRecalcul] = useState(false);
  const pos = useRef(position);
  pos.current = position;
  const hors = useRef(0);
  const dernierCalcul = useRef(0);
  const cle = cible ? `${cible.lat.toFixed(5)},${cible.lng.toFixed(5)}|${consigne?.choix ?? ''}` : '';
  const consigneRef = useRef(consigne);
  consigneRef.current = consigne;
  // Postes de péage déjà franchis (moins de 120 m) : on ne ramène jamais le chauffeur en arrière.
  const passes = useRef(new Set<string>());
  useEffect(() => { passes.current = new Set(); }, [cle]);
  useEffect(() => {
    for (const p of PEAGES) if (haversine(position, p) < 120) passes.current.add(p.id);
  }, [position]);

  const calculer = (vers: LatLng, actif: () => boolean) => {
    dernierCalcul.current = Date.now();
    hors.current = 0;
    const depart = pos.current;
    void itineraireSelonConsigne(depart, vers, consigneRef.current, passes.current).then((r) => {
      if (!actif()) return;
      setRecalcul(false);
      // Sans réseau : repère en ligne droite, la course continue (Google Maps / Waze restent proposés).
      setRoute(preparer(r ?? { geometrie: [depart, vers], distanceMeters: haversine(depart, vers), durationSeconds: 0, ponts: [], provider: 'repli' }, vers));
    });
  };

  useEffect(() => {
    if (!cible) { setRoute(null); return; }
    let actif = true;
    setRoute(null);
    calculer(cible, () => actif);
    return () => { actif = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cle]);

  const guidage = useMemo(() => (route ? guider(route, position) : null), [route, position]);

  // Écart au tracé : après quelques positions hors itinéraire, nouveau calcul depuis là où l'on est.
  useEffect(() => {
    if (!guidage || !route || !cible || !route.fiable) return;
    if (guidage.ecart <= ECART_MAX) { hors.current = 0; return; }
    hors.current += 1;
    if (hors.current >= HORS_AVANT_RECALCUL && Date.now() - dernierCalcul.current > RECALCUL_MIN_MS) {
      setRecalcul(true);
      calculer(cible, () => true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [guidage]);

  return { route, guidage, recalcul };
}
