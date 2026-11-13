import type {
  LatLng, PrestigeVehicle, Quote, RentalAvailability, RentalDuree, RentalFormula, RentalOptions,
  RentalQuote, RentalReservation, SubCoverage, SubInvoice, SubPlanInfo, SubState, TierOption,
} from './types';
import {
  PRESTIGE_FALLBACK, RENTAL_COEF, RENTAL_DUREES, RENTAL_FORMULES, RENTAL_JOURS,
  RENTAL_OPTION_KEYS, RENTAL_TARIFF,
} from './data';

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
    // La session du client accompagne chaque appel : les routes qui touchent à ses
    // données (portefeuille, courses, messages) la vérifient côté serveur.
    const jeton = (() => { try { return localStorage.getItem('orion.clientSession'); } catch { return null; } })();
    const res = await fetch(`${API}${path}`, {
      ...init,
      headers: { 'content-type': 'application/json', ...(jeton ? { authorization: `Bearer ${jeton}` } : {}), ...(init?.headers ?? {}) },
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
  return (await estimateWithCoverage(origin, destination, tier, opts)).quote;
}

/**
 * Devis + ce que l'ABONNEMENT ORION couvrirait sur cette course.
 *
 * La couverture est un APERÇU : le serveur ne débite aucun quota ici (il le fait à la
 * commande). Comparer les gammes ne coûte donc aucune course incluse.
 */
export async function estimateWithCoverage(
  origin: LatLng, destination: LatLng, tier: TierOption, opts: EstimateOpts = {},
): Promise<{ quote: Quote; coverage: SubCoverage | null }> {
  const remote = await tryFetch<{ quote: Quote; abonnement: SubCoverage | null }>('/pricing/estimate', {
    method: 'POST',
    // clientId : le serveur ne compte qu'UNE demande par personne pour le surge —
    // sans lui, comparer les gammes ferait monter son propre prix. Il sert aussi à
    // calculer la couverture d'abonnement.
    body: JSON.stringify({ origin, destination, category: tier.id, bodyType: opts.bodyType, stops: opts.stops, insurance: opts.insurance, promoCode: opts.promoCode, clientId: clientId() }),
  });
  if (remote?.quote) return { quote: remote.quote, coverage: remote.abonnement ?? null };
  // Mode démo : pas de backend, donc pas d'abonnement à faire valoir.
  return { quote: localEstimate(origin, destination, tier, opts), coverage: null };
}

/**
 * Enregistre la fiche du client après vérification de son numéro.
 *
 * Le nom et le téléphone saisis à l'inscription restaient dans le navigateur : la
 * console affichait « client-8842 » sans aucun moyen de rappeler. Un support qui ne
 * peut pas joindre le client n'est pas un support.
 */
export async function registerClientProfile(name: string, phone: string): Promise<void> {
  await tryFetch('/clients/profile', {
    method: 'POST',
    body: JSON.stringify({ clientId: clientId(), name: name.trim() || undefined, phone: phone.trim() || undefined }),
  });
}

/* ============================== COMPTE CLIENT ============================== */
/**
 * Le compte est rattaché à un numéro VÉRIFIÉ par code SMS ; le serveur renvoie
 * alors une session signée, conservée sur l'appareil. Profil, photo et historique
 * ne s'ouvrent qu'avec elle.
 */
export interface ProfilClient {
  id: string; name: string | null; phone: string | null; email: string | null; photo: string | null;
  phoneVerifiedAt: string | null; createdAt: string;
  stats: { courses: number; commandes?: number; annulations: number; avertissements: number; pointsCarbone: number; co2EconomiseKg: number };
}

const SESSION_KEY = 'orion.clientSession';
const PROFIL_KEY = 'orion.profile';

export function sessionClient(): string | null {
  try { return localStorage.getItem(SESSION_KEY); } catch { return null; }
}
export function profilEnCache(): ProfilClient | null {
  try { return JSON.parse(localStorage.getItem(PROFIL_KEY) || 'null') as ProfilClient | null; } catch { return null; }
}
function memoriserProfil(p: ProfilClient | null): void {
  try { if (p) localStorage.setItem(PROFIL_KEY, JSON.stringify(p)); else localStorage.removeItem(PROFIL_KEY); } catch { /* ignore */ }
}

/**
 * Le message lisible d'une erreur serveur. Le serveur répond `{ error: { code, message } }`
 * (ou `{ error: "texte" }` sur quelques routes) : afficher l'objet brut donnait
 * « [object Object] » à la place de « Code incorrect ».
 */
export function messageErreur(json: Record<string, unknown>, status: number): string {
  const e = json.error;
  if (e && typeof e === 'object' && typeof (e as { message?: unknown }).message === 'string') return (e as { message: string }).message;
  if (typeof e === 'string') return e;
  if (typeof json.message === 'string') return json.message;
  return status === 429 ? 'Trop de tentatives : patientez un instant.' : `Erreur ${status}`;
}

/** Appel avec retour d'erreur lisible (le message du serveur), au lieu d'un simple échec muet. */
async function appel<T>(path: string, init: RequestInit = {}, timeoutMs = 8000): Promise<{ ok: true; data: T } | { ok: false; error: string; status: number }> {
  if (!API) return { ok: false, error: 'Mode démonstration : aucun serveur connecté.', status: 0 };
  const jeton = sessionClient();
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    const res = await fetch(`${API}${path}`, {
      ...init,
      headers: { ...(init.body ? { 'content-type': 'application/json' } : {}), ...(jeton ? { authorization: `Bearer ${jeton}` } : {}), ...(init.headers ?? {}) },
      signal: ctrl.signal,
    });
    clearTimeout(timer);
    const txt = await res.text();
    const json = txt ? JSON.parse(txt) as Record<string, unknown> : {};
    if (!res.ok) return { ok: false, error: messageErreur(json, res.status), status: res.status };
    return { ok: true, data: json as T };
  } catch {
    return { ok: false, error: 'Connexion impossible. Vérifiez votre réseau et réessayez.', status: 0 };
  }
}

export async function demanderCode(phone: string): Promise<{ ok: true; devCode?: string; compteExistant: boolean } | { ok: false; error: string }> {
  const r = await appel<{ devCode?: string; compteExistant: boolean }>('/clients/auth/otp', { method: 'POST', body: JSON.stringify({ phone }) });
  return r.ok ? { ok: true, devCode: r.data.devCode, compteExistant: r.data.compteExistant } : { ok: false, error: r.error };
}

/** Vérifie le code ; en cas de succès, l'appareil adopte le compte (et sa session). */
export async function verifierCode(phone: string, code: string, name?: string, email?: string): Promise<{ ok: true; client: ProfilClient; compteRetrouve: boolean } | { ok: false; error: string }> {
  const r = await appel<{ token: string; client: ProfilClient; compteRetrouve: boolean }>('/clients/auth/verify', {
    method: 'POST', body: JSON.stringify({ clientId: clientId(), phone, code, name: name?.trim() || undefined, email: email?.trim() || undefined }),
  });
  if (!r.ok) return { ok: false, error: r.error };
  try {
    localStorage.setItem(SESSION_KEY, r.data.token);
    localStorage.setItem('orion.clientId', r.data.client.id);
  } catch { /* ignore */ }
  memoriserProfil(r.data.client);
  return { ok: true, client: r.data.client, compteRetrouve: r.data.compteRetrouve };
}

export async function chargerProfil(): Promise<ProfilClient | null> {
  const r = await appel<{ client: ProfilClient }>(`/clients/${clientId()}/profile`);
  if (r.ok) { memoriserProfil(r.data.client); return r.data.client; }
  return profilEnCache();
}

export async function modifierProfil(patch: { name?: string; email?: string }): Promise<{ ok: true; client: ProfilClient } | { ok: false; error: string }> {
  const r = await appel<{ client: ProfilClient }>(`/clients/${clientId()}/profile`, { method: 'PUT', body: JSON.stringify(patch) });
  if (!r.ok) return r;
  memoriserProfil(r.data.client);
  return { ok: true, client: r.data.client };
}

export async function envoyerPhoto(dataUrl: string): Promise<{ ok: true; client: ProfilClient } | { ok: false; error: string }> {
  const r = await appel<{ client: ProfilClient }>(`/clients/${clientId()}/photo`, { method: 'PUT', body: JSON.stringify({ photo: dataUrl }) }, 20000);
  if (!r.ok) return r;
  memoriserProfil(r.data.client);
  return { ok: true, client: r.data.client };
}

export async function retirerPhoto(): Promise<{ ok: true; client: ProfilClient } | { ok: false; error: string }> {
  const r = await appel<{ client: ProfilClient }>(`/clients/${clientId()}/photo`, { method: 'DELETE' });
  if (!r.ok) return r;
  memoriserProfil(r.data.client);
  return { ok: true, client: r.data.client };
}

/**
 * Déconnexion : la session et le profil quittent l'appareil, ET l'identifiant
 * d'appareil est renouvelé — la personne suivante ne doit pas hériter du compte.
 */
export function seDeconnecter(): void {
  try {
    localStorage.removeItem(SESSION_KEY);
    localStorage.removeItem(PROFIL_KEY);
    localStorage.removeItem('orion.clientId');
    localStorage.removeItem('orion.sos');
  } catch { /* ignore */ }
}

export async function supprimerCompte(): Promise<{ ok: true } | { ok: false; error: string }> {
  const r = await appel<{ supprime: boolean }>(`/clients/${clientId()}`, { method: 'DELETE' });
  if (!r.ok) return r;
  seDeconnecter();
  return { ok: true };
}

export interface CourseHistorique {
  id: string; createdAt: string; status: string; statutLabel: string;
  depart: string; arrivee: string; distanceKm: number; montant: number; categorie: string;
  breakdown: Quote['breakdown'];
  paiement: { moyen: string | null; regle: boolean; montant: number | null };
  chauffeur: { name: string; matricule: string; vehicule: string | null; plaque: string | null } | null;
  note: number | null;
  annulation: { par: string; motif: string | null; details: string | null; frais: number; at: string } | null;
  sos: Array<{ id: string; at: string; status: string }>;
}
export interface Historique {
  courses: CourseHistorique[];
  resume: { total: number; terminees: number; annulees: number; depense: number; fraisAnnulation: number; alertesSos: number };
}
export async function chargerHistorique(): Promise<Historique | null> {
  const r = await appel<Historique>(`/clients/${clientId()}/history`);
  return r.ok ? r.data : null;
}
export async function mesAlertesSos(): Promise<SosSuivi[] | null> {
  const r = await appel<{ alertes: SosSuivi[] }>(`/clients/${clientId()}/sos`);
  return r.ok ? r.data.alertes : null;
}

/* ------------------------------ Annulation ------------------------------ */
export const MOTIFS_ANNULATION = [
  'attente_longue', 'chauffeur_immobile', 'changement_plan', 'erreur_adresse',
  'autre_transport', 'chauffeur_demande', 'securite', 'autre',
] as const;
export type MotifAnnulation = typeof MOTIFS_ANNULATION[number];
export interface FraisAnnulation { montant: number; delaiGraceMinutes: number; ecouleMinutes: number; raisonGratuite: string | null }

export async function apercuAnnulation(rideId: string, motif?: MotifAnnulation): Promise<{ annulable: boolean; frais: FraisAnnulation } | null> {
  const q = new URLSearchParams({ clientId: clientId(), ...(motif ? { motif } : {}) });
  const r = await appel<{ annulable: boolean; frais: FraisAnnulation }>(`/rides/${rideId}/cancel-preview?${q.toString()}`);
  return r.ok ? r.data : null;
}
export async function annulerCourse(rideId: string, motif: MotifAnnulation, details?: string): Promise<{ ok: true; frais: FraisAnnulation } | { ok: false; error: string }> {
  const r = await appel<{ frais: FraisAnnulation }>(`/rides/${rideId}/cancel`, { method: 'POST', body: JSON.stringify({ clientId: clientId(), motif, details: details?.trim() || undefined }) });
  return r.ok ? { ok: true, frais: r.data.frais } : r;
}

/** Numéros de secours en Côte d'Ivoire, à composer si l'alerte ne part pas. */
export const EMERGENCY_NUMBERS = { samu: '185', police: '170', pompiers: '180' } as const;

/**
 * Ce que le passager voit de SON alerte, en direct : qui l'a prise en charge, les
 * messages de l'agent, les secours RÉELLEMENT prévenus (et l'issue de l'appel).
 */
export interface SosSuivi {
  id: string;
  kind: string;
  status: 'raised' | 'dispatched' | 'acknowledged' | 'resolved' | 'cancelled';
  createdAt: string;
  location: LatLng;
  zoneName?: string;
  priseEnCharge: { agent: string; at: string } | null;
  chat: Array<{ from: 'agent' | 'usager'; author?: string; text: string; at: string }>;
  secours: Array<{ service: string; numero: string; canal: 'appel' | 'sms' | 'whatsapp'; at: string; issue: 'tentative' | 'joint' | 'non_joint' | 'messagerie' }>;
  clotureeA: string | null;
}

export interface SosResult {
  /** true UNIQUEMENT si ORION a bien reçu l'alerte. Jamais optimiste. */
  delivered: boolean;
  /** Suivi en direct de l'alerte (absent si l'envoi a échoué). */
  suivi?: SosSuivi;
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
    const remote = await tryFetch<{ alert: unknown; suivi?: SosSuivi }>('/safety/sos', { method: 'POST', body }, 8000);
    if (remote) return { delivered: true, alert: remote.alert, suivi: remote.suivi };
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
  /** Véhicule du conducteur (ex. « Scooter électrique » pour un coursier). */
  vehicleModel?: string | null;
}

export interface RideCreateResult {
  ride: RideCreated;
  driver: SafeDriver | null;
  /** Code de prise en charge à donner au chauffeur (course de passager uniquement). */
  code: string | null;
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
  const res = await tryFetch<{ ride: RideCreated; driver: SafeDriver | null; codePriseEnCharge?: string | null }>('/rides', {
    method: 'POST',
    headers: { 'idempotency-key': `${cid}-${lockId}` },
    body: JSON.stringify({ clientId: cid, lockId, trustedContact, paymentMethod }),
  });
  if (res?.ride?.id && res.codePriseEnCharge) {
    try { localStorage.setItem(`orion.code.${res.ride.id}`, res.codePriseEnCharge); } catch { /* stockage indisponible */ }
  }
  return res ? { ride: res.ride, driver: res.driver ?? null, code: res.codePriseEnCharge ?? null } : null;
}

/**
 * Code de prise en charge d'une course en cours : mémorisé à la commande, sinon relu
 * auprès du serveur (session du passager). Null si la course n'en a pas.
 */
/**
 * Bouton « Appeler » : numéro de l'autre participant de la course (le chauffeur pour le
 * passager), donné par le serveur aux seuls participants et pendant la course seulement.
 */
export async function contactCourse(rideId: string): Promise<{ nom: string; telephone: string; lien: string } | null> {
  return tryFetch<{ nom: string; telephone: string; lien: string }>(`/rides/${rideId}/contact`);
}

export async function lireCodePriseEnCharge(rideId: string): Promise<{ code: string; verifie: boolean } | null> {
  const r = await tryFetch<{ code: string; verifie: boolean }>(`/rides/${rideId}/code`);
  if (r) return r;
  try {
    const local = localStorage.getItem(`orion.code.${rideId}`);
    return local ? { code: local, verifie: false } : null;
  } catch { return null; }
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

/** Suivi temps réel d'une alerte SOS par la personne qui l'a déclenchée. */
export function sosSocketUrl(alertId: string, userId: string): string | null {
  return wsUrl(`/ws/sos/${alertId}?userId=${encodeURIComponent(userId)}`);
}

/** État courant de son alerte (reprise après fermeture de l'app, réseau revenu). */
export async function sosSuivi(alertId: string, userId: string): Promise<SosSuivi | null> {
  const r = await tryFetch<{ suivi: SosSuivi }>(`/safety/sos/${alertId}?userId=${encodeURIComponent(userId)}`, undefined, 6000);
  return r?.suivi ?? null;
}

/** « Prise en charge par Céline » — ou par la supervision quand l'agent n'est pas nommé. */
export const AGENT_GENERIQUE = 'Supervision ORION';

/** Réponse discrète du passager à l'agent ORION. */
export async function sosRepondre(alertId: string, userId: string, text: string): Promise<SosSuivi | null> {
  const r = await tryFetch<{ suivi: SosSuivi }>(`/safety/sos/${alertId}/message`, { method: 'POST', body: JSON.stringify({ userId, text }) }, 8000);
  return r?.suivi ?? null;
}

/**
 * URL WebSocket de la config publique temps réel. L'app cliente s'y abonne pour recevoir
 * instantanément les changements pilotés depuis la console (maintenance, services,
 * passerelles de paiement) sans avoir à redémarrer. Null en mode démo (pas de backend).
 */
export function configSocketUrl(): string | null {
  return wsUrl('/ws/config');
}

/* =============================== LOCATION ORION ===============================
 *
 * Le backend fait foi : barème, disponibilité réelle de la flotte et délai de mise à
 * disposition viennent de /rental/*. En mode démo (aucun backend joignable), on
 * recalcule localement avec le MÊME barème pour que l'écran reste utilisable — mais
 * la disponibilité annoncée est alors celle du catalogue, pas celle du terrain.
 */

export interface RentalCatalogue {
  vehicles: PrestigeVehicle[];
  formules: Array<{ id: RentalFormula; label: string }>;
  durees: Array<{ id: RentalDuree; label: string; coef: number | null; jours: number | null }>;
  options: Array<{ id: string; label: string }>;
  bareme: typeof RENTAL_TARIFF;
  currency: string;
  /** Vrai si le barème vient du serveur (et non du repli démo). */
  live: boolean;
}

/**
 * Changement de barème diffusé par la console. L'écran de location s'y abonne pour
 * rafraîchir ses prix sans que le client ait à rouvrir l'application : un tarif ajusté
 * par l'équipe commerciale doit être visible tout de suite.
 */
const abonnesTarif = new Set<() => void>();
export function onRentalTariffChange(fn: () => void): () => void {
  abonnesTarif.add(fn);
  return () => abonnesTarif.delete(fn);
}
export function notifyRentalTariffChange(): void {
  for (const fn of abonnesTarif) { try { fn(); } catch { /* un abonné fautif n'en bloque pas d'autres */ } }
}

export async function fetchRentalCatalogue(): Promise<RentalCatalogue> {
  const r = await tryFetch<Omit<RentalCatalogue, 'live'>>('/rental/catalogue');
  if (r?.vehicles?.length) return { ...r, live: true };
  return {
    vehicles: PRESTIGE_FALLBACK,
    formules: RENTAL_FORMULES.map((id) => ({ id, label: id })),
    durees: RENTAL_DUREES.map((id) => ({ id, label: id, coef: RENTAL_COEF[id] ?? null, jours: RENTAL_JOURS[id] ?? null })),
    options: RENTAL_OPTION_KEYS.map((id) => ({ id, label: id })),
    bareme: RENTAL_TARIFF,
    currency: 'XOF',
    live: false,
  };
}

/** Fin de la période d'immobilisation (même règle que le serveur). */
function rentalFin(debut: Date, duree: RentalDuree, heures?: number): Date {
  if (duree === 'heures') return new Date(debut.getTime() + (heures ?? RENTAL_TARIFF.minHeures) * 3_600_000);
  return new Date(debut.getTime() + (RENTAL_JOURS[duree] ?? 1) * 86_400_000);
}

const memeJour = (a: Date, b: Date) => a.toISOString().slice(0, 10) === b.toISOString().slice(0, 10);

export async function fetchRentalAvailability(debut: Date, duree: RentalDuree, heures?: number): Promise<RentalAvailability[]> {
  const q = new URLSearchParams({ debut: debut.toISOString(), duree });
  if (heures) q.set('heures', String(heures));
  const r = await tryFetch<{ disponibilites: RentalAvailability[] }>(`/rental/disponibilites?${q.toString()}`);
  if (r?.disponibilites) return r.disponibilites;
  // Repli démo : la flotte du catalogue, entièrement libre.
  return PRESTIGE_FALLBACK.map((v) => ({
    vehicleId: v.id, total: v.exemplaires, reserves: 0, restants: v.exemplaires, disponible: true,
    delaiMinutes: memeJour(debut, new Date()) ? 25 : 0,
  }));
}

export interface RentalQuoteInput {
  formula: RentalFormula;
  vehicleId: string;
  debut: Date;
  duree: RentalDuree;
  heures?: number;
  options?: RentalOptions;
  userId?: string;
}

/** Devis local (mode démo) — reproduit fidèlement le calcul du serveur. */
export function previewRental(input: RentalQuoteInput, vehicles: PrestigeVehicle[], tvaRate = 0.05, remise = 0): RentalQuote {
  const v = vehicles.find((x) => x.id === input.vehicleId) ?? vehicles[0]!;
  const T = RENTAL_TARIFF;
  const heures = input.duree === 'heures' ? Math.max(T.minHeures, Math.min(T.maxHeures, input.heures ?? T.minHeures)) : undefined;
  const coef = input.duree === 'heures' ? Math.min(heures! * T.ratioHeure, 1) : (RENTAL_COEF[input.duree] ?? 1);
  const jours = input.duree === 'heures' ? heures! / T.heuresParJournee : (RENTAL_JOURS[input.duree] ?? 1);
  const joursFactures = Math.max(1, Math.ceil(jours));
  const secondChauffeurRequis = (input.duree === 'heures' ? heures! : T.heuresParJournee) > T.heuresParJournee;

  const o: Required<RentalOptions> = {
    decoration: input.options?.decoration ?? false,
    tapisRouge: input.options?.tapisRouge ?? false,
    cortege: Math.max(0, Math.min(10, input.options?.cortege ?? 0)),
    hotesses: Math.max(0, Math.min(10, input.options?.hotesses ?? 0)),
    escorte: input.options?.escorte ?? false,
    plaque: input.options?.plaque ?? false,
    kilometrageIllimite: input.options?.kilometrageIllimite ?? false,
    secondChauffeur: secondChauffeurRequis || (input.options?.secondChauffeur ?? false),
    rafraichissements: input.options?.rafraichissements ?? false,
  };

  const vehicule = Math.round(v.prixJour * coef);
  const kilometrageIllimite = o.kilometrageIllimite ? Math.round(vehicule * T.majorationKmIllimite) : 0;
  const cortege = o.cortege * Math.round(v.prixJour * coef * (1 - T.remiseCortege));
  const options =
    (o.decoration ? T.decoration : 0) + (o.tapisRouge ? T.tapisRouge : 0) +
    o.hotesses * T.hotesse * joursFactures + (o.escorte ? T.escorte : 0) +
    (o.plaque ? T.plaque : 0) + (o.secondChauffeur ? T.secondChauffeur : 0) +
    (o.rafraichissements ? T.rafraichissements : 0);

  const sousTotal = vehicule + kilometrageIllimite + cortege + options;
  const jourJ = memeJour(input.debut, new Date());
  const majorationJourJ = jourJ ? Math.round(sousTotal * T.majorationJourJ) : 0;
  const remiseAbonnement = Math.round((sousTotal + majorationJourJ) * Math.max(0, Math.min(0.3, remise)));
  const ht = sousTotal + majorationJourJ - remiseAbonnement;
  const tva = Math.round(ht * tvaRate);
  const fin = rentalFin(input.debut, input.duree, heures);

  return {
    formula: input.formula, vehicleId: v.id,
    vehicle: { id: v.id, name: v.name, marque: v.marque, classe: v.classe, places: v.places, prixJour: v.prixJour, autonomieKm: v.autonomieKm },
    debut: input.debut.toISOString(), fin: fin.toISOString(), duree: input.duree, heures,
    heuresService: input.duree === 'heures' ? heures! : (RENTAL_JOURS[input.duree] ?? 1) * T.heuresParJournee,
    jours, options: o, secondChauffeurRequis,
    kmInclus: o.kilometrageIllimite ? null : T.kmInclusParJour * joursFactures,
    prixKmSupp: T.prixKmSupp,
    breakdown: { vehicule, kilometrageIllimite, cortege, options, majorationJourJ, remiseAbonnement, ht, tva },
    total: ht + tva, caution: Math.round(ht * T.tauxCaution), jourJ,
    disponibilite: { vehicleId: v.id, total: v.exemplaires, reserves: 0, restants: v.exemplaires, disponible: true, delaiMinutes: jourJ ? 25 : 0 },
    currency: 'XOF',
  };
}

/** Devis serveur ; bascule sur le calcul local si le backend ne répond pas. */
export async function quoteRental(input: RentalQuoteInput, vehicles: PrestigeVehicle[]): Promise<RentalQuote> {
  const r = await tryFetch<{ quote: RentalQuote }>('/rental/quote', {
    method: 'POST',
    body: JSON.stringify({
      formula: input.formula, vehicleId: input.vehicleId, debut: input.debut.toISOString(),
      duree: input.duree, heures: input.heures, options: input.options, userId: input.userId,
    }),
  });
  return r?.quote ?? previewRental(input, vehicles);
}

export interface RentalReserveInput extends RentalQuoteInput {
  userId: string;
  lieu?: string;
  contact?: { nom: string; telephone: string; email?: string };
  societe?: { nom: string; bonCommande?: string; contribuable?: string };
}

/** Réservation ferme. `null` = backend injoignable (rien n'a été réservé). */
export async function reserveRental(input: RentalReserveInput): Promise<RentalReservation | null> {
  const r = await tryFetch<{ reservation: RentalReservation }>('/rental/reserve', {
    method: 'POST',
    body: JSON.stringify({
      formula: input.formula, vehicleId: input.vehicleId, debut: input.debut.toISOString(),
      duree: input.duree, heures: input.heures, options: input.options,
      userId: input.userId, lieu: input.lieu, contact: input.contact, societe: input.societe,
    }),
  }, 5000);
  return r?.reservation ?? null;
}

export async function listMyRentals(userId: string): Promise<RentalReservation[] | null> {
  const r = await tryFetch<{ reservations: RentalReservation[] }>(`/rental/mes-locations/${encodeURIComponent(userId)}`);
  return r?.reservations ?? null;
}

export async function cancelRental(id: string, raison?: string): Promise<{ frais: number; message: string } | null> {
  const r = await tryFetch<{ frais: number; message: string }>(`/rental/reservation/${encodeURIComponent(id)}/annuler`, {
    method: 'POST', body: JSON.stringify({ raison }),
  }, 5000);
  return r ?? null;
}

/* ============================== ABONNEMENT ORION ============================== */

/** Catalogue des forfaits tel que le SERVEUR le définit (plafonds, niveaux, remises). */
export async function fetchSubPlans(): Promise<SubPlanInfo[] | null> {
  const r = await tryFetch<{ plans: SubPlanInfo[] }>('/subscriptions/plans');
  return r?.plans ?? null;
}

export async function fetchSubscription(userId: string): Promise<SubState | null> {
  return tryFetch<SubState>(`/subscriptions/${encodeURIComponent(userId)}`);
}

/** Souscription réelle (facture émise côté serveur). `null` = backend injoignable. */
export async function subscribePlan(userId: string, plan: string, paymentMethod?: string): Promise<SubState | null> {
  const r = await tryFetch<{ subscription: unknown }>('/subscriptions', {
    method: 'POST', body: JSON.stringify({ userId, plan, paymentMethod }),
  }, 5000);
  if (!r) return null;
  return fetchSubscription(userId);
}

export async function cancelSubscription(userId: string, raison?: string): Promise<boolean> {
  const r = await tryFetch<{ subscription: unknown }>(`/subscriptions/${encodeURIComponent(userId)}/cancel`, {
    method: 'POST', body: JSON.stringify({ raison }),
  }, 5000);
  return Boolean(r);
}

/** Règlement de la facture d'abonnement via mobile money / carte. */
export async function paySubscriptionInvoice(invoiceId: string, method: string, phone?: string): Promise<SubInvoice | null> {
  const r = await tryFetch<{ facture: SubInvoice }>(`/subscriptions/factures/${encodeURIComponent(invoiceId)}/payer`, {
    method: 'POST', body: JSON.stringify({ method, phone }),
  }, 6000);
  return r?.facture ?? null;
}


/* ------------------------------ Itinéraire routier ------------------------------ */

export interface ItineraireRoute {
  geometrie: LatLng[];
  distanceMeters: number;
  durationSeconds: number;
  ponts: string[];
  provider: 'osrm' | 'repli';
}

const cacheItineraires = new Map<string, Promise<ItineraireRoute | null>>();

/**
 * Itinéraire sur les vraies routes (ponts, échangeurs, sens de circulation). Passe par le
 * serveur ORION ; en démonstration sans serveur, interroge directement le calcul OSRM.
 * Renvoie null hors-ligne : la carte trace alors un repli.
 */
export function itineraire(points: LatLng[]): Promise<ItineraireRoute | null> {
  const cle = points.map((p) => `${p.lat.toFixed(5)},${p.lng.toFixed(5)}`).join(';');
  const deja = cacheItineraires.get(cle);
  if (deja) return deja;
  const p = (async (): Promise<ItineraireRoute | null> => {
    if (API) {
      const r = await tryFetch<{ itineraire: ItineraireRoute }>('/maps/itineraire', { method: 'POST', body: JSON.stringify({ points }) }, 8000);
      if (r?.itineraire) return r.itineraire;
    }
    try {
      const coords = points.map((q) => `${q.lng.toFixed(6)},${q.lat.toFixed(6)}`).join(';');
      const res = await fetch(`https://router.project-osrm.org/route/v1/driving/${coords}?overview=full&geometries=geojson&steps=true`, { signal: AbortSignal.timeout(8000) });
      const j = await res.json() as { code: string; routes?: Array<{ distance: number; duration: number; geometry: { coordinates: [number, number][] }; legs: Array<{ steps: Array<{ name: string }> }> }> };
      const route = j.routes?.[0];
      if (j.code !== 'Ok' || !route) return null;
      const ponts = [...new Set(route.legs.flatMap((l) => l.steps.map((st) => st.name)).filter((n) => /^pont\b/i.test(n)))];
      return {
        geometrie: route.geometry.coordinates.map(([lng, lat]) => ({ lat, lng })),
        distanceMeters: Math.round(route.distance), durationSeconds: Math.round(route.duration), ponts, provider: 'osrm',
      };
    } catch {
      return null;
    }
  })();
  cacheItineraires.set(cle, p);
  void p.then((r) => { if (!r) cacheItineraires.delete(cle); });
  return p;
}

/* ------------------------------ ORION Assurance ------------------------------ */

export const ANTECEDENTS = [
  'asthme', 'hypertension', 'diabete', 'drepanocytose', 'epilepsie',
  'cardiaque', 'renale', 'coagulation', 'grossesse', 'mobilite_reduite',
] as const;
export type Antecedent = typeof ANTECEDENTS[number];
export const GROUPES_SANGUINS = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-', 'inconnu'] as const;
export const CONSENTEMENT_ASSURANCE = '2026-11';

export interface FicheMedicale {
  identite: { nom: string; prenoms: string; dateNaissance: string; sexe?: 'F' | 'M' };
  piece: { type: 'cni' | 'passeport'; numero: string; expiration: string };
  cmu?: string;
  sante: {
    groupeSanguin: typeof GROUPES_SANGUINS[number];
    antecedents: Antecedent[];
    autresAntecedents?: string; allergies?: string; traitements?: string;
    anticoagulants: boolean; stimulateurCardiaque: boolean; reactionAllergiqueGrave: boolean;
  };
  urgence: { nom: string; lien: string; telephone: string };
  medecin?: { nom?: string; telephone?: string };
}
export interface StatutAssurance {
  disponible: boolean; inscrit: boolean; depuis: string | null; majLe: string | null;
  consultations: Array<{ le: string; par: string; alerteId: string }>;
}

const DEMO_ASSURANCE = 'orion.demo.assurance';

export async function statutAssurance(): Promise<StatutAssurance | null> {
  const id = clientId();
  if (!API) {
    // Démonstration sans serveur : rien de médical n'est conservé, seulement « inscrit ».
    const inscrit = (() => { try { return localStorage.getItem(DEMO_ASSURANCE) === '1'; } catch { return false; } })();
    return { disponible: true, inscrit, depuis: null, majLe: null, consultations: [] };
  }
  const r = await appel<{ statut: StatutAssurance }>(`/clients/${encodeURIComponent(id)}/assurance`);
  return r.ok ? r.data.statut : null;
}

export async function lireDossierAssurance(): Promise<{ fiche: FicheMedicale | null; statut: StatutAssurance } | string> {
  const r = await appel<{ fiche: FicheMedicale | null; statut: StatutAssurance }>(`/clients/${encodeURIComponent(clientId())}/assurance/dossier`);
  return r.ok ? r.data : r.error;
}

export async function enregistrerDossierAssurance(fiche: FicheMedicale): Promise<StatutAssurance | string> {
  if (!API) { try { localStorage.setItem(DEMO_ASSURANCE, '1'); } catch { /* ignore */ } return { disponible: true, inscrit: true, depuis: new Date().toISOString(), majLe: new Date().toISOString(), consultations: [] }; }
  const r = await appel<{ statut: StatutAssurance }>(`/clients/${encodeURIComponent(clientId())}/assurance/dossier`, {
    method: 'PUT', body: JSON.stringify({ fiche, consentement: { version: CONSENTEMENT_ASSURANCE, lu: true, accepte: true } }),
  });
  return r.ok ? r.data.statut : r.error;
}

export async function supprimerDossierAssurance(): Promise<StatutAssurance | string> {
  if (!API) { try { localStorage.removeItem(DEMO_ASSURANCE); } catch { /* ignore */ } return { disponible: true, inscrit: false, depuis: null, majLe: null, consultations: [] }; }
  const r = await appel<{ statut: StatutAssurance }>(`/clients/${encodeURIComponent(clientId())}/assurance/dossier`, { method: 'DELETE' });
  return r.ok ? r.data.statut : r.error;
}

/* ------------------------------ Messagerie ORION ------------------------------ */

export interface ReponseProposee { code: string; libelle: string; alerte?: boolean }
export interface MessageOrion {
  id: string; type: 'info' | 'consigne' | 'controle'; titre: string; texte: string; auteur: string; rideId?: string;
  reponses: ReponseProposee[]; reponse?: { code: string; libelle: string; le: string }; envoyeLe: string; luLe?: string;
  /** Contrôle de sécurité d'une course terminée : plus de réponse attendue. */
  clos?: boolean;
}

export async function listerMessages(): Promise<{ messages: MessageOrion[]; nonLus: number } | null> {
  if (!API) return null;
  return tryFetch<{ messages: MessageOrion[]; nonLus: number }>(`/clients/${encodeURIComponent(clientId())}/messages`);
}
export async function marquerMessageLu(id: string): Promise<number | null> {
  const r = await tryFetch<{ nonLus: number }>(`/clients/${encodeURIComponent(clientId())}/messages/${id}/lu`, { method: 'POST', body: '{}' });
  return r?.nonLus ?? null;
}
export async function repondreMessage(id: string, code: string): Promise<{ message: MessageOrion; alerteId: string | null } | null> {
  return tryFetch<{ message: MessageOrion; alerteId: string | null }>(`/clients/${encodeURIComponent(clientId())}/messages/${id}/reponse`, { method: 'POST', body: JSON.stringify({ code }) });
}
