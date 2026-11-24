/**
 * Couche réseau de la console ORION : session, appels authentifiés et
 * remontée des erreurs (un refus 403 doit être VU par l'employé).
 *
 * Extraite de Admin.tsx lors de l'audit.
 */
import type { PageMeta } from './types';
import { serveurActif } from '../serveur';
import { consoleNative, enTetesNatifs, garderJetonNatif } from './natif';

export const PAGE_SIZE = 25;
/** Pagination locale (mode démo) — même contrat que le serveur. */
export function pageSlice<T>(list: T[], page: number): { items: T[]; meta: PageMeta } {
  const pages = Math.max(1, Math.ceil(list.length / PAGE_SIZE));
  const p = Math.min(pages, Math.max(1, page));
  return { items: list.slice((p - 1) * PAGE_SIZE, p * PAGE_SIZE), meta: { total: list.length, page: p, pages } };
}

/* ------------------------------- API --------------------------------- */
// Adresse du serveur en service : la principale, ou une adresse de secours choisie au
// lancement si la principale ne répond pas (voir ../serveur.ts).
export const API = serveurActif();

/**
 * Un backend est-il joignable ?
 *
 * On ne peut PAS le déduire d'une URL vide : le déploiement recommandé pour les
 * cookies de session sert la console et l'API sur la MÊME origine, donc avec une
 * base vide et des appels relatifs. Confondre « base vide » et « pas de backend »
 * rendait ce déploiement impossible — la console basculait en mode démo.
 *
 * VITE_API_URL renseignée        → backend sur une autre origine.
 * VITE_SAME_ORIGIN=1             → backend derrière la même origine (appels relatifs).
 * ni l'une ni l'autre            → mode démo, données simulées.
 */
export const LIVE = Boolean(API) || (import.meta.env.VITE_SAME_ORIGIN as string | undefined) === '1';

/**
 * SESSION EN COOKIE HttpOnly.
 *
 * Le jeton vivait dans localStorage, donc lisible par tout script de la page : une
 * faille XSS suffisait à l'exfiltrer et à rejouer la session d'un administrateur.
 * Il est désormais posé par le serveur en cookie HttpOnly — ce code n'y a plus
 * accès, et n'a plus rien à stocker. Chaque appel part simplement avec
 * `credentials: 'include'`.
 *
 * Seules subsistent en local la date d'expiration (pour éviter d'afficher la
 * console à une session visiblement périmée) et la preuve anti-CSRF, qui doit
 * justement être lisible pour être recopiée en en-tête.
 */
export const expKey = 'orion.admin.exp';
const csrfKey = 'orion.admin.csrf';
/** Mode démo : aucun backend, la console tourne sur des données simulées. */
const demoKey = 'orion.admin.demo';

export const isDemoSession = () => localStorage.getItem(demoKey) === '1';
export const setDemoSession = () => localStorage.setItem(demoKey, '1');

/** Lit la preuve anti-CSRF : d'abord le cookie posé au login, sinon la copie locale. */
export const getCsrf = (): string => {
  const m = document.cookie.match(/(?:^|;\s*)orion_csrf=([^;]*)/);
  if (m?.[1]) { try { return decodeURIComponent(m[1]); } catch { /* valeur illisible */ } }
  return localStorage.getItem(csrfKey) ?? '';
};
export const setCsrf = (v: string) => localStorage.setItem(csrfKey, v);

export const clearSession = () => {
  garderJetonNatif(null);
  localStorage.removeItem(expKey);
  localStorage.removeItem(csrfKey);
  localStorage.removeItem(demoKey);
};

/** Garde locale : l'autorisation réelle est toujours revérifiée par le serveur. */
export const sessionValid = () => {
  if (isDemoSession()) return true;
  const exp = Number(localStorage.getItem(expKey) ?? 0);
  if (!exp) return false;
  return exp > Date.now();
};

export const H = (): Record<string, string> => {
  const h: Record<string, string> = { 'content-type': 'application/json' };
  // Double soumission : le serveur compare cet en-tête au cookie lisible. Un site
  // tiers ne peut pas lire ce cookie, donc pas forger l'en-tête.
  const csrf = getCsrf();
  if (csrf) h['x-csrf-token'] = csrf;
  // Application console sur téléphone : session et appareil dans les en-têtes (voir natif.ts).
  return { ...h, ...enTetesNatifs() };
};

/** Options communes : le cookie de session doit accompagner chaque appel. */
export const withCreds = (init: RequestInit = {}): RequestInit => ({ ...init, credentials: consoleNative() ? 'omit' : 'include' });

/**
 * Adresse d'un canal temps réel de la console (`/ws/emergency`, `/ws/console`). Dans
 * l'application téléphone, un billet à usage unique accompagne l'ouverture du canal.
 */
export async function adresseCanal(chemin: string): Promise<string> {
  let hote = window.location.host;
  let proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  if (API) { try { const u = new URL(API); hote = u.host; proto = u.protocol === 'https:' ? 'wss:' : 'ws:'; } catch { /* URL invalide */ } }
  let suffixe = '';
  if (consoleNative()) {
    const r = await fetch(`${API}/admin/ws-billet`, withCreds({ method: 'POST', headers: H(), body: '{}' }));
    if (r.ok) suffixe = `?billet=${encodeURIComponent(((await r.json()) as { billet: string }).billet)}`;
  }
  return `${proto}//${hote}${chemin}${suffixe}`;
}
/** 401 = session expirée/invalide → on purge et on renvoie à l'écran de connexion. */
export function onUnauthorized() {
  clearSession();
  if (LIVE) window.location.reload();
}

/** Déconnexion : le serveur efface le cookie HttpOnly et révoque la session. */
export async function logout(): Promise<void> {
  if (LIVE) {
    // Corps `{}` obligatoire : l'en-tête annonce du JSON, et Fastify rejette un
    // corps vide (le POST partait alors en erreur et le cookie n'était pas effacé).
    try { await fetch(API + '/admin/logout', withCreds({ method: 'POST', headers: H(), body: '{}' })); }
    catch { /* hors ligne : on purge quand même le poste */ }
  }
  clearSession();
}

/**
 * Échec d'un appel à l'API admin, porteur du code HTTP et du message du serveur.
 *
 * Indispensable pour l'exigence transversale : un refus 403 renvoie le message
 * « …sans autorisation de la direction… signalée à la direction (DG, CFO, DAA) »,
 * que la console DOIT afficher à l'employé. Sans ce type, le refus était avalé.
 */
export class AdminError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
    this.name = 'AdminError';
  }
  /** Tentative d'accès refusée (session/action non autorisée). */
  get isDenied(): boolean { return this.status === 403; }
}

/**
 * Puits d'erreurs branché par la console au montage : toute erreur d'appel y est
 * signalée pour être RENDUE VISIBLE (modale de refus ou bandeau), même si l'appelant
 * ignore l'exception. Avant, 38 appels avalaient silencieusement les échecs.
 */
let errorSink: (e: AdminError) => void = () => {};
export function setAdminErrorSink(fn: (e: AdminError) => void): void { errorSink = fn; }

/** Construit l'erreur depuis la réponse, en reprenant le message du serveur si présent. */
export async function toAdminError(r: Response): Promise<AdminError> {
  let body: unknown = null;
  try { body = await r.json(); } catch { /* corps non JSON */ }
  return erreurDepuis(r.status, body);
}

/** Erreur d'après un code HTTP et le corps renvoyé (réponse seule ou lecture d'un lot). */
function erreurDepuis(status: number, corps: unknown): AdminError {
  const body = corps as { error?: { message?: string; code?: string } } | null;
  let message = body?.error?.message ?? '';
  // Appareil révoqué (ou plus enrôlé) en cours de session : retour à l'écran d'accueil,
  // qui propose l'enrôlement. Rester sur une console qui refuse tout n'aide personne.
  if (body?.error?.code === 'APPAREIL_NON_ENROLE') { clearSession(); setTimeout(() => window.location.reload(), 1500); }
  if (!message) {
    message = status === 403
      ? 'Action refusée : vous n’avez pas le droit d’effectuer cette opération sans autorisation de la direction. Cette tentative a été signalée à la direction (DG, CFO, DAA).'
      : `Le serveur a refusé l’opération (erreur ${status}). Rien n’a été enregistré.`;
  }
  return new AdminError(status, message);
}

/** Signale l'échec (modale de refus / bandeau) et le lève — pour les appels JSON. */
export async function fail(r: Response): Promise<never> {
  const e = await toAdminError(r);
  errorSink(e);
  throw e;
}

/** Signale l'échec SANS lever — pour les téléchargements, qui abandonnent simplement. */
export async function reportResponse(r: Response): Promise<void> {
  errorSink(await toAdminError(r));
}

async function lectureSeule<T>(p: string): Promise<T> { const r = await fetch(API + p, withCreds({ headers: H() })); if (r.status === 401) onUnauthorized(); if (!r.ok) return fail(r); return r.json() as Promise<T>; }

/**
 * LECTURES GROUPÉES : les lectures demandées au même moment (une actualisation de la console en
 * lance des dizaines) partent ensemble dans UNE requête /admin/lot. Depuis Abidjan, chaque
 * aller-retour vers le serveur coûte 0,2 à 0,5 s : une actualisation passe d'une dizaine de
 * secondes à un seul aller-retour. Les refus (403) restent signalés un par un, comme avant.
 * Un serveur plus ancien, sans /admin/lot, est lu page par page.
 */
interface Attente { p: string; ok: (v: unknown) => void; ko: (e: unknown) => void }
let enAttente: Attente[] = [];
let minuteurLot: ReturnType<typeof setTimeout> | null = null;
let lotAbsent = false;
const LOT_MAX = 100;

function envoyerLot(): void {
  const lot = enAttente;
  enAttente = [];
  if (minuteurLot) { clearTimeout(minuteurLot); minuteurLot = null; }
  if (!lot.length) return;
  if (lot.length === 1 || lotAbsent) { for (const a of lot) lectureSeule(a.p).then(a.ok, a.ko); return; }
  void (async () => {
    const chemins = [...new Set(lot.map((a) => a.p))];
    let r: Response;
    try { r = await fetch(API + '/admin/lot', withCreds({ method: 'POST', headers: H(), body: JSON.stringify({ chemins }) })); }
    catch (e) { for (const a of lot) a.ko(e); return; }
    if (r.status === 404) { lotAbsent = true; for (const a of lot) lectureSeule(a.p).then(a.ok, a.ko); return; }
    if (r.status === 401) onUnauthorized();
    if (!r.ok) { const e = await toAdminError(r); errorSink(e); for (const a of lot) a.ko(e); return; }
    let lus: Record<string, { s: number; b: unknown }> = {};
    try { lus = ((await r.json()) as { r: Record<string, { s: number; b: unknown }> }).r ?? {}; } catch { /* réponse illisible */ }
    for (const a of lot) {
      const lu = lus[a.p];
      if (!lu) { a.ko(new AdminError(502, 'Réponse du serveur incomplète.')); continue; }
      if (lu.s === 401) onUnauthorized();
      if (lu.s >= 200 && lu.s < 300) { a.ok(lu.b); continue; }
      const e = erreurDepuis(lu.s, lu.b);
      errorSink(e);
      a.ko(e);
    }
  })();
}

export function adminGet<T>(p: string): Promise<T> {
  if (!LIVE) return lectureSeule<T>(p);
  return new Promise<T>((ok, ko) => {
    enAttente.push({ p, ok: ok as (v: unknown) => void, ko });
    if (enAttente.length >= LOT_MAX) envoyerLot();
    else minuteurLot ??= setTimeout(envoyerLot, 4);
  });
}
export async function adminPost<T>(p: string, b?: unknown): Promise<T> { const r = await fetch(API + p, withCreds({ method: 'POST', headers: H(), body: JSON.stringify(b ?? {}) })); if (r.status === 401) onUnauthorized(); if (!r.ok) return fail(r); return r.json() as Promise<T>; }
export async function adminPut<T>(p: string, b: unknown): Promise<T> { const r = await fetch(API + p, withCreds({ method: 'PUT', headers: H(), body: JSON.stringify(b) })); if (r.status === 401) onUnauthorized(); if (!r.ok) return fail(r); return r.json() as Promise<T>; }
export async function adminDel(p: string): Promise<void> { const r = await fetch(API + p, withCreds({ method: 'DELETE', headers: H() })); if (r.status === 401) onUnauthorized(); if (!r.ok) await fail(r); }
/** POST qui renvoie un son (essai de la voix humaine) : le corps audio et la voix qui l'a dit. */
export async function adminPostSon(p: string, b: unknown): Promise<{ son: Blob; voix: string | null; modele: string | null }> {
  const r = await fetch(API + p, withCreds({ method: 'POST', headers: H(), body: JSON.stringify(b) }));
  if (r.status === 401) onUnauthorized();
  if (!r.ok) return fail(r);
  return { son: await r.blob(), voix: r.headers.get('x-orion-voix'), modele: r.headers.get('x-orion-modele') };
}

/**
 * Appel d'ÉCRITURE sûr : renvoie true seulement si le serveur a accepté. Les appelants
 * s'en servent pour ne PAS modifier l'affichage quand l'opération a échoué — l'état
 * fantôme (suspension, blacklist… affichées comme faites alors qu'elles ont été refusées)
 * était le second défaut de la gestion d'erreur précédente.
 */
export async function safePost(p: string, b?: unknown): Promise<boolean> {
  try { await adminPost(p, b); return true; } catch { return false; }
}
/**
 * Comme `safePost`, mais rend la RÉPONSE du serveur. Certaines actions produisent
 * quelque chose qu'il faut montrer une seule fois — un mot de passe provisoire, un
 * avertissement sur une coupure moteur — et un simple booléen le perdrait.
 */
export async function safePostData<T>(p: string, b?: unknown): Promise<T | null> {
  try { return await adminPost<T>(p, b); } catch { return null; }
}
export async function safePut(p: string, b: unknown): Promise<boolean> {
  try { await adminPut(p, b); return true; } catch { return false; }
}
export const fcfa = (n: number) => Math.round(n).toLocaleString('fr-FR') + ' F';
