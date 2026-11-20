import { config } from '../../config/index.js';
import { haversineMeters, type LatLng } from '../../core/geo.js';

/**
 * Couche d'abstraction cartographique — prête pour un partenariat Google Maps.
 *
 * L'app dépend de l'interface `MapsProvider`, pas de Google directement. Si une clé
 * `GOOGLE_MAPS_API_KEY` est fournie, on utilise l'API Google (itinéraires réels tenant
 * compte du trafic et du réseau routier ivoirien) ; sinon on bascule sur un calcul interne
 * (haversine + vitesse moyenne) pour que l'application reste pleinement fonctionnelle.
 */
export interface RouteResult {
  distanceMeters: number;
  durationSeconds: number;
  /** Polyline encodée (Google) si disponible, pour tracer l'itinéraire. */
  polyline?: string;
  provider: 'google' | 'internal';
}

export interface PlaceSuggestion {
  description: string;
  placeId?: string;
  location?: LatLng;
}

export interface MapsProvider {
  route(origin: LatLng, destination: LatLng): Promise<RouteResult>;
  autocomplete(query: string, near?: LatLng): Promise<PlaceSuggestion[]>;
}

/** Implémentation interne (sans dépendance externe). */
export class InternalMapsProvider implements MapsProvider {
  constructor(private readonly avgSpeedKmh = 22) {}

  async route(origin: LatLng, destination: LatLng): Promise<RouteResult> {
    const distanceMeters = Math.round(haversineMeters(origin, destination));
    // Facteur de sinuosité ~1.3 : la route réelle est plus longue que le vol d'oiseau.
    const roadMeters = Math.round(distanceMeters * 1.3);
    const durationSeconds = Math.round((roadMeters / 1000 / this.avgSpeedKmh) * 3600);
    return { distanceMeters: roadMeters, durationSeconds, provider: 'internal' };
  }

  async autocomplete(): Promise<PlaceSuggestion[]> {
    // Sans Google, l'autocomplétion riche n'est pas disponible.
    return [];
  }
}

/** Implémentation Google Maps (activée par la présence d'une clé API). */
export class GoogleMapsProvider implements MapsProvider {
  constructor(private readonly apiKey: string) {}

  async route(origin: LatLng, destination: LatLng): Promise<RouteResult> {
    const url = new URL('https://maps.googleapis.com/maps/api/directions/json');
    url.searchParams.set('origin', `${origin.lat},${origin.lng}`);
    url.searchParams.set('destination', `${destination.lat},${destination.lng}`);
    url.searchParams.set('mode', 'driving');
    url.searchParams.set('departure_time', 'now'); // prise en compte du trafic
    url.searchParams.set('region', 'ci');
    url.searchParams.set('key', this.apiKey);

    const res = await fetch(url);
    if (!res.ok) throw new Error(`Google Directions HTTP ${res.status}`);
    const json = (await res.json()) as GoogleDirectionsResponse;
    const leg = json.routes?.[0]?.legs?.[0];
    if (!leg) throw new Error('Aucun itinéraire trouvé');
    return {
      distanceMeters: leg.distance.value,
      durationSeconds: (leg.duration_in_traffic ?? leg.duration).value,
      polyline: json.routes?.[0]?.overview_polyline?.points,
      provider: 'google',
    };
  }

  async autocomplete(query: string, near?: LatLng): Promise<PlaceSuggestion[]> {
    const url = new URL('https://maps.googleapis.com/maps/api/place/autocomplete/json');
    url.searchParams.set('input', query);
    url.searchParams.set('components', 'country:ci'); // restreint à la Côte d'Ivoire
    url.searchParams.set('language', 'fr');
    if (near) url.searchParams.set('location', `${near.lat},${near.lng}`);
    if (near) url.searchParams.set('radius', '30000');
    url.searchParams.set('key', this.apiKey);

    const res = await fetch(url);
    if (!res.ok) throw new Error(`Google Places HTTP ${res.status}`);
    const json = (await res.json()) as GooglePlacesResponse;
    return (json.predictions ?? []).map((p) => ({ description: p.description, placeId: p.place_id }));
  }
}

/** Fabrique le provider selon la configuration (Google si clé, sinon interne). */
export function createMapsProvider(): MapsProvider {
  if (config.GOOGLE_MAPS_API_KEY) return new GoogleMapsProvider(config.GOOGLE_MAPS_API_KEY);
  return new InternalMapsProvider();
}

// Types minimaux des réponses Google utilisées.
interface GoogleDirectionsResponse {
  routes?: Array<{
    overview_polyline?: { points: string };
    legs?: Array<{
      distance: { value: number };
      duration: { value: number };
      duration_in_traffic?: { value: number };
    }>;
  }>;
}
interface GooglePlacesResponse {
  predictions?: Array<{ description: string; place_id: string }>;
}
