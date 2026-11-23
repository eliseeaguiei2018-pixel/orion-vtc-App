import { TEMPS_REEL, approcheConnue, coutApproche, traficReel } from './tempsReel';
import type {
  LatLng, PrestigeVehicle, Quote, RentalAvailability, RentalDuree, RentalFormula, RentalOptions,
  RentalQuote, RentalReservation, SubCoverage, SubInvoice, SubPlanInfo, SubState, TierOption,
} from './types';
import {
  PRESTIGE_FALLBACK, RENTAL_COEF, RENTAL_DUREES, RENTAL_FORMULES, RENTAL_JOURS,
  RENTAL_MOIS_MAX, RENTAL_OPTION_KEYS, RENTAL_TARIFF, dureesPermises, remiseMensuelle,
} from './data';
import { repondreLocal, reserverLocationLocale } from './serveurLocal';
import { appliquerGrillePrix, BAREME, BAREME_LIVRAISON, prixCourse, prixLivraison, prixMiseADisposition, traficServeur, type GrillePrixServeur } from './tarifServeur';
import { baseTempsReel, confirmerCodeGoogle, enTeteRecaptcha, enTetesPasserelle, envoyerCodeGoogle, identiteGoogleActive } from './securiteGoogle';

/**
 * Client API ORION. Si VITE_API_URL est défini et joignable, on utilise le backend réel.
 * Sinon (mode démo), on calcule localement pour que l'app reste pleinement fonctionnelle
 * — utile pour les démonstrations et la revue de design sans infra.
 */
const API_CONSTRUCTION = (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/$/, '') ?? '';

/**
 * SERVEUR ORION CHOISI DANS L'APPLICATION (Paramètres → Serveur ORION).
 *
 * L'adresse du serveur n'est plus figée à la construction : la même application — le
 * même APK — fonctionne en autonomie, puis se relie à un serveur ORION le jour où il est
 * en ligne, sans réinstallation. Une chaîne vide enregistrée force le mode autonome.
 */
const CLE_SERVEUR = 'orion.serveur';
function serveurEnregistre(): string | null {
  try { return localStorage.getItem(CLE_SERVEUR); } catch { return null; }
}
const API = serveurEnregistre() ?? API_CONSTRUCTION;

export interface EtatServeur {
  /** Adresse du serveur auquel l'application est reliée ; vide en mode autonome. */
  url: string;
  /** D'où vient l'adresse : réglée dans l'app, fixée à la construction, ou aucune. */
  origine: 'application' | 'construction' | 'aucune';
}
export function etatServeur(): EtatServeur {
  const choisi = serveurEnregistre();
  return { url: API, origine: !API ? 'aucune' : choisi !== null ? 'application' : 'construction' };
}

/**
 * Met en forme une adresse saisie à la main (« orion.exemple.ci » → « https://orion.exemple.ci »).
 * `https` : la page est servie en https (c'est le cas dans l'app Android et iOS), un
 * serveur en http y serait bloqué par le système — sauf sur le téléphone lui-même.
 */
export function adresseServeur(saisie: string): { url: string } | { erreur: 'adresse' | 'https' } {
  const brut = saisie.trim().replace(/\/+$/, '');
  if (!brut) return { erreur: 'adresse' };
  let u: URL;
  try { u = new URL(/^https?:\/\//i.test(brut) ? brut : `https://${brut}`); } catch { return { erreur: 'adresse' }; }
  if (!u.hostname.includes('.') && u.hostname !== 'localhost') return { erreur: 'adresse' };
  const local = u.hostname === 'localhost' || u.hostname === '127.0.0.1';
  if (u.protocol === 'http:' && !local && typeof location !== 'undefined' && location.protocol === 'https:') return { erreur: 'https' };
  return { url: `${u.protocol}//${u.host}${u.pathname.replace(/\/+$/, '')}` };
}

/** Vérifie qu'un serveur ORION répond bien à cette adresse, avant de s'y relier. */
export async function testerServeur(url: string): Promise<{ ok: true; ville: string } | { ok: false; raison: 'injoignable' | 'pas_orion' }> {
  const lire = async (chemin: string): Promise<unknown> => {
    const ctrl = new AbortController();
    const fin = setTimeout(() => ctrl.abort(), 8000);
    try {
      const res = await fetch(`${url}${chemin}`, { signal: ctrl.signal });
      return res.ok ? await res.json() : null;
    } finally { clearTimeout(fin); }
  };
  try {
    // Un hébergement en veille met quelques secondes à se réveiller : deux essais.
    const pret = (await lire('/health/ready').catch(() => null)) ?? (await lire('/health/ready'));
    const config = await lire('/config') as { city?: string; services?: unknown } | null;
    if (!pret || !config || typeof config.services !== 'object') return { ok: false, raison: 'pas_orion' };
    return { ok: true, ville: config.city ?? 'Abidjan' };
  } catch {
    return { ok: false, raison: 'injoignable' };
  }
}

/**
 * Relie l'application à un serveur (ou la remet en autonomie avec `null`), puis la
 * redémarre. Le compte vit sur le serveur : changer de serveur ferme la session en cours.
 */
export function relierServeur(url: string | null): void {
  try {
    localStorage.setItem(CLE_SERVEUR, url ?? '');
    localStorage.removeItem(SESSION_KEY);
    localStorage.removeItem(PROFIL_KEY);
    localStorage.removeItem('orion.sos');
  } catch { /* stockage indisponible : le rechargement gardera l'ancien réglage */ }
  location.reload();
}

async function tryFetch<T>(path: string, init?: RequestInit, timeoutMs = 2500): Promise<T | null> {
  if (!API) {
    // Sans serveur : l'app répond elle-même (compte, SOS, assurance…) ; null = simulation.
    const r = repondreLocal(path, init);
    return r && r.status < 400 ? r.data as T : null;
  }
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    // La session du client accompagne chaque appel : les routes qui touchent à ses
    // données (portefeuille, courses, messages) la vérifient côté serveur.
    const jeton = (() => { try { return localStorage.getItem('orion.clientSession'); } catch { return null; } })();
    const res = await fetch(`${API}${path}`, {
      ...init,
      headers: { 'content-type': 'application/json', ...enTetesPasserelle(), ...(jeton ? { authorization: `Bearer ${jeton}` } : {}), ...(init?.headers ?? {}) },
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

export interface EstimateOpts {
  bodyType?: 'suv' | 'berline';
  stops?: LatLng[];
  insurance?: boolean;
  /** Code promo saisi par le client (validé côté backend, remise appliquée au devis). */
  promoCode?: string;
  /**
   * Itinéraire choisi (pont à péage ou voie normale) : sa distance par la route sert au prix,
   * et ses péages s'y ajoutent. Voir itinerairesPeage.ts.
   */
  itineraire?: { choix: 'peage' | 'normal'; distanceMeters: number; durationSeconds: number; peages: string[] };
  /** Mise à disposition à l'heure (Abidjan) : le chauffeur reste avec le client `heures` heures. */
  miseADisposition?: { heures: number; debut?: string };
}

/**
 * TRAJET PAR LA ROUTE — la base du prix.
 *
 * Une course se paie sur la distance réellement roulée (routes, ponts de la lagune, sens de
 * circulation), pas sur la distance à vol d'oiseau entre le départ et l'arrivée : à Abidjan
 * l'écart est souvent de moitié. Le trajet est celui que la carte trace (calcul routier
 * d'ORION, ou itinéraire de Google sur la carte Google) ; sa durée donne l'heure d'arrivée.
 * Le trafic compté dans le prix suit la règle du serveur (heure et zones), pas la mesure du moment.
 */
export interface TrajetTarif { distanceMeters: number; durationSeconds: number; fluideSeconds?: number }

/** Sans trajet calculé (hors connexion) : la route est estimée à 1,3 fois le vol d'oiseau, comme le fait le serveur. */
export const SINUOSITE = 1.3;

let trajetConnu: (points: LatLng[]) => TrajetTarif | null = () => null;
/** L'application indique où trouver le trajet déjà calculé pour une suite de points (voir tarifTrajet.ts). */
export function definirTrajetTarif(f: (points: LatLng[]) => TrajetTarif | null): void { trajetConnu = f; }

/**
 * Distance et durée servant au devis : le trajet par la route s'il est connu et plausible,
 * sinon l'estimation (1,3 fois le vol d'oiseau, durée à la vitesse du barème).
 * `facteurTrafic` n'allonge que la durée estimée ; un trajet calculé donne déjà sa durée réelle.
 */
function baseTarifaire(points: LatLng[], vitesseKmh: number, facteurTrafic: number, choisi?: TrajetTarif): { distanceMeters: number; etaSeconds: number } {
  let vol = 0;
  for (let i = 1; i < points.length; i++) vol += haversine(points[i - 1]!, points[i]!);
  const t = choisi ?? trajetConnu(points);
  // Garde-fou : un trajet plus court que la ligne droite, ou démesuré, n'est pas un trajet.
  const plausible = t && t.distanceMeters >= vol * 0.98 && t.distanceMeters <= vol * 6 + 3000;
  if (!t || !plausible) {
    const distanceMeters = vol * SINUOSITE;
    return { distanceMeters, etaSeconds: Math.round((distanceMeters / 1000 / vitesseKmh) * 3600 * facteurTrafic) };
  }
  return { distanceMeters: t.distanceMeters, etaSeconds: Math.max(60, Math.round(t.durationSeconds)) };
}

/**
 * Estimation locale : LE PRIX DU SERVEUR, calculé dans l'application (voir tarifServeur.ts).
 * Mêmes règles que le serveur avec ses réglages d'origine : barème, zone de départ, frais de
 * prise en charge, forfaits, retour à vide, plancher, trafic selon l'heure et les zones.
 * PRIX FIXE : le montant affiché est le montant payé. Seuls la majoration de forte demande,
 * les réglages modifiés depuis la console et les codes promo demandent un serveur relié.
 */
function localEstimate(origin: LatLng, destination: LatLng, tier: TierOption, opts: EstimateOpts = {}): Quote {
  // Mise à disposition à l'heure : le prix dépend des heures, pas du trajet.
  if (opts.miseADisposition) {
    const prix = prixMiseADisposition({ heures: opts.miseADisposition.heures, gamme: tier.id, insurance: opts.insurance });
    return {
      lockId: `local-${Date.now()}`, amount: prix.amount, currency: 'XOF', distanceMeters: 0,
      etaSeconds: Math.round((prix.breakdown.heures ?? opts.miseADisposition.heures) * 3600), trafficLevel: 'fluid', breakdown: prix.breakdown,
    };
  }
  const stops = opts.stops ?? [];
  const trafic = traficServeur(origin, destination);
  // Distance par la route (et non à vol d'oiseau) et durée du trajet : celles de l'itinéraire
  // choisi par le client (pont à péage ou voie normale), sinon celles du trajet habituel.
  const choisi = opts.itineraire ? { distanceMeters: opts.itineraire.distanceMeters, durationSeconds: opts.itineraire.durationSeconds } : undefined;
  const { distanceMeters, etaSeconds } = baseTarifaire([origin, ...stops, destination], BAREME.avgSpeedKmh, trafic.factor, choisi);
  // APK de test temps réel : trafic réel de Google sur CE trajet, temps prévu avec le trafic,
  // et approche réelle du chauffeur le plus proche (voir tempsReel.ts).
  const route = TEMPS_REEL ? trajetConnu([origin, ...stops, destination]) : null;
  const app = TEMPS_REEL ? approcheConnue(origin) : null;
  const reel = route && route.fluideSeconds ? {
    durationSeconds: route.durationSeconds, fluideSeconds: route.fluideSeconds,
    trafic: traficReel(route.durationSeconds, route.fluideSeconds),
    approche: app ? { distanceMeters: app.distanceMeters, durationSeconds: app.durationSeconds, cout: coutApproche(app.distanceMeters, app.durationSeconds), google: app.google } : null,
  } : undefined;
  const prix = prixCourse({
    origin, destination, stops, distanceMeters,
    multiplier: tier.multiplier, gamme: tier.id, bodyType: opts.bodyType, insurance: opts.insurance, reel,
    itineraire: opts.itineraire?.choix, peages: opts.itineraire?.peages,
  });
  return {
    lockId: `local-${Date.now()}`,
    amount: prix.amount,
    currency: 'XOF',
    distanceMeters: Math.round(distanceMeters),
    etaSeconds,
    trafficLevel: prix.trafficLevel,
    breakdown: prix.breakdown,
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
  const trafic = traficServeur(origin, destination);
  const { distanceMeters, etaSeconds } = baseTarifaire([origin, destination], BAREME_LIVRAISON.avgSpeedKmh, trafic.factor); // moto plus rapide
  // Barème coursier du serveur (moins cher qu'une course en voiture), zone de départ comprise.
  const prix = prixLivraison({ origin, destination, distanceMeters, tailleFacteur: PKG_FACTOR[size] });
  return {
    lockId: `delivery-${Date.now()}`,
    amount: prix.amount,
    currency: 'XOF',
    distanceMeters: Math.round(distanceMeters),
    etaSeconds,
    trafficLevel: prix.trafficLevel,
    breakdown: prix.breakdown,
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
    body: JSON.stringify({
      origin, destination, category: tier.id, bodyType: opts.bodyType, stops: opts.stops, insurance: opts.insurance, promoCode: opts.promoCode, clientId: clientId(),
      // Itinéraire choisi : le serveur reprend sa distance (contrôlée) et ses péages.
      ...(opts.itineraire ? { itineraire: opts.itineraire.choix, peages: opts.itineraire.peages, routeMeters: Math.round(opts.itineraire.distanceMeters) } : {}),
      ...(opts.miseADisposition ? { miseADisposition: opts.miseADisposition } : {}),
    }),
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
  if (!API) {
    const r = repondreLocal(path, init);
    if (!r) return { ok: false, error: 'Fonction indisponible sans serveur ORION.', status: 0 };
    return r.status < 400 ? { ok: true, data: r.data as T } : { ok: false, error: messageErreur(r.data as Record<string, unknown>, r.status), status: r.status };
  }
  const jeton = sessionClient();
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    const res = await fetch(`${API}${path}`, {
      ...init,
      headers: { ...(init.body ? { 'content-type': 'application/json' } : {}), ...enTetesPasserelle(), ...(jeton ? { authorization: `Bearer ${jeton}` } : {}), ...(init.headers ?? {}) },
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

export type CanalCode = 'sms' | 'whatsapp';

export async function demanderCode(phone: string, canal: CanalCode = 'sms'): Promise<{ ok: true; devCode?: string; compteExistant: boolean } | { ok: false; error: string }> {
  // Identity Platform (si réglé, avec un serveur relié) : c'est Google qui envoie et contrôle le code SMS.
  // Le code WhatsApp, lui, part toujours du serveur ORION (Twilio).
  if (identiteGoogleActive && API && canal === 'sms') {
    const g = await envoyerCodeGoogle(phone);
    return g.ok ? { ok: true, compteExistant: false } : g;
  }
  // reCAPTCHA Enterprise (si réglé) : le serveur n'envoie pas de SMS à un robot.
  const r = await appel<{ devCode?: string; compteExistant: boolean }>('/clients/auth/otp', {
    method: 'POST', body: JSON.stringify(canal === 'whatsapp' ? { phone, canal } : { phone }), headers: API ? await enTeteRecaptcha('connexion_client') : {},
  });
  return r.ok ? { ok: true, devCode: r.data.devCode, compteExistant: r.data.compteExistant } : { ok: false, error: r.error };
}

/** Vérifie le code ; en cas de succès, l'appareil adopte le compte (et sa session). */
export async function verifierCode(phone: string, code: string, name?: string, email?: string, canal: CanalCode = 'sms'): Promise<{ ok: true; client: ProfilClient; compteRetrouve: boolean } | { ok: false; error: string }> {
  type Session = { token: string; client: ProfilClient; compteRetrouve: boolean };
  const identite = { clientId: clientId(), name: name?.trim() || undefined, email: email?.trim() || undefined };
  let r: Awaited<ReturnType<typeof appel<Session>>>;
  if (identiteGoogleActive && API && canal === 'sms') {
    // Le code est vérifié par Google ; le serveur ORION reçoit le jeton d'identité et ouvre le compte du numéro.
    const g = await confirmerCodeGoogle(phone, code);
    if (!g.ok) return g;
    r = await appel<Session>('/clients/auth/identity', { method: 'POST', body: JSON.stringify({ ...identite, idToken: g.idToken }) });
  } else {
    r = await appel<Session>('/clients/auth/verify', { method: 'POST', body: JSON.stringify({ ...identite, phone, code }) });
  }
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

/* ------------------------------ Portefeuille ------------------------------ */
/** Mouvement du portefeuille client (remboursement d'assurance, transfert mobile money…). */
export interface MouvementPortefeuille { id: string; type: string; amount: number; at: string; note?: string }
export interface Cotisations { count: number; total: number; year: number; estimatedRefund: number }

export async function chargerPortefeuille(): Promise<{ balance: number; history: MouvementPortefeuille[] } | null> {
  const r = await appel<{ balance: number; history: MouvementPortefeuille[] }>(`/clients/${encodeURIComponent(clientId())}/wallet`);
  return r.ok ? r.data : null;
}
export async function resumeCotisations(): Promise<Cotisations | null> {
  const r = await appel<{ summary: Cotisations }>(`/clients/${encodeURIComponent(clientId())}/insurance`);
  return r.ok ? r.data.summary : null;
}
/** Transfert du solde vers un compte mobile money (Wave, Orange Money, MTN MoMo, Moov Money). */
export async function transfererPortefeuille(amount: number, method: string): Promise<{ ok: true; balance: number } | { ok: false; error: string }> {
  const r = await appel<{ balance: number }>(`/clients/${encodeURIComponent(clientId())}/wallet/transfer`, { method: 'POST', body: JSON.stringify({ amount, method }) });
  return r.ok ? { ok: true, balance: r.data.balance } : { ok: false, error: r.error };
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
  chat: Array<{ from: 'agent' | 'usager'; author?: string; text: string; at: string; auto?: boolean }>;
  secours: Array<{ service: string; numero: string; canal: 'appel' | 'sms' | 'whatsapp'; at: string; issue: 'tentative' | 'joint' | 'non_joint' | 'messagerie' }>;
  /**
   * Ce que le centre de contrôle fait pour la personne : services à prévenir (SAMU,
   * police, pompiers, dépannage) et gestes internes (appeler le chauffeur, la rappeler).
   * « simulation » : application sans serveur, rien n'est réellement transmis.
   */
  demandes?: Array<{ cle: string; label: string; numero?: string; at: string; statut: StatutDemandeSos }>;
  /** Réponses proposées d'un toucher par l'agent automatique. */
  suggestions?: string[];
  /** Vrai tant que c'est l'agent automatique qui répond (aucun opérateur n'a encore pris le dossier). */
  agentAuto?: boolean;
  clotureeA: string | null;
}
export type StatutDemandeSos = 'transmise' | 'en_cours' | 'joint' | 'injoignable' | 'faite' | 'simulation';

export interface SosResult {
  /** true UNIQUEMENT si ORION a bien reçu l'alerte. Jamais optimiste. */
  delivered: boolean;
  /** Suivi en direct de l'alerte (absent si l'envoi a échoué). */
  suivi?: SosSuivi;
  alert?: unknown;
  /**
   * App sans serveur (APK de démonstration) : l'alerte est suivie sur le téléphone mais
   * n'est transmise à personne — `delivered` reste faux et l'écran le dit.
   */
  local?: boolean;
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
export async function sos(
  userId: string, location: LatLng, rideId?: string,
  /** Langue de l'app (l'agent répond en français ou en anglais) ; lieu lisible, pour l'app sans serveur. */
  extra: { langue?: string; zoneName?: string; enCourse?: boolean } = {},
): Promise<SosResult> {
  const body = JSON.stringify({ userId, location, rideId, ...extra });
  if (!API) {
    // Sans serveur : aucune alerte réelle ne part. Le suivi s'ouvre quand même (numéros
    // d'urgence, position, messages) avec la mention « démonstration ».
    const r = repondreLocal('/safety/sos', { method: 'POST', body });
    const suivi = (r?.data as { suivi?: SosSuivi } | undefined)?.suivi;
    return { delivered: false, local: true, suivi };
  }
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

/** L'app fonctionne sans serveur : ses données restent sur le téléphone (voir serveurLocal.ts). */
export function modeLocal(): boolean {
  return !API;
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
  /** Le serveur sait envoyer le code de connexion par WhatsApp. */
  codeWhatsApp?: boolean;
  /** Grille de prix de la direction (ajustement général, écarts entre gammes). */
  prix?: GrillePrixServeur;
}

export async function fetchAppConfig(): Promise<AppConfig | null> {
  const res = await tryFetch<Partial<AppConfig>>('/config');
  if (!res) return null;
  appliquerGrillePrix(res.prix);
  return {
    city: res.city ?? 'Abidjan',
    open: res.open ?? true,
    services: res.services ?? {},
    gateways: res.gateways ?? {},
    currency: res.currency ?? 'XOF',
    codeWhatsApp: res.codeWhatsApp === true,
    ...(res.prix ? { prix: res.prix } : {}),
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
  /** Vraie plaque et couleur déclarées par le chauffeur dans son app : on reconnaît le véhicule. */
  vehiclePlate?: string | null;
  vehicleColor?: string | null;
  /** Photo du chauffeur (chemin de l'API), s'il en a une. */
  photoUrl?: string | null;
}

/** Adresse complète d'une ressource du backend (photo du chauffeur…), null en mode démo. */
export function urlApi(chemin: string | null | undefined): string | null {
  return chemin && API ? `${API}${chemin}` : null;
}

export interface RideCreateResult {
  ride: RideCreated;
  driver: SafeDriver | null;
  /** Code de prise en charge à donner au chauffeur (course de passager uniquement). */
  code: string | null;
  /** Code de remise du colis, à transmettre au destinataire (livraison uniquement). */
  codeRemise?: string | null;
}

export interface TrustedContact {
  name: string;
  phone: string;
}

/**
 * Course programmée : enregistrée sur le serveur ORION quand il est joint (route
 * /reservations, suivie par la console). Renvoie l'identifiant, ou null sans serveur —
 * l'application la garde alors sur le téléphone (voir programmees.ts).
 */
export async function reserverCourse(input: { origin: LatLng; destination: LatLng; category: string; scheduledFor: string; miseADisposition?: { heures: number } }): Promise<string | null> {
  if (!API) return null;
  const r = await tryFetch<{ reservation: { id: string } }>('/reservations', {
    method: 'POST', body: JSON.stringify({ clientId: clientId(), ...input }),
  }, 6000);
  return r?.reservation?.id ?? null;
}

/**
 * Identité client stable, mémorisée sur l'appareil (à remplacer par l'identité
 * authentifiée — JWT — en production). Permet de rattacher les courses au bon client
 * et d'afficher l'historique personnel.
 */
export function clientId(): string {
  let id = localStorage.getItem('orion.clientId');
  if (!id) {
    // Identifiant d'un invité : c'est la seule clé de ses courses et locations, il doit
    // être imprévisible (générateur cryptographique, pas Math.random).
    // randomUUID n'existe qu'en contexte sécurisé (HTTPS) et sur les WebView récentes.
    const c = globalThis.crypto as Crypto | undefined;
    const alea = typeof c?.randomUUID === 'function'
      ? c.randomUUID().replace(/-/g, '')
      : Array.from(c!.getRandomValues(new Uint8Array(16)), (b: number) => b.toString(16).padStart(2, '0')).join('');
    id = 'client-' + alea;
    localStorage.setItem('orion.clientId', id);
  }
  return id;
}

/**
 * Crée une course côté backend (idempotent). Renvoie null si backend indisponible.
 * `paymentMethod` (optionnel) : moyen annoncé, affiché au chauffeur ; « espèces » exclut
 * les chauffeurs au-delà du plafond de dette espèces fixé en console.
 */
/** Livraison à moto : la personne qui reçoit le colis, et ce que le livreur doit savoir. */
export interface DetailsLivraison {
  destinataire: { nom: string; telephone: string };
  description?: string;
  instructions?: string;
}

export async function createRide(lockId: string, cid: string, trustedContact?: TrustedContact, paymentMethod?: string, livraison?: DetailsLivraison): Promise<RideCreateResult | null> {
  const res = await tryFetch<{ ride: RideCreated; driver: SafeDriver | null; codePriseEnCharge?: string | null; codeRemise?: string | null }>('/rides', {
    method: 'POST',
    headers: { 'idempotency-key': `${cid}-${lockId}` },
    body: JSON.stringify({ clientId: cid, lockId, trustedContact, paymentMethod, ...(livraison ? { livraison } : {}) }),
  });
  if (res?.ride?.id && res.codePriseEnCharge) {
    try { localStorage.setItem(`orion.code.${res.ride.id}`, res.codePriseEnCharge); } catch { /* stockage indisponible */ }
  }
  if (res?.ride?.id && res.codeRemise) {
    try { localStorage.setItem(`orion.remise.${res.ride.id}`, res.codeRemise); } catch { /* stockage indisponible */ }
  }
  return res ? { ride: res.ride, driver: res.driver ?? null, code: res.codePriseEnCharge ?? null, codeRemise: res.codeRemise ?? null } : null;
}

/** Code de remise d'un colis (expéditeur connecté), sinon celui mémorisé à la commande. */
export async function lireCodeRemise(rideId: string): Promise<{ code: string; verifie: boolean } | null> {
  const r = await tryFetch<{ code: string; verifie: boolean }>(`/rides/${rideId}/code-remise`);
  if (r) return r;
  try {
    const local = localStorage.getItem(`orion.remise.${rideId}`);
    return local ? { code: local, verifie: false } : null;
  } catch { return null; }
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
  const base = baseTempsReel(API);
  return base ? `${base}${path}` : null;
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

/** L'usager met fin à SON alerte et à la discussion avec l'agent (en sécurité, fausse alerte). */
export type MotifFinSos = 'en_securite' | 'fausse_alerte';
export async function sosTerminer(alertId: string, userId: string, motif: MotifFinSos): Promise<SosSuivi | null> {
  const r = await tryFetch<{ suivi: SosSuivi }>(`/safety/sos/${alertId}/terminer`, { method: 'POST', body: JSON.stringify({ userId, motif }) }, 8000);
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
  formules: Array<{ id: RentalFormula; label: string; durees?: RentalDuree[]; moisMin?: number }>;
  /** Forfait mensuel : engagement minimal d'une entreprise et remise par palier. */
  engagement?: { moisMinEntreprise: number; moisMax: number; paliers: Array<{ aPartirDeMois: number; remise: number }> };
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
    formules: RENTAL_FORMULES.map((id) => ({ id, label: id, durees: dureesPermises(id), moisMin: id === 'entreprise' ? RENTAL_TARIFF.moisMinEntreprise : 1 })),
    engagement: {
      moisMinEntreprise: RENTAL_TARIFF.moisMinEntreprise,
      moisMax: RENTAL_MOIS_MAX,
      paliers: [1, 3, 6, 12].map((m) => ({ aPartirDeMois: m, remise: remiseMensuelle(m) })),
    },
    durees: RENTAL_DUREES.map((id) => ({ id, label: id, coef: RENTAL_COEF[id] ?? null, jours: RENTAL_JOURS[id] ?? null })),
    options: RENTAL_OPTION_KEYS.map((id) => ({ id, label: id })),
    bareme: RENTAL_TARIFF,
    currency: 'XOF',
    live: false,
  };
}

/** Fin de la période d'immobilisation (même règle que le serveur). */
function rentalFin(debut: Date, duree: RentalDuree, heures?: number, mois = 1): Date {
  if (duree === 'heures') return new Date(debut.getTime() + (heures ?? RENTAL_TARIFF.minHeures) * 3_600_000);
  if (duree === 'mois') return new Date(debut.getTime() + Math.max(1, mois) * 30 * 86_400_000);
  return new Date(debut.getTime() + (RENTAL_JOURS[duree] ?? 1) * 86_400_000);
}

const memeJour = (a: Date, b: Date) => a.toISOString().slice(0, 10) === b.toISOString().slice(0, 10);

export async function fetchRentalAvailability(debut: Date, duree: RentalDuree, heures?: number, mois?: number): Promise<RentalAvailability[]> {
  const q = new URLSearchParams({ debut: debut.toISOString(), duree });
  if (heures) q.set('heures', String(heures));
  if (mois && duree === 'mois') q.set('mois', String(mois));
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
  /** Forfait mensuel : nombre de mois (6 minimum pour une entreprise). */
  mois?: number;
  /** Forfait mensuel : reconduction à l'échéance. */
  renouvelable?: boolean;
  options?: RentalOptions;
  userId?: string;
}

/** Devis local (mode démo) — reproduit fidèlement le calcul du serveur. */
export function previewRental(input: RentalQuoteInput, vehicles: PrestigeVehicle[], tvaRate = 0.05, remise = 0): RentalQuote {
  const v = vehicles.find((x) => x.id === input.vehicleId) ?? vehicles[0]!;
  const T = RENTAL_TARIFF;
  // Une entreprise ne loue qu'au forfait mensuel, six mois minimum (règle du serveur).
  const entreprise = input.formula === 'entreprise';
  const duree: RentalDuree = entreprise ? 'mois' : input.duree;
  const mensuel = duree === 'mois';
  const moisMin = entreprise ? T.moisMinEntreprise : 1;
  const mois = mensuel ? Math.max(moisMin, Math.min(RENTAL_MOIS_MAX, Math.round(input.mois ?? moisMin))) : undefined;
  const heures = duree === 'heures' ? Math.max(T.minHeures, Math.min(T.maxHeures, input.heures ?? T.minHeures)) : undefined;
  const coef = duree === 'heures'
    ? Math.min(heures! * T.ratioHeure, 1)
    : mensuel ? 30 * (1 - remiseMensuelle(mois!)) * mois! : (RENTAL_COEF[duree] ?? 1);
  const jours = duree === 'heures' ? heures! / T.heuresParJournee : mensuel ? 30 * mois! : (RENTAL_JOURS[duree] ?? 1);
  const joursFactures = Math.max(1, Math.ceil(jours));
  const secondChauffeurRequis = (duree === 'heures' ? heures! : T.heuresParJournee) > T.heuresParJournee;

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
  // La mobilisation express ne porte que sur le premier jour d'un contrat long.
  const assietteExpress = duree === 'semaine' || mensuel ? Math.min(sousTotal, v.prixJour * (1 + o.cortege)) : sousTotal;
  const majorationJourJ = jourJ ? Math.round(assietteExpress * T.majorationJourJ) : 0;
  const remiseAbonnement = Math.round((sousTotal + majorationJourJ) * Math.max(0, Math.min(0.3, remise)));
  const ht = sousTotal + majorationJourJ - remiseAbonnement;
  const tva = Math.round(ht * tvaRate);
  const fin = rentalFin(input.debut, duree, heures, mois);
  const pleinTarif = duree === 'heures' ? vehicule : Math.round(v.prixJour * jours);

  return {
    formula: input.formula, vehicleId: v.id,
    vehicle: { id: v.id, name: v.name, marque: v.marque, classe: v.classe, places: v.places, prixJour: v.prixJour, autonomieKm: v.autonomieKm },
    debut: input.debut.toISOString(), fin: fin.toISOString(), duree, heures,
    mois,
    renouvelable: mensuel ? (input.renouvelable ?? entreprise) : undefined,
    mensualite: mensuel ? Math.round((ht + tva) / mois!) : undefined,
    remiseDuree: {
      taux: pleinTarif > 0 ? Math.round((1 - vehicule / pleinTarif) * 1000) / 1000 : 0,
      montant: Math.max(0, pleinTarif - vehicule),
    },
    heuresService: duree === 'heures' ? heures! : jours * T.heuresParJournee,
    jours, options: o, secondChauffeurRequis,
    kmInclus: o.kilometrageIllimite ? null : T.kmInclusParJour * joursFactures,
    prixKmSupp: T.prixKmSupp,
    breakdown: { vehicule, kilometrageIllimite, cortege, options, majorationJourJ, remiseAbonnement, ht, tva },
    total: ht + tva, caution: Math.round((mensuel ? ht / mois! : ht) * T.tauxCaution), jourJ,
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
      duree: input.duree, heures: input.heures, mois: input.duree === 'mois' ? input.mois : undefined,
      renouvelable: input.duree === 'mois' ? input.renouvelable : undefined, options: input.options, userId: input.userId,
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
  if (!API) {
    // Sans serveur : le devis local devient une réservation conservée sur le téléphone.
    const devis = previewRental(input, PRESTIGE_FALLBACK);
    return reserverLocationLocale(devis, { userId: input.userId, lieu: input.lieu, contact: input.contact, societe: input.societe }) as unknown as RentalReservation;
  }
  const r = await tryFetch<{ reservation: RentalReservation }>('/rental/reserve', {
    method: 'POST',
    body: JSON.stringify({
      formula: input.formula, vehicleId: input.vehicleId, debut: input.debut.toISOString(),
      duree: input.duree, heures: input.heures, mois: input.duree === 'mois' ? input.mois : undefined,
      renouvelable: input.duree === 'mois' ? input.renouvelable : undefined, options: input.options,
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

/* ============================== MARIAGE ============================== */
export interface ReservationMariage {
  id: string; userId: string; tier: string; date: string; duration: 'halfday' | 'fullday' | 'weekend';
  options: { decoration: boolean; convoy: number; chauffeur: boolean };
  breakdown: { vehicle: number; decoration: number; convoy: number }; total: number; status: string; createdAt: string;
}
/** Réservation ferme d'un véhicule de mariage (le serveur calcule et enregistre le devis). */
export async function reserverMariage(input: { tier: string; date: string; duration: 'halfday' | 'fullday' | 'weekend'; decoration: boolean; convoy: number }): Promise<{ ok: true; reservation: ReservationMariage } | { ok: false; error: string }> {
  const r = await appel<{ reservation: ReservationMariage }>('/wedding/reserve', {
    method: 'POST',
    body: JSON.stringify({ userId: clientId(), tier: input.tier, date: input.date, duration: input.duration, options: { decoration: input.decoration, convoy: input.convoy } }),
  });
  return r.ok ? { ok: true, reservation: r.data.reservation } : { ok: false, error: r.error };
}
export async function mesMariages(): Promise<ReservationMariage[]> {
  const r = await appel<{ reservations: ReservationMariage[] }>(`/wedding/${encodeURIComponent(clientId())}`);
  return r.ok ? r.data.reservations : [];
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

/** Manœuvre de guidage (navigation chauffeur) : bretelles d'échangeur, ronds-points, ponts… */
export interface Manoeuvre {
  type: string;
  modificateur?: string;
  nom: string;
  distanceMeters: number;
  position: LatLng;
  sortie?: number;
}

export interface ItineraireRoute {
  geometrie: LatLng[];
  distanceMeters: number;
  durationSeconds: number;
  ponts: string[];
  provider: 'osrm' | 'repli' | 'google';
  /** Itinéraire de Google : durée sans circulation, et grande voie empruntée. */
  fluideSeconds?: number;
  via?: string;
  /** Guidage pas à pas (serveurs récents ; absent d'un tracé de repli). */
  manoeuvres?: Manoeuvre[];
}

const cacheItineraires = new Map<string, Promise<ItineraireRoute | null>>();
/** Dernier refus du calcul d'itinéraire public (hors connexion, page intégrée qui l'interdit). */
let refusItinerairePublic = 0;

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
    // Après un refus, on n'insiste pas pendant 30 s : le tracé de repli s'affiche tout de suite.
    if (Date.now() - refusItinerairePublic < 30_000) return null;
    try {
      const coords = points.map((q) => `${q.lng.toFixed(6)},${q.lat.toFixed(6)}`).join(';');
      const res = await fetch(`https://router.project-osrm.org/route/v1/driving/${coords}?overview=full&geometries=geojson&steps=true`, { signal: AbortSignal.timeout(8000) });
      const j = await res.json() as { code: string; routes?: Array<{ distance: number; duration: number; geometry: { coordinates: [number, number][] }; legs: Array<{ steps: Array<{ name: string; ref?: string; distance: number; maneuver: { type: string; modifier?: string; location: [number, number]; exit?: number } }> }> }> };
      const route = j.routes?.[0];
      if (j.code !== 'Ok' || !route) return null;
      const ponts = [...new Set(route.legs.flatMap((l) => l.steps.map((st) => st.name)).filter((n) => /^pont\b/i.test(n)))];
      return {
        geometrie: route.geometry.coordinates.map(([lng, lat]) => ({ lat, lng })),
        distanceMeters: Math.round(route.distance), durationSeconds: Math.round(route.duration), ponts, provider: 'osrm',
        manoeuvres: route.legs.flatMap((l, i) => l.steps.filter((st) => !(i > 0 && st.maneuver.type === 'depart')).map((st) => ({
          type: st.maneuver.type, modificateur: st.maneuver.modifier, nom: st.name || st.ref || '', distanceMeters: Math.round(st.distance),
          position: { lat: st.maneuver.location[1], lng: st.maneuver.location[0] }, sortie: st.maneuver.exit,
        }))),
      };
    } catch {
      refusItinerairePublic = Date.now();
      return null;
    }
  })();
  cacheItineraires.set(cle, p);
  void p.then((r) => { if (!r) cacheItineraires.delete(cle); });
  return p;
}

/**
 * Variantes d'itinéraire du calcul routier d'ORION (OSRM) entre deux points : le plus rapide
 * et jusqu'à trois autres. Sert au choix « pont à péage ou voie normale » sans Google.
 */
export async function variantesOrion(points: LatLng[]): Promise<ItineraireRoute[]> {
  if (points.length !== 2) { const r = await itineraire(points); return r ? [r] : []; }
  if (Date.now() - refusItinerairePublic < 30_000) return [];
  try {
    const coords = points.map((q) => `${q.lng.toFixed(6)},${q.lat.toFixed(6)}`).join(';');
    const res = await fetch(`https://router.project-osrm.org/route/v1/driving/${coords}?overview=full&geometries=geojson&alternatives=3`, { signal: AbortSignal.timeout(8000) });
    const j = await res.json() as { code: string; routes?: Array<{ distance: number; duration: number; geometry: { coordinates: [number, number][] } }> };
    if (j.code !== 'Ok' || !j.routes?.length) return [];
    return j.routes.map((route) => ({
      geometrie: route.geometry.coordinates.map(([lng, lat]) => ({ lat, lng })),
      distanceMeters: Math.round(route.distance), durationSeconds: Math.round(route.duration), ponts: [], provider: 'osrm' as const,
    }));
  } catch {
    refusItinerairePublic = Date.now();
    return [];
  }
}

/* ------------------------------ ORION Assurance ------------------------------ */

export const ANTECEDENTS = [
  'asthme', 'hypertension', 'diabete', 'drepanocytose', 'epilepsie',
  'cardiaque', 'renale', 'coagulation', 'grossesse', 'mobilite_reduite',
  'avc', 'respiratoire', 'cancer', 'hepatique',
] as const;
export type Antecedent = typeof ANTECEDENTS[number];
/** Allergies qui changent un geste de secours ; ce que les secours doivent savoir pour se faire comprendre. */
export const ALLERGIES = ['penicilline', 'aspirine_ains', 'anesthesiques', 'iode', 'latex', 'aliments', 'venins'] as const;
export const COMMUNICATION = ['malentendant', 'malvoyant', 'parole_difficile', 'non_francophone'] as const;
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
    /* Questionnaire enrichi : tout est facultatif. */
    poidsKg?: number; tailleCm?: number;
    allergiesConnues?: Array<typeof ALLERGIES[number]>; insuline?: boolean; grossesseMois?: number;
    hospitalisationRecente?: boolean; chirurgies?: string; implants?: string;
    communication?: Array<typeof COMMUNICATION[number]>; langues?: string; consignes?: string; hopital?: string;
  };
  urgence: { nom: string; lien: string; telephone: string };
  /** Seconde personne à prévenir, si la première ne répond pas. */
  urgence2?: { nom: string; lien: string; telephone: string };
  medecin?: { nom?: string; telephone?: string };
  /** Mutuelle ou assurance santé privée (admission en clinique). */
  mutuelle?: { compagnie?: string; numero?: string };
}
export interface StatutAssurance {
  disponible: boolean; inscrit: boolean; depuis: string | null; majLe: string | null;
  consultations: Array<{ le: string; par: string; alerteId: string }>;
}

export async function statutAssurance(): Promise<StatutAssurance | null> {
  const id = clientId();
  const r = await appel<{ statut: StatutAssurance }>(`/clients/${encodeURIComponent(id)}/assurance`);
  return r.ok ? r.data.statut : null;
}

export async function lireDossierAssurance(): Promise<{ fiche: FicheMedicale | null; statut: StatutAssurance } | string> {
  const r = await appel<{ fiche: FicheMedicale | null; statut: StatutAssurance }>(`/clients/${encodeURIComponent(clientId())}/assurance/dossier`);
  return r.ok ? r.data : r.error;
}

export async function enregistrerDossierAssurance(fiche: FicheMedicale): Promise<StatutAssurance | string> {
  const r = await appel<{ statut: StatutAssurance }>(`/clients/${encodeURIComponent(clientId())}/assurance/dossier`, {
    method: 'PUT', body: JSON.stringify({ fiche, consentement: { version: CONSENTEMENT_ASSURANCE, lu: true, accepte: true } }),
  });
  return r.ok ? r.data.statut : r.error;
}

export async function supprimerDossierAssurance(): Promise<StatutAssurance | string> {
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
  return tryFetch<{ messages: MessageOrion[]; nonLus: number }>(`/clients/${encodeURIComponent(clientId())}/messages`);
}
export async function marquerMessageLu(id: string): Promise<number | null> {
  const r = await tryFetch<{ nonLus: number }>(`/clients/${encodeURIComponent(clientId())}/messages/${id}/lu`, { method: 'POST', body: '{}' });
  return r?.nonLus ?? null;
}
export async function repondreMessage(
  id: string, code: string,
  /** App sans serveur : position et langue de l'alerte ouverte par « je ne me sens pas en sécurité ». */
  extra: { location?: LatLng; zoneName?: string; langue?: string } = {},
): Promise<{ message: MessageOrion; alerteId: string | null } | null> {
  return tryFetch<{ message: MessageOrion; alerteId: string | null }>(
    `/clients/${encodeURIComponent(clientId())}/messages/${id}/reponse`,
    { method: 'POST', body: JSON.stringify(API ? { code } : { code, ...extra }) },
  );
}

/* --- Véhicules libres autour du client (avant la commande, comme Yango) --- */
export interface VehiculeProche { id: string; lat: number; lng: number; cap: number; gamme: string }
export interface ApprocheGamme { km: number; minutes: number }
export interface VehiculesProches {
  vehicules: VehiculeProche[];
  approche: Record<string, ApprocheGamme | null>;
  /** Repère du marché (simulateur de la direction) : quand il change, l'app refait son devis. */
  marche?: number;
  /** Offre et demande autour du point (serveur ORION, même calcul que la majoration du prix). */
  tension?: TensionMarche;
  at: string;
}

/** Pastille de la carte : vert = prix habituel, jaune = un peu relevé, orange = forte demande. */
export interface TensionMarche {
  niveau: 'vert' | 'jaune' | 'orange';
  /** Majoration appliquée au prix, en % (plafonnée par la direction). */
  majorationPct: number;
  plafondPct: number;
  /** Commandes / chauffeurs libres autour du point. */
  ratio: number;
  /** Rapport à partir duquel le prix monte. */
  seuil: number;
}

/** Véhicules libres autour d'un point et temps d'approche par gamme. Null sans serveur ORION. */
export async function vehiculesProches(p: LatLng): Promise<VehiculesProches | null> {
  if (!API) return null;
  return tryFetch<VehiculesProches>(`/vehicules/proches?lat=${p.lat.toFixed(5)}&lng=${p.lng.toFixed(5)}`, { method: 'GET' }, 3500);
}
