/**
 * SERVEUR DE TEST PARTAGÉ — en attendant le vrai serveur ORION.
 *
 * L'app client et l'app chauffeur n'ont pas encore de serveur en ligne : chacune tourne
 * seule sur le téléphone. Pour qu'une course commandée dans l'app client ARRIVE dans l'app
 * chauffeur, les deux lisent et écrivent un même registre de courses, installé sur
 * l'appareil :
 *
 *  - APK Android : un fournisseur de contenu de l'app client (`BusTestProvider`), protégé
 *    par une permission « signature » — seules les apps signées par ORION avec la même clé
 *    y ont accès. L'app chauffeur l'interroge via son module natif `BusTest`. Les deux apps
 *    doivent donc être installées sur le MÊME téléphone ; sur deux téléphones, rien ne
 *    passe (il faudra le serveur en ligne).
 *  - Navigateur (page partagée) : le stockage du site, commun à toutes les interfaces
 *    ORION ouvertes depuis la même adresse (app client, app chauffeur, console, tableau de
 *    bord), avec une notification immédiate entre onglets.
 *  - iPhone : pas de registre commun entre deux apps sans groupe d'apps signé ; chaque app
 *    reste alors seule, comme avant.
 *
 * Le registre ne garde rien plus de 24 heures. Aucune donnée ne quitte l'appareil.
 */
import { Capacitor, registerPlugin } from '@capacitor/core';

interface PluginBusTest {
  lire(): Promise<{ disponible: boolean; entrees: Record<string, string>; raison?: string }>;
  ecrire(o: { cle: string; valeur: string }): Promise<{ ok: boolean }>;
  effacer(o: { cle: string }): Promise<{ ok: boolean }>;
}
const Natif = registerPlugin<PluginBusTest>('BusTest');

export type StatutBus = 'demandee' | 'acceptee' | 'arrivee' | 'en_cours' | 'terminee' | 'payee' | 'annulee' | 'refusee' | 'expiree';
export const STATUTS_ACTIFS: StatutBus[] = ['demandee', 'acceptee', 'arrivee', 'en_cours'];

export interface PointBus { lat: number; lng: number; nom: string }

/** Le chauffeur tel que le client le voit (fiche publique). */
export interface FicheChauffeurBus {
  id: string; nom: string; matricule: string; gamme: string;
  vehicule: string; plaque: string; couleur: string; telephone: string;
  note: number; nbCourses: number;
}
export interface ChauffeurBus extends FicheChauffeurBus {
  enLigne: boolean;
  /** Occupé par une course (offre en cours ou course acceptée). */
  occupe: boolean;
  position: { lat: number; lng: number } | null;
  majLe: number;
}
export interface CourseBus {
  id: string; creeLe: number; majLe: number; statut: StatutBus;
  origine: PointBus; destination: PointBus; arrets: PointBus[];
  gamme: string; carrosserie: string; montant: number;
  distanceMetres: number; dureeSecondes: number; paiement: string;
  client: { id: string; nom: string; telephone: string };
  /** Code de prise en charge : le passager le donne, le chauffeur le saisit. */
  code: string; codeVerifie?: boolean;
  /** Chauffeur à qui l'offre est présentée, puis qui a accepté. */
  chauffeurId?: string;
  chauffeur?: FicheChauffeurBus | null;
  /** Délai de réponse du chauffeur à l'offre (horodatage, ms). */
  offreJusqua?: number;
  annuleePar?: 'client' | 'chauffeur';
  motif?: string;
  paiementRegle?: string;
  /** Note donnée par le client à la fin de la course (1 à 5). */
  note?: number;
}
export interface PresenceClient { id: string; nom: string; majLe: number }
export interface EtatBus { courses: CourseBus[]; chauffeurs: ChauffeurBus[]; clients: PresenceClient[] }

const PREFIXE = 'orion.bus.';
const JOUR = 86_400_000;
const natifAndroid = () => Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android';

/* ------------------------------ Transport ------------------------------ */
let canal: BroadcastChannel | null = null;
const canalWeb = () => {
  if (canal || typeof BroadcastChannel === 'undefined') return canal;
  try { canal = new BroadcastChannel('orion-bus'); } catch { canal = null; }
  return canal;
};

async function lireBrut(): Promise<{ disponible: boolean; entrees: Record<string, string> }> {
  if (natifAndroid()) {
    try { return await Natif.lire(); } catch { return { disponible: false, entrees: {} }; }
  }
  if (Capacitor.isNativePlatform()) return { disponible: false, entrees: {} };
  const entrees: Record<string, string> = {};
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k?.startsWith(PREFIXE)) entrees[k.slice(PREFIXE.length)] = localStorage.getItem(k) ?? '';
    }
    return { disponible: true, entrees };
  } catch { return { disponible: false, entrees }; }
}

async function ecrireBrut(cle: string, valeur: unknown): Promise<boolean> {
  const texte = JSON.stringify(valeur);
  if (natifAndroid()) {
    try { return (await Natif.ecrire({ cle, valeur: texte })).ok; } catch { return false; }
  }
  if (Capacitor.isNativePlatform()) return false;
  try {
    localStorage.setItem(PREFIXE + cle, texte);
    canalWeb()?.postMessage(cle);
    return true;
  } catch { return false; }
}

async function effacerBrut(cle: string): Promise<void> {
  if (natifAndroid()) { try { await Natif.effacer({ cle }); } catch { /* ignore */ } return; }
  if (Capacitor.isNativePlatform()) return;
  try { localStorage.removeItem(PREFIXE + cle); canalWeb()?.postMessage(cle); } catch { /* ignore */ }
}

const lireJson = <T,>(t: string | undefined): T | null => { if (!t) return null; try { return JSON.parse(t) as T; } catch { return null; } };

/* ------------------------------ Lecture ------------------------------ */
/** Le registre est-il joignable ? (Android : l'app client ORION est installée et signée pareil.) */
export async function busDisponible(): Promise<boolean> {
  return (await lireBrut()).disponible;
}

/** Tout le registre, trié du plus récent au plus ancien. Le vieux (plus de 24 h) est effacé. */
export async function etatBus(): Promise<EtatBus & { disponible: boolean }> {
  const { disponible, entrees } = await lireBrut();
  const etat: EtatBus = { courses: [], chauffeurs: [], clients: [] };
  const limite = Date.now() - JOUR;
  for (const [cle, valeur] of Object.entries(entrees)) {
    const v = lireJson<{ majLe?: number }>(valeur);
    if (!v) continue;
    if ((v.majLe ?? 0) < limite) { void effacerBrut(cle); continue; }
    if (cle.startsWith('course:')) etat.courses.push(v as CourseBus);
    else if (cle.startsWith('chauffeur:')) etat.chauffeurs.push(v as ChauffeurBus);
    else if (cle.startsWith('client:')) etat.clients.push(v as PresenceClient);
  }
  etat.courses.sort((a, b) => b.creeLe - a.creeLe);
  etat.chauffeurs.sort((a, b) => b.majLe - a.majLe);
  return { ...etat, disponible };
}

export async function courseBus(id: string): Promise<CourseBus | null> {
  const { entrees } = await lireBrut();
  return lireJson<CourseBus>(entrees[`course:${id}`]);
}

/* ------------------------------ Écriture ------------------------------ */
export async function publierCourse(c: Omit<CourseBus, 'creeLe' | 'majLe'>): Promise<CourseBus | null> {
  const course: CourseBus = { ...c, creeLe: Date.now(), majLe: Date.now() };
  return (await ecrireBrut(`course:${c.id}`, course)) ? course : null;
}

/**
 * Modifie une course : relue juste avant, pour ne pas écraser ce que l'autre app a écrit.
 * Les modifications d'une même app passent l'une après l'autre : deux gestes rapprochés
 * (« code vérifié » puis « course démarrée ») ne peuvent plus s'écraser.
 */
let fileEcritures: Promise<unknown> = Promise.resolve();
export function majCourse(id: string, patch: Partial<CourseBus>): Promise<CourseBus | null> {
  const tache = fileEcritures.then(async () => {
    const actuelle = await courseBus(id);
    if (!actuelle) return null;
    const suite: CourseBus = { ...actuelle, ...patch, id, majLe: Date.now() };
    return (await ecrireBrut(`course:${id}`, suite)) ? suite : null;
  });
  fileEcritures = tache.catch(() => null);
  return tache;
}

export async function majChauffeur(ch: Omit<ChauffeurBus, 'majLe'>): Promise<void> {
  await ecrireBrut(`chauffeur:${ch.id}`, { ...ch, majLe: Date.now() });
}

export async function noterPresenceClient(id: string, nom: string): Promise<void> {
  await ecrireBrut(`client:${id}`, { id, nom, majLe: Date.now() });
}

/* ------------------------------ Suivi ------------------------------ */
/**
 * Suit le registre : `fn` est appelée tout de suite, puis à chaque changement venu d'un
 * autre onglet, au retour au premier plan, et au moins toutes les `ms` millisecondes
 * (l'app d'à côté écrit sans pouvoir prévenir). Renvoie la fonction d'arrêt.
 */
export function suivreBus(fn: (e: EtatBus & { disponible: boolean }) => void, ms = 1200): () => void {
  let actif = true;
  let enCours = false;
  const tirer = () => {
    if (!actif || enCours) return;
    enCours = true;
    void etatBus().then((e) => { if (actif) fn(e); }).finally(() => { enCours = false; });
  };
  tirer();
  const id = window.setInterval(tirer, ms);
  const c = canalWeb();
  const surMessage = () => tirer();
  c?.addEventListener('message', surMessage);
  const surStockage = (e: StorageEvent) => { if (e.key?.startsWith(PREFIXE)) tirer(); };
  window.addEventListener('storage', surStockage);
  const surVisibilite = () => { if (document.visibilityState === 'visible') tirer(); };
  document.addEventListener('visibilitychange', surVisibilite);
  window.addEventListener('focus', surVisibilite);
  return () => {
    actif = false;
    window.clearInterval(id);
    c?.removeEventListener('message', surMessage);
    window.removeEventListener('storage', surStockage);
    document.removeEventListener('visibilitychange', surVisibilite);
    window.removeEventListener('focus', surVisibilite);
  };
}

/* ------------------------------ Règles communes ------------------------------ */
/** Un chauffeur de test est en ligne et libre (dernier signe de vie de moins de 12 h). */
export const chauffeurLibre = (ch: ChauffeurBus) => ch.enLigne && !ch.occupe && Date.now() - ch.majLe < 12 * 3_600_000;
/** Un client a utilisé l'app (ou la page) depuis moins de 30 minutes. */
export const clientRecent = (c: PresenceClient) => Date.now() - c.majLe < 30 * 60_000;
export const codePriseEnCharge = () => String(1000 + Math.floor(Math.random() * 9000));
export const idCourseBus = () => `bus-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
/** Temps laissé au chauffeur pour répondre : on passe d'une app à l'autre sur le même téléphone. */
export const DELAI_OFFRE_MS = 90_000;
/** Temps pendant lequel le client attend qu'un chauffeur accepte. */
export const DELAI_RECHERCHE_MS = 5 * 60_000;
