/**
 * Couche réseau de la console ORION : session, appels authentifiés et
 * remontée des erreurs (un refus 403 doit être VU par l'employé).
 *
 * Extraite de Admin.tsx lors de l'audit.
 */
import type { PageMeta } from './types';

export const PAGE_SIZE = 25;
/** Pagination locale (mode démo) — même contrat que le serveur. */
export function pageSlice<T>(list: T[], page: number): { items: T[]; meta: PageMeta } {
  const pages = Math.max(1, Math.ceil(list.length / PAGE_SIZE));
  const p = Math.min(pages, Math.max(1, page));
  return { items: list.slice((p - 1) * PAGE_SIZE, p * PAGE_SIZE), meta: { total: list.length, page: p, pages } };
}

/* ------------------------------- API --------------------------------- */
export const API = (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/$/, '') ?? '';
export const jwtKey = 'orion.admin.jwt';
export const expKey = 'orion.admin.exp';
export const getJwt = () => localStorage.getItem(jwtKey) ?? '';
export const clearSession = () => { localStorage.removeItem(jwtKey); localStorage.removeItem(expKey); };
/** Session valide si un jeton existe et n'est pas expiré (garde locale, revérifiée serveur). */
export const sessionValid = () => {
  if (!getJwt()) return false;
  const exp = Number(localStorage.getItem(expKey) ?? 0);
  return !exp || exp > Date.now();
};
export const H = (): Record<string, string> => {
  const h: Record<string, string> = { 'content-type': 'application/json' };
  const jwt = getJwt();
  if (jwt && jwt !== 'demo') h['authorization'] = `Bearer ${jwt}`;
  return h;
};
/** 401 = session expirée/invalide → on purge et on renvoie à l'écran de connexion. */
export function onUnauthorized() { clearSession(); if (API) window.location.reload(); }

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
  let message = '';
  try {
    const body = await r.json() as { error?: { message?: string } };
    message = body?.error?.message ?? '';
  } catch { /* corps non JSON */ }
  if (!message) {
    message = r.status === 403
      ? 'Action refusée : vous n’avez pas le droit d’effectuer cette opération sans autorisation de la direction. Cette tentative a été signalée à la direction (DG, CFO, DAA).'
      : `Le serveur a refusé l’opération (erreur ${r.status}). Rien n’a été enregistré.`;
  }
  return new AdminError(r.status, message);
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

export async function adminGet<T>(p: string): Promise<T> { const r = await fetch(API + p, { headers: H() }); if (r.status === 401) onUnauthorized(); if (!r.ok) return fail(r); return r.json() as Promise<T>; }
export async function adminPost<T>(p: string, b?: unknown): Promise<T> { const r = await fetch(API + p, { method: 'POST', headers: H(), body: JSON.stringify(b ?? {}) }); if (r.status === 401) onUnauthorized(); if (!r.ok) return fail(r); return r.json() as Promise<T>; }
export async function adminPut<T>(p: string, b: unknown): Promise<T> { const r = await fetch(API + p, { method: 'PUT', headers: H(), body: JSON.stringify(b) }); if (r.status === 401) onUnauthorized(); if (!r.ok) return fail(r); return r.json() as Promise<T>; }
export async function adminDel(p: string): Promise<void> { const r = await fetch(API + p, { method: 'DELETE', headers: H() }); if (r.status === 401) onUnauthorized(); if (!r.ok) await fail(r); }

/**
 * Appel d'ÉCRITURE sûr : renvoie true seulement si le serveur a accepté. Les appelants
 * s'en servent pour ne PAS modifier l'affichage quand l'opération a échoué — l'état
 * fantôme (suspension, blacklist… affichées comme faites alors qu'elles ont été refusées)
 * était le second défaut de la gestion d'erreur précédente.
 */
export async function safePost(p: string, b?: unknown): Promise<boolean> {
  try { await adminPost(p, b); return true; } catch { return false; }
}
export async function safePut(p: string, b: unknown): Promise<boolean> {
  try { await adminPut(p, b); return true; } catch { return false; }
}
export const fcfa = (n: number) => Math.round(n).toLocaleString('fr-FR') + ' F';
