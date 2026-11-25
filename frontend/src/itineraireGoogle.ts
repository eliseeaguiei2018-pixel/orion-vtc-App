import type { LatLng } from './types';
import type { ItineraireRoute } from './api';
import { etatService, noterEchec, noterReponse, oublierEtat, ouvrirGoogle, type EtatService } from './servicesGoogle';

/**
 * ITINÉRAIRES GOOGLE — le trajet tracé sur la carte Google, sa distance et sa durée.
 *
 * Service « Routes API » : le trajet suit les routes de Google et la durée tient compte du
 * trafic du moment (`durationSeconds`), à côté de la durée sans circulation (`fluideSeconds`).
 * `via` est la grande voie empruntée, telle que Google la résume.
 *
 * Réservé à la carte Google de l'application cliente : les conditions de Google demandent
 * d'afficher ses itinéraires sur sa carte. Le prix de la course ne change pas (il reste
 * calculé par ORION). Si Google refuse ou ne répond pas, la fonction renvoie null et la
 * carte trace l'itinéraire d'ORION, comme avant.
 */
interface PointGoogle { lat: number; lng: number }
interface RouteGoogle { path?: PointGoogle[] | null; distanceMeters?: number | null; durationMillis?: number | null; staticDurationMillis?: number | null; description?: string | null }
interface BibliRoutes { Route?: { computeRoutes?(r: Record<string, unknown>): Promise<{ routes?: RouteGoogle[] | null }> } }

/** Un trajet déjà demandé n'est pas redemandé avant trois minutes (le trafic change peu). */
const FRAICHEUR = 180_000;
const cache = new Map<string, { quand: number; promesse: Promise<ItineraireRoute | null> }>();

export const etatItineraires = (): EtatService => etatService('itineraires');

export function itineraireGoogle(points: LatLng[]): Promise<ItineraireRoute | null> {
  if (points.length < 2) return Promise.resolve(null);
  const cle = points.map((p) => `${p.lat.toFixed(5)},${p.lng.toFixed(5)}`).join(';');
  const deja = cache.get(cle);
  if (deja && Date.now() - deja.quand < FRAICHEUR) return deja.promesse;
  const promesse = calculer(points);
  cache.set(cle, { quand: Date.now(), promesse });
  void promesse.then((r) => { if (!r && cache.get(cle)?.promesse === promesse) cache.delete(cle); });
  if (cache.size > 40) for (const k of [...cache.keys()].slice(0, cache.size - 40)) cache.delete(k);
  return promesse;
}

async function calculer(points: LatLng[]): Promise<ItineraireRoute | null> {
  return (await calculerTous(points, {}))?.[0] ?? null;
}

/** Une route de Google, dans la forme d'ORION. */
const versOrion = (r: RouteGoogle): ItineraireRoute | null => {
  if (!r.path || r.path.length < 2 || !r.distanceMeters) return null;   // aucune route entre ces points
  return {
    geometrie: r.path.map((p) => ({ lat: Number(p.lat), lng: Number(p.lng) })),
    distanceMeters: Math.round(r.distanceMeters), durationSeconds: Math.round((r.durationMillis ?? r.staticDurationMillis ?? 0) / 1000),
    fluideSeconds: Math.round((r.staticDurationMillis ?? r.durationMillis ?? 0) / 1000),
    via: r.description?.trim() || undefined, ponts: [], provider: 'google',
  };
};

async function calculerTous(points: LatLng[], o: { alternatives?: boolean; sansPeage?: boolean }): Promise<ItineraireRoute[] | null> {
  const maps = await ouvrirGoogle('itineraires');
  if (!maps) return null;
  try {
    const { Route } = await maps.importLibrary('routes') as BibliRoutes;
    if (!Route?.computeRoutes) return null;                       // version de l'API sans ce service
    const { routes } = await Route.computeRoutes({
      origin: points[0], destination: points[points.length - 1],
      intermediates: points.slice(1, -1).map((p) => ({ location: p })),
      travelMode: 'DRIVING', routingPreference: 'TRAFFIC_AWARE', language: 'fr', region: 'ci',
      // Variantes (Google n'en propose qu'entre deux points) et route qui évite les péages.
      ...(o.alternatives && points.length === 2 ? { computeAlternativeRoutes: true } : {}),
      ...(o.sansPeage ? { routeModifiers: { avoidTolls: true } } : {}),
      fields: ['path', 'distanceMeters', 'durationMillis', 'staticDurationMillis', 'description'],
    });
    noterReponse('itineraires');
    return (routes ?? []).map(versOrion).filter((r): r is ItineraireRoute => r !== null);
  } catch (e) {
    noterEchec('itineraires', e);
    return null;
  }
}

/**
 * Plusieurs itinéraires de Google pour le même trajet : le plus rapide et ses variantes,
 * puis celui qui évite les péages. Sert au choix « pont à péage ou voie normale ».
 */
export async function variantesGoogle(points: LatLng[]): Promise<ItineraireRoute[]> {
  if (points.length < 2) return [];
  const [toutes, sansPeage] = await Promise.all([calculerTous(points, { alternatives: true }), calculerTous(points, { sansPeage: true })]);
  return [...(toutes ?? []), ...(sansPeage ?? [])];
}

/** Nouvel essai demandé par le client (Menu → Carte → « Vérifier ») : un court trajet au Plateau. */
export async function verifierItineraires(): Promise<EtatService> {
  oublierEtat('itineraires');
  cache.clear();
  await itineraireGoogle([{ lat: 5.3237, lng: -4.017 }, { lat: 5.3305, lng: -4.0215 }]);
  return etatItineraires();
}
