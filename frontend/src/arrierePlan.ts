import { Capacitor, registerPlugin } from '@capacitor/core';
import type { BackgroundGeolocationPlugin, Location as PositionNative } from '@capacitor-community/background-geolocation';
import { LocalNotifications } from '@capacitor/local-notifications';

/**
 * ARRIÈRE-PLAN (apps client et chauffeur).
 *
 * Sur téléphone, Android endort une application dès qu'on la quitte : plus de GPS, plus de
 * connexion au serveur. Le chauffeur disparaissait de la carte des clients, le client ne voyait
 * plus son chauffeur approcher. Comme Yango ou Uber, ORION garde alors un SERVICE DE PREMIER
 * PLAN, signalé par une notification permanente (« ORION Chauffeur · en service ») :
 *  - le GPS continue, écran éteint ou autre application ouverte ;
 *  - l'application reste vivante, sa connexion au serveur aussi ;
 *  - une course qui arrive pendant ce temps fait sonner le téléphone (notification locale).
 *
 * Le service ne tourne QUE pendant le service du chauffeur (en ligne ou en course) et, côté
 * client, pendant une course : il s'arrête de lui-même ensuite (batterie).
 *
 * Dans un navigateur (ordinateur, page web), on retombe sur le GPS du navigateur.
 */

const BG = registerPlugin<BackgroundGeolocationPlugin>('BackgroundGeolocation');

/** Le service natif d'arrière-plan est disponible (APK / app iOS). */
export const gpsNatif = (): boolean => Capacitor.isNativePlatform() && Capacitor.isPluginAvailable('BackgroundGeolocation');

export interface PointGps {
  lat: number; lng: number;
  /** Précision en mètres. */
  precision: number;
  /** Cap en degrés (0 = nord), s'il est connu. */
  cap: number | null;
  /** Vitesse en m/s, si elle est connue. */
  vitesse: number | null;
  t: number;
}

export type ErreurGps = 'refus' | 'desactive' | 'indisponible';

/**
 * Suit la position du téléphone. `titre` / `message` : texte de la notification permanente
 * (natif). Renvoie la fonction d'arrêt.
 *
 * `distanceMin` : mètres parcourus avant un nouveau point (le GPS se tait à l'arrêt : moins de
 * réveils, moins de batterie).
 */
export function suivreGps(
  o: { titre: string; message: string; distanceMin?: number },
  surPoint: (p: PointGps) => void,
  surErreur: (e: ErreurGps) => void,
): () => void {
  let arrete = false;
  if (gpsNatif()) {
    let id: string | null = null;
    BG.addWatcher(
      { backgroundTitle: o.titre, backgroundMessage: o.message, requestPermissions: true, stale: false, distanceFilter: o.distanceMin ?? 10 },
      (p?: PositionNative, err?: { code?: string; message?: string }) => {
        if (arrete) return;
        if (err) {
          surErreur(err.code === 'NOT_AUTHORIZED' ? (/disabled/i.test(err.message ?? '') ? 'desactive' : 'refus') : 'indisponible');
          return;
        }
        if (!p || p.simulated) return;          // position falsifiée (appli « fake GPS ») : ignorée
        surPoint({ lat: p.latitude, lng: p.longitude, precision: p.accuracy, cap: p.bearing ?? null, vitesse: p.speed ?? null, t: p.time ?? Date.now() });
      },
    ).then((w) => { id = w; if (arrete) void BG.removeWatcher({ id: w }).catch(() => undefined); })
      .catch(() => surErreur('indisponible'));
    return () => { arrete = true; if (id) void BG.removeWatcher({ id }).catch(() => undefined); };
  }
  return suivreGpsNavigateur(surPoint, surErreur);
}

const depuisNavigateur = (p: GeolocationPosition): PointGps => ({
  lat: p.coords.latitude, lng: p.coords.longitude,
  precision: Number.isFinite(p.coords.accuracy) ? p.coords.accuracy : 9999,
  cap: Number.isFinite(p.coords.heading ?? NaN) ? p.coords.heading : null,
  vitesse: Number.isFinite(p.coords.speed ?? NaN) ? p.coords.speed : null,
  t: p.timestamp || Date.now(),
});

/** GPS du navigateur (ou de la WebView), sans service d'arrière-plan : app à l'écran seulement. */
export function suivreGpsNavigateur(surPoint: (p: PointGps) => void, surErreur: (e: ErreurGps) => void): () => void {
  if (!('geolocation' in navigator)) { surErreur('indisponible'); return () => undefined; }
  let arrete = false;
  const w = navigator.geolocation.watchPosition(
    (p) => { if (!arrete) surPoint(depuisNavigateur(p)); },
    (e) => { if (!arrete) surErreur(e.code === e.PERMISSION_DENIED ? 'refus' : 'indisponible'); },
    { enableHighAccuracy: true, maximumAge: 2000, timeout: 20_000 },
  );
  return () => { arrete = true; navigator.geolocation.clearWatch(w); };
}

/** Une seule lecture GPS (null si rien dans le délai). */
export function positionUnique(delaiMs = 10_000): Promise<{ lat: number; lng: number } | null> {
  if (!('geolocation' in navigator)) return Promise.resolve(null);
  return new Promise((ok) => {
    navigator.geolocation.getCurrentPosition(
      (p) => ok({ lat: p.coords.latitude, lng: p.coords.longitude }),
      () => ok(null),
      { enableHighAccuracy: true, maximumAge: 15_000, timeout: delaiMs },
    );
  });
}

/** Ouvre les réglages de l'app (permission de localisation refusée). */
export function ouvrirReglagesPosition(): void {
  if (gpsNatif()) void BG.openSettings().catch(() => undefined);
}

/* ------------------------- Notifications locales ------------------------- */
const CANAL = 'orion-courses';
let pret: Promise<boolean> | null = null;
let suivant = Math.floor(Date.now() / 1000) % 100_000;

const notifNatives = () => Capacitor.isNativePlatform() && Capacitor.isPluginAvailable('LocalNotifications');

/** Demande l'autorisation (une fois) et crée le canal sonore des courses (Android). */
export function preparerNotifications(): Promise<boolean> {
  if (!notifNatives()) return Promise.resolve(false);
  pret ??= (async () => {
    try {
      let p = await LocalNotifications.checkPermissions();
      if (p.display === 'prompt' || p.display === 'prompt-with-rationale') p = await LocalNotifications.requestPermissions();
      if (p.display !== 'granted') return false;
      if (Capacitor.getPlatform() === 'android') {
        await LocalNotifications.createChannel({ id: CANAL, name: 'Courses ORION', description: 'Nouvelles courses, arrivée du chauffeur', importance: 5, visibility: 1, vibration: true, lights: true });
      }
      return true;
    } catch { return false; }
  })();
  return pret;
}

/**
 * Prévient l'utilisateur par une notification du téléphone, UNIQUEMENT si l'app n'est pas à
 * l'écran (à l'écran, l'app l'affiche déjà elle-même).
 */
export async function prevenir(titre: string, corps: string): Promise<void> {
  if (!document.hidden || !(await preparerNotifications())) return;
  try {
    suivant = (suivant + 1) % 2_000_000_000;
    await LocalNotifications.schedule({ notifications: [{ id: suivant, title: titre, body: corps, channelId: CANAL, autoCancel: true }] });
  } catch { /* notification refusée par le système : l'app reste à jour au retour */ }
}

/** Les notifications du téléphone sont-elles autorisées ? null hors application installée. */
export async function notificationsAutorisees(): Promise<boolean | null> {
  if (!notifNatives()) return null;
  try { return (await LocalNotifications.checkPermissions()).display === 'granted'; } catch { return null; }
}

/* -------------- Affichage par-dessus les autres applications (chauffeur) -------------- */
interface PremierPlanPlugin {
  autorise(): Promise<{ autorise: boolean }>;
  demander(): Promise<void>;
  ramener(): Promise<void>;
}
const PP = registerPlugin<PremierPlanPlugin>('PremierPlan');
const premierPlanDispo = () => Capacitor.isNativePlatform() && Capacitor.isPluginAvailable('PremierPlan');

/** « Afficher par-dessus les autres applications » accordé ? null si sans objet (web, iOS, app client). */
export async function affichageParDessus(): Promise<boolean | null> {
  if (!premierPlanDispo()) return null;
  try { return (await PP.autorise()).autorise; } catch { return null; }
}
/** Ouvre le réglage Android où l'utilisateur active l'affichage par-dessus. */
export function demanderAffichageParDessus(): void {
  if (premierPlanDispo()) void PP.demander().catch(() => undefined);
}
/** Ramène l'app à l'écran (offre de course reçue app en arrière-plan), si Android l'autorise. */
export function ramenerAuPremierPlan(): void {
  if (premierPlanDispo() && document.hidden) void PP.ramener().catch(() => undefined);
}
