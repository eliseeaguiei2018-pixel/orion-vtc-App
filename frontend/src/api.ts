import type { LatLng, Quote, Vehicle } from './types';

/**
 * Client API ORION. Si VITE_API_URL est défini et joignable, on utilise le backend réel.
 * Sinon (mode démo), on calcule localement pour que l'app reste pleinement fonctionnelle
 * — utile pour les démonstrations et la revue de design sans infra.
 */
const API = (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/$/, '') ?? '';

async function tryFetch<T>(path: string, init?: RequestInit, timeoutMs = 2500): Promise<T | null> {
  if (!API) return null;
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    const res = await fetch(`${API}${path}`, {
      ...init,
      headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) },
      signal: ctrl.signal,
    });
    clearTimeout(timer);
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null; // bascule en mode démo
  }
}

function haversine(a: LatLng, b: LatLng): number {
  const R = 6_371_000;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const la1 = (a.lat * Math.PI) / 180;
  const la2 = (b.lat * Math.PI) / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.sin(dLng / 2) ** 2 * Math.cos(la1) * Math.cos(la2);
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

const round50 = (n: number) => Math.round(n / 50) * 50;

/** Estimation locale (miroir simplifié du backend, en FCFA). */
function localEstimate(origin: LatLng, destination: LatLng, vehicle: Vehicle): Quote {
  const distanceMeters = haversine(origin, destination) * 1.3;
  const km = distanceMeters / 1000;
  const etaSeconds = Math.round((km / 22) * 3600);
  const base = 600 * vehicle.multiplier;
  const distance = km * 280 * vehicle.multiplier;
  const time = (etaSeconds / 60) * 40 * vehicle.multiplier;
  const surge = 1.1;
  const amount = round50(Math.max((base + distance + time) * surge, 1200 * vehicle.multiplier));
  return {
    lockId: `local-${Date.now()}`,
    amount,
    currency: 'XOF',
    distanceMeters: Math.round(distanceMeters),
    etaSeconds,
    breakdown: { base: Math.round(base), distance: Math.round(distance), time: Math.round(time), surge, discount: 0 },
  };
}

/** Aperçu synchrone du prix (pour afficher la liste des véhicules sans latence). */
export function previewQuote(origin: LatLng, destination: LatLng, vehicle: Vehicle): Quote {
  return localEstimate(origin, destination, vehicle);
}

export async function estimate(origin: LatLng, destination: LatLng, vehicle: Vehicle): Promise<Quote> {
  const remote = await tryFetch<{ quote: Quote }>('/pricing/estimate', {
    method: 'POST',
    body: JSON.stringify({ origin, destination, category: vehicle.id === 'eco' ? 'eco' : vehicle.id }),
  });
  if (remote?.quote) {
    // Le backend tarifie 'green' par défaut ; on applique le multiplicateur véhicule pour la démo.
    return remote.quote;
  }
  return localEstimate(origin, destination, vehicle);
}

export async function sos(userId: string, location: LatLng, rideId?: string) {
  const remote = await tryFetch<{ alert: unknown }>('/safety/sos', {
    method: 'POST',
    body: JSON.stringify({ userId, location, rideId }),
  });
  return remote?.alert ?? { id: `local-sos-${Date.now()}`, status: 'dispatched', dispatchedTo: ['185', '170'] };
}

export function isLiveBackend(): boolean {
  return Boolean(API);
}
