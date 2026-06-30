import type { LatLng, Quote, TierOption } from './types';

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

export interface EstimateOpts {
  bodyType?: 'suv' | 'berline';
  stops?: LatLng[];
  insurance?: boolean;
}

const BODY = { berline: 1, suv: 1.08 } as const;

/** Détection de trafic locale (miroir du backend) selon l'heure. */
function localTraffic(): { level: 'fluid' | 'dense' | 'jam'; factor: number } {
  const h = new Date().getHours();
  if ((h >= 6 && h < 9) || (h >= 17 && h < 20)) return { level: 'jam', factor: 1.35 };
  if (h >= 9 && h < 17) return { level: 'dense', factor: 1.15 };
  return { level: 'fluid', factor: 1 };
}

/** Estimation locale (miroir simplifié du backend, en FCFA, avec TVA 5% + frais 10%). */
function localEstimate(origin: LatLng, destination: LatLng, tier: TierOption, opts: EstimateOpts = {}): Quote {
  const stops = opts.stops ?? [];
  const pts = [origin, ...stops, destination];
  let raw = 0;
  for (let i = 1; i < pts.length; i++) raw += haversine(pts[i - 1]!, pts[i]!);
  const distanceMeters = raw * 1.3;
  const km = distanceMeters / 1000;
  const bodyF = BODY[opts.bodyType ?? 'berline'];
  const traffic = localTraffic();
  const etaSeconds = Math.round((km / 22) * 3600 * traffic.factor);
  const base = 500 * tier.multiplier * bodyF + stops.length * 300 * tier.multiplier;
  const distance = km * 250 * tier.multiplier * bodyF;
  const time = (km / 22) * 60 * 35 * tier.multiplier * bodyF;
  const surge = 1.1;
  const floored = Math.max((base + distance + time) * surge, 1000 * tier.multiplier);
  const trafficCost = floored * (traffic.factor - 1);
  const subtotal = floored + trafficCost;
  const tva = subtotal * 0.05;
  const fee = subtotal * 0.1;
  const insurance = opts.insurance ? subtotal * 0.02 : 0;
  return {
    lockId: `local-${Date.now()}`,
    amount: round50(subtotal + tva + fee + insurance),
    currency: 'XOF',
    distanceMeters: Math.round(distanceMeters),
    etaSeconds,
    trafficLevel: traffic.level,
    breakdown: {
      base: Math.round(base), distance: Math.round(distance), time: Math.round(time), surge,
      traffic: Math.round(trafficCost), discount: 0, subtotal: Math.round(subtotal),
      tva: Math.round(tva), fee: Math.round(fee), insurance: Math.round(insurance),
    },
  };
}

/** Aperçu synchrone du prix (pour afficher la liste des niveaux sans latence). */
export function previewQuote(origin: LatLng, destination: LatLng, tier: TierOption, opts: EstimateOpts = {}): Quote {
  return localEstimate(origin, destination, tier, opts);
}

export async function estimate(origin: LatLng, destination: LatLng, tier: TierOption, opts: EstimateOpts = {}): Promise<Quote> {
  const remote = await tryFetch<{ quote: Quote }>('/pricing/estimate', {
    method: 'POST',
    body: JSON.stringify({ origin, destination, category: tier.id, bodyType: opts.bodyType, stops: opts.stops, insurance: opts.insurance }),
  });
  if (remote?.quote) return remote.quote;
  return localEstimate(origin, destination, tier, opts);
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

export interface RideCreated {
  id: string;
  status: string;
  driverId?: string;
}

export interface TrustedContact {
  name: string;
  phone: string;
}

/** Crée une course côté backend (idempotent). Renvoie null si backend indisponible. */
export async function createRide(lockId: string, clientId: string, trustedContact?: TrustedContact): Promise<RideCreated | null> {
  const res = await tryFetch<{ ride: RideCreated }>('/rides', {
    method: 'POST',
    headers: { 'idempotency-key': `${clientId}-${lockId}` },
    body: JSON.stringify({ clientId, lockId, trustedContact }),
  });
  return res?.ride ?? null;
}

/** URL WebSocket de suivi d'une course (null si pas de backend configuré). */
export function rideSocketUrl(rideId: string): string | null {
  if (!API) return null;
  try {
    const u = new URL(API);
    const proto = u.protocol === 'https:' ? 'wss:' : 'ws:';
    return `${proto}//${u.host}/ws/rides/${rideId}`;
  } catch {
    return null;
  }
}
