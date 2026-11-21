/**
 * FOND DE CARTE GOOGLE MAPS (option, à côté de la carte ORION).
 *
 * Google n'affiche sa carte dans une application qu'avec une CLÉ d'API (service « Maps
 * JavaScript API », compte Google Cloud). ORION n'en fournit pas : la clé vient soit de la
 * construction de l'application (VITE_GOOGLE_MAPS_API_KEY, jamais écrite dans le dépôt), soit
 * du client lui-même, qui la colle dans Menu → Carte ; elle reste alors sur son téléphone.
 *
 * Sans clé, ou si Google refuse la clé, l'application affiche la carte ORION : la course
 * n'est jamais bloquée par le fond de carte.
 */
const CLE = 'orion.carte.cleGoogle';
const CHOIX = 'orion.carte.fond';
const ENV = import.meta.env.VITE_GOOGLE_MAPS_API_KEY?.trim() || '';

export type FondCarte = 'orion' | 'google';

const lire = (k: string): string => { try { return localStorage.getItem(k) ?? ''; } catch { return ''; } };
const ecrire = (k: string, v: string | null): void => { try { if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch { /* stockage indisponible */ } };

/** Clé saisie par le client, sinon celle de la construction ; chaîne vide s'il n'y en a pas. */
export const cleGoogle = (): string => lire(CLE).trim() || ENV;
export const cleGoogleSaisie = (): string => lire(CLE).trim();
export const cleGoogleIntegree = (): boolean => ENV.length > 0;

/** Aperçu sans clé : la carte Google « de développement » (assombrie, avec filigrane). */
export const essaiSansCle = (): boolean => lire(CHOIX) === 'google-essai';

/** Google a refusé la clé pendant cette session : on n'insiste pas, la carte ORION s'affiche. */
let refusee = false;
export const cleRefusee = (): boolean => refusee;

/**
 * Motif donné par Google quand il refuse d'afficher sa carte (nom d'erreur de son API,
 * par exemple « ApiNotActivatedMapError »). Sur un téléphone il n'y a pas de console :
 * on le garde pour le montrer au client, avec ce qu'il faut corriger.
 */
let motif = '';
export const motifRefus = (): string => motif;
const MOTIF = /Google Maps JavaScript API (?:error|warning): (\w+)/;
let ecouteConsole = false;
function ecouterGoogle(): void {
  if (ecouteConsole) return;
  ecouteConsole = true;
  for (const niveau of ['error', 'warn'] as const) {
    const origine = console[niveau].bind(console);
    console[niveau] = (...args: unknown[]) => {
      const m = args.map(String).join(' ').match(MOTIF);
      // Sans clé (aperçu), Google signale seulement qu'il en manque une : ce n'est pas un refus.
      if (m && cleGoogle() && m[1] !== 'NoApiKeys' && m[1] !== 'RetiredVersion') { motif = m[1]!; prevenir(); }
      origine(...args);
    };
  }
}

/** L'API Google est-elle déjà chargée dans cette page (avec une autre clé, ou sans clé) ? */
export const googleDejaCharge = (): boolean => Boolean((window as unknown as { google?: { maps?: unknown } }).google?.maps);

/** Fond de carte à afficher maintenant. */
export function fondCarte(): FondCarte {
  if (refusee) return 'orion';
  const choix = lire(CHOIX);
  if (choix === 'orion') return 'orion';
  return cleGoogle() || choix === 'google-essai' ? 'google' : 'orion';
}

const abonnes = new Set<() => void>();
/** Prévenu quand le fond de carte change (clé saisie, retirée, refusée). */
export function suivreFondCarte(f: () => void): () => void { abonnes.add(f); return () => { abonnes.delete(f); }; }
const prevenir = () => abonnes.forEach((f) => f());

export function definirCleGoogle(cle: string): void {
  ecrire(CLE, cle.trim() || null);
  ecrire(CHOIX, cle.trim() ? 'google' : null);
  refusee = false; chargement = null; motif = '';
  prevenir();
}
export function choisirFond(fond: FondCarte | 'google-essai'): void {
  ecrire(CHOIX, fond);
  if (fond !== 'orion') { refusee = false; }
  prevenir();
}

/* ------------------------------ Chargement de l'API ------------------------------ */

/** Sous-ensemble de l'API Google Maps utilisé par ORION (déclaré ici : aucune dépendance de plus). */
export interface GLatLng { lat(): number; lng(): number }
export interface GPoint { x: number; y: number }
export interface GProjection { fromLatLngToPoint(p: GLatLng | { lat: number; lng: number }): GPoint; fromPointToLatLng(p: GPoint): GLatLng }
export interface GMap {
  setCenter(p: { lat: number; lng: number }): void; getCenter(): GLatLng; getZoom(): number; setZoom(z: number): void;
  panTo(p: { lat: number; lng: number }): void; panBy(x: number, y: number): void;
  fitBounds(b: unknown, padding?: number | { top: number; bottom: number; left: number; right: number }): void;
  getProjection(): GProjection | undefined; getDiv(): HTMLElement; setOptions(o: Record<string, unknown>): void;
}
export interface GPolyline { setPath(p: Array<{ lat: number; lng: number }>): void; setMap(m: GMap | null): void; setOptions(o: Record<string, unknown>): void }
export interface GOverlayView {
  setMap(m: GMap | null): void; getPanes(): { overlayMouseTarget: HTMLElement; markerLayer: HTMLElement } | null;
  getProjection(): { fromLatLngToDivPixel(p: unknown): GPoint | null } | undefined;
  onAdd?: () => void; draw?: () => void; onRemove?: () => void;
}
export interface GoogleMaps {
  Map: new (el: HTMLElement, o: Record<string, unknown>) => GMap;
  Polyline: new (o: Record<string, unknown>) => GPolyline;
  OverlayView: new () => GOverlayView;
  LatLng: new (lat: number, lng: number) => GLatLng;
  LatLngBounds: new () => { extend(p: { lat: number; lng: number }): void };
  Point: new (x: number, y: number) => GPoint;
  event: { addListener(o: unknown, e: string, f: () => void): { remove(): void }; addListenerOnce(o: unknown, e: string, f: () => void): { remove(): void }; trigger(o: unknown, e: string): void };
  ColorScheme?: { DARK: string; LIGHT: string };
}

let chargement: Promise<GoogleMaps> | null = null;

/** Charge l'API une seule fois. Rejette si le script n'arrive pas (hors connexion) ou si la clé est refusée. */
export function chargerGoogle(): Promise<GoogleMaps> {
  chargement ??= new Promise<GoogleMaps>((ok, ko) => {
    const w = window as unknown as { google?: { maps?: GoogleMaps }; gm_authFailure?: () => void; __orionGoogle?: () => void };
    ecouterGoogle();
    if (w.google?.maps?.Map) { ok(w.google.maps); return; }
    // Clé invalide, désactivée ou service non autorisé : Google appelle cette fonction.
    w.gm_authFailure = () => { refusee = true; chargement = null; prevenir(); ko(new Error('cle-refusee')); };
    w.__orionGoogle = () => { if (w.google?.maps?.Map) ok(w.google.maps); else ko(new Error('api-absente')); };
    const s = document.createElement('script');
    const cle = cleGoogle();
    s.src = `https://maps.googleapis.com/maps/api/js?${cle ? `key=${encodeURIComponent(cle)}&` : ''}v=weekly&language=fr&region=CI&loading=async&callback=__orionGoogle`;
    s.async = true;
    s.onerror = () => { chargement = null; ko(new Error('reseau')); };
    document.head.appendChild(s);
    window.setTimeout(() => { if (!w.google?.maps?.Map) { chargement = null; ko(new Error('delai')); } }, 15_000);
  });
  return chargement;
}
