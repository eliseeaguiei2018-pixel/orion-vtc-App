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
  /** Code promo saisi par le client (validé côté backend, remise appliquée au devis). */
  promoCode?: string;
}

const BODY = { berline: 1, suv: 1.08 } as const;

/** Détection de trafic locale (miroir du backend) selon l'heure. */
function localTraffic(): { level: 'fluid' | 'dense' | 'jam'; factor: number } {
  const h = new Date().getHours();
  if ((h >= 6 && h < 9) || (h >= 17 && h < 20)) return { level: 'jam', factor: 1.35 };
  if (h >= 9 && h < 17) return { level: 'dense', factor: 1.15 };
  return { level: 'fluid', factor: 1 };
}

/**
 * Estimation locale (miroir du backend). PRIX FIXE : le montant affiché = montant payé.
 * Trafic INTÉGRÉ au prix (adouci), jamais facturé à part. Tarifs abordables (< concurrence).
 */
const TRAFFIC_PRICE_WEIGHT = 0.6;
function localEstimate(origin: LatLng, destination: LatLng, tier: TierOption, opts: EstimateOpts = {}): Quote {
  const stops = opts.stops ?? [];
  const pts = [origin, ...stops, destination];
  let dist = 0;
  for (let i = 1; i < pts.length; i++) dist += haversine(pts[i - 1]!, pts[i]!);
  const distanceMeters = dist;
  const km = distanceMeters / 1000;
  const bodyF = BODY[opts.bodyType ?? 'berline'];
  const traffic = localTraffic();
  const m = tier.multiplier;
  const etaSeconds = Math.round((km / 24) * 3600 * traffic.factor);
  const minutes = (km / 24) * 60; // temps facturé à vitesse libre (trafic non surfacturé)
  const base = 300 * m * bodyF + stops.length * 250 * m;
  const distance = km * 130 * m * bodyF;
  const time = minutes * 18 * m * bodyF;
  const trafficMult = 1 + (traffic.factor - 1) * TRAFFIC_PRICE_WEIGHT;
  const subtotal = Math.max((base + distance + time) * trafficMult, 600 * m);
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
      base: Math.round(base), distance: Math.round(distance), time: Math.round(time), surge: 1,
      traffic: 0, discount: 0, subtotal: Math.round(subtotal),
      tva: Math.round(tva), fee: Math.round(fee), insurance: Math.round(insurance),
    },
  };
}

/** Aperçu synchrone du prix (pour afficher la liste des niveaux sans latence). */
export function previewQuote(origin: LatLng, destination: LatLng, tier: TierOption, opts: EstimateOpts = {}): Quote {
  return localEstimate(origin, destination, tier, opts);
}

/** Tailles de colis (livraison moto) et leur facteur de prix. Doit rester aligné sur
 *  PACKAGE_FACTOR du backend, sinon le prix affiché hors ligne diverge du prix payé. */
export const PKG_FACTOR = { petit: 1, moyen: 1.12, grand: 1.25 } as const;
export type PkgSize = keyof typeof PKG_FACTOR;

/**
 * Estimation d'une LIVRAISON à moto (coursier). Base plus faible qu'une course,
 * tarif au km + facteur taille de colis, TVA 5% + frais 10%.
 */
export function previewDelivery(origin: LatLng, destination: LatLng, size: PkgSize): Quote {
  const distanceMeters = haversine(origin, destination) * 1.3;
  const km = distanceMeters / 1000;
  const traffic = localTraffic();
  const f = PKG_FACTOR[size];
  const etaSeconds = Math.round((km / 26) * 3600 * traffic.factor); // moto plus rapide
  const minutes = (km / 26) * 60;
  // Barème coursier : aligné sur DELIVERY_TARIFF du backend (moins cher qu'une course
  // voiture — la moto coûte moins à exploiter et ne transporte pas de passager).
  const base = 220 * f;
  const distance = km * 88 * f;
  const time = minutes * 8 * f;
  const trafficMult = 1 + (traffic.factor - 1) * TRAFFIC_PRICE_WEIGHT;
  const subtotal = Math.max((base + distance + time) * trafficMult, 500);
  const tva = subtotal * 0.05;
  const fee = subtotal * 0.1;
  return {
    lockId: `delivery-${Date.now()}`,
    amount: round50(subtotal + tva + fee),
    currency: 'XOF',
    distanceMeters: Math.round(distanceMeters),
    etaSeconds,
    trafficLevel: traffic.level,
    breakdown: {
      base: Math.round(base), distance: Math.round(distance), time: Math.round(time), surge: 1,
      traffic: 0, discount: 0, subtotal: Math.round(subtotal),
      tva: Math.round(tva), fee: Math.round(fee), insurance: 0,
    },
  };
}

/**
 * Devis de LIVRAISON auprès du backend (service coursier). Renvoie null si le backend
 * est absent ou indisponible — l'appelant retombe alors sur `previewDelivery` (démo).
 * Le lockId renvoyé permet de créer une vraie livraison au prix affiché.
 */
export async function estimateDelivery(origin: LatLng, destination: LatLng, size: PkgSize, promoCode?: string): Promise<Quote | null> {
  const remote = await tryFetch<{ quote: Quote }>('/pricing/estimate', {
    method: 'POST',
    body: JSON.stringify({ serviceType: 'delivery', origin, destination, category: size, promoCode, clientId: clientId() }),
  });
  return remote?.quote ?? null;
}

export async function estimate(origin: LatLng, destination: LatLng, tier: TierOption, opts: EstimateOpts = {}): Promise<Quote> {
  const remote = await tryFetch<{ quote: Quote }>('/pricing/estimate', {
    method: 'POST',
    // clientId : le serveur ne compte qu'UNE demande par personne pour le surge —
    // sans lui, comparer les gammes ferait monter son propre prix.
    body: JSON.stringify({ origin, destination, category: tier.id, bodyType: opts.bodyType, stops: opts.stops, insurance: opts.insurance, promoCode: opts.promoCode, clientId: clientId() }),
  });
  if (remote?.quote) return remote.quote;
  return localEstimate(origin, destination, tier, opts);
}

/** Numéros de secours en Côte d'Ivoire, à composer si l'alerte ne part pas. */
export const EMERGENCY_NUMBERS = { samu: '185', police: '170', pompiers: '180' } as const;

export interface SosResult {
  /** true UNIQUEMENT si ORION a bien reçu l'alerte. Jamais optimiste. */
  delivered: boolean;
  alert?: unknown;
}

/**
 * Déclenche une alerte SOS. Fonction de SÉCURITÉ : elle ne ment jamais sur le résultat.
 *
 * Auparavant, tout échec (réseau, erreur serveur, délai dépassé) était masqué par une
 * fausse alerte locale « dispatched », et l'app annonçait au passager que le SAMU était
 * prévenu alors qu'aucune alerte n'était partie. En cas d'accident réel avec réseau
 * instable, la personne attendait des secours jamais appelés.
 *
 * Désormais : délai plus long qu'un appel ordinaire, deux réessais, et un résultat franc.
 * À l'appelant d'afficher les numéros d'urgence si `delivered` est faux.
 */
export async function sos(userId: string, location: LatLng, rideId?: string): Promise<SosResult> {
  if (!API) return { delivered: false }; // mode démo : aucune alerte réelle n'est envoyée
  const body = JSON.stringify({ userId, location, rideId });
  for (let essai = 0; essai < 3; essai++) {
    // 8 s : une urgence mérite plus de patience qu'un appel ordinaire (2,5 s).
    const remote = await tryFetch<{ alert: unknown }>('/safety/sos', { method: 'POST', body }, 8000);
    if (remote) return { delivered: true, alert: remote.alert };
    if (essai < 2) await new Promise((r) => setTimeout(r, 600 * (essai + 1)));
  }
  return { delivered: false };
}

export function isLiveBackend(): boolean {
  return Boolean(API);
}

/**
 * Configuration publique pilotée depuis la console Admin (centre de contrôle).
 * L'app cliente s'y synchronise : ville, ouverture (maintenance), services activés
 * et passerelles de paiement en service. `null` en mode démo (backend absent) →
 * l'app garde tous ses services et moyens de paiement par défaut.
 */
export interface AppConfig {
  city: string;
  open: boolean;
  services: Record<string, boolean>;
  gateways: Record<string, boolean>;
  currency: string;
}

export async function fetchAppConfig(): Promise<AppConfig | null> {
  const res = await tryFetch<Partial<AppConfig>>('/config');
  if (!res) return null;
  return {
    city: res.city ?? 'Abidjan',
    open: res.open ?? true,
    services: res.services ?? {},
    gateways: res.gateways ?? {},
    currency: res.currency ?? 'XOF',
  };
}

export interface RideCreated {
  id: string;
  status: string;
  driverId?: string;
}

/** Chauffeur assigné renvoyé par le backend (sous-ensemble sûr, sans données perso). */
export interface SafeDriver {
  name: string;
  matricule: string;
  ratingAvg: number;
  ratingCount: number;
}

export interface RideCreateResult {
  ride: RideCreated;
  driver: SafeDriver | null;
}

export interface TrustedContact {
  name: string;
  phone: string;
}

/**
 * Identité client stable, mémorisée sur l'appareil (à remplacer par l'identité
 * authentifiée — JWT — en production). Permet de rattacher les courses au bon client
 * et d'afficher l'historique personnel.
 */
export function clientId(): string {
  let id = localStorage.getItem('orion.clientId');
  if (!id) {
    id = 'client-' + Math.random().toString(36).slice(2, 10);
    localStorage.setItem('orion.clientId', id);
  }
  return id;
}

/**
 * Crée une course côté backend (idempotent). Renvoie null si backend indisponible.
 * `paymentMethod` (optionnel) : moyen annoncé, affiché au chauffeur ; « espèces » exclut
 * les chauffeurs au-delà du plafond de dette espèces fixé en console.
 */
export async function createRide(lockId: string, cid: string, trustedContact?: TrustedContact, paymentMethod?: string): Promise<RideCreateResult | null> {
  const res = await tryFetch<{ ride: RideCreated; driver: SafeDriver | null }>('/rides', {
    method: 'POST',
    headers: { 'idempotency-key': `${cid}-${lockId}` },
    body: JSON.stringify({ clientId: cid, lockId, trustedContact, paymentMethod }),
  });
  return res ? { ride: res.ride, driver: res.driver ?? null } : null;
}

/** Annule une course côté serveur (libère le chauffeur). No-op en mode démo. */
export async function cancelRide(rideId: string): Promise<void> {
  await tryFetch(`/rides/${rideId}/transition`, { method: 'POST', body: JSON.stringify({ to: 'cancelled' }) });
}

/** Enregistre la note de la course côté serveur (met à jour la note du chauffeur). */
export async function rateRide(rideId: string, stars: number): Promise<void> {
  await tryFetch(`/rides/${rideId}/rate`, { method: 'POST', body: JSON.stringify({ stars }) });
}

export interface RideHistoryItem {
  id: string;
  status: string;
  origin: LatLng;
  destination: LatLng;
  quote: Quote;
  createdAt: string;
}

/** Historique des courses du client (null si backend indisponible → repli démo). */
export async function listMyRides(cid: string): Promise<RideHistoryItem[] | null> {
  const res = await tryFetch<{ rides: RideHistoryItem[] }>(`/clients/${cid}/rides`);
  return res?.rides ?? null;
}

/* ------------------------------ Support / chat ------------------------------ */
export interface SupportMessage { id: string; from: 'client' | 'agent'; author?: string; text: string; at: string }
export interface SupportConversation { id: string; clientId: string; subject: string; status: string; messages: SupportMessage[]; createdAt: string; updatedAt: string }

/** Ouvre/poursuit une conversation support (le client écrit à ORION). */
export async function openSupport(cid: string, text: string, subject?: string): Promise<SupportConversation | null> {
  const res = await tryFetch<{ conversation: SupportConversation }>('/support/messages', {
    method: 'POST', body: JSON.stringify({ clientId: cid, text, subject }),
  });
  return res?.conversation ?? null;
}

/** Récupère les conversations support du client. */
export async function listSupport(cid: string): Promise<SupportConversation[] | null> {
  const res = await tryFetch<{ conversations: SupportConversation[] }>(`/clients/${cid}/support`);
  return res?.conversations ?? null;
}

export interface Announcement { id: string; title: string; body: string; at: string }
/** Annonces ORION à afficher au client (bannière). */
export async function listAnnouncements(): Promise<Announcement[]> {
  const res = await tryFetch<{ announcements: Announcement[] }>('/announcements');
  return res?.announcements ?? [];
}

/** Construit une URL WebSocket vers un chemin de l'API (null si pas de backend). */
function wsUrl(path: string): string | null {
  if (!API) return null;
  try {
    const u = new URL(API);
    const proto = u.protocol === 'https:' ? 'wss:' : 'ws:';
    return `${proto}//${u.host}${path}`;
  } catch {
    return null;
  }
}

/** URL WebSocket de suivi d'une course (null si pas de backend configuré). */
export function rideSocketUrl(rideId: string): string | null {
  return wsUrl(`/ws/rides/${rideId}`);
}

/**
 * URL WebSocket de la config publique temps réel. L'app cliente s'y abonne pour recevoir
 * instantanément les changements pilotés depuis la console (maintenance, services,
 * passerelles de paiement) sans avoir à redémarrer. Null en mode démo (pas de backend).
 */
export function configSocketUrl(): string | null {
  return wsUrl('/ws/config');
}
