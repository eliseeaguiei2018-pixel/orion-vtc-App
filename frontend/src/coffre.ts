/**
 * VERROU DU DOSSIER MÉDICAL (ORION Assurance).
 *
 * Le dossier de premiers secours ne s'ouvre dans l'application qu'après preuve que c'est
 * bien son propriétaire : l'empreinte ou le visage du téléphone, ou un code secret que le
 * client définit lui-même s'il ne veut pas lier son empreinte.
 *
 * Le code n'est jamais gardé : seule son empreinte calculée (PBKDF2-SHA-256, 150 000 tours,
 * sel aléatoire) reste sur le téléphone, et elle ne permet pas de le retrouver. Après cinq
 * codes faux, la saisie est suspendue 30 secondes, puis le double à chaque nouvelle erreur.
 *
 * Ce verrou protège la LECTURE et la MODIFICATION dans l'application. Il ne chiffre pas le
 * dossier : en cas d'alerte, le SAMU d'ORION doit pouvoir le lire sans que le client, peut-être
 * inconscient, ait à saisir quoi que ce soit — c'est la raison d'être du service.
 */
export type ModeCoffre = 'empreinte' | 'code';

interface EtatCoffre {
  mode: ModeCoffre;
  /** Mode « code » : sel et empreinte du code, en base64. */
  sel?: string; preuve?: string;
  /** Codes faux consécutifs, et fin de la suspension en cours (ms). */
  essais: number; suspenduJusqua?: number;
  depuis: string;
}

const CLE = 'orion.coffre';
const TOURS = 150_000;
export const CODE_MIN = 4;
export const CODE_MAX = 8;
const ESSAIS_LIBRES = 5;

const lire = (): EtatCoffre | null => {
  try {
    const v = JSON.parse(localStorage.getItem(CLE) ?? 'null') as EtatCoffre | null;
    return v && (v.mode === 'empreinte' || v.mode === 'code') ? v : null;
  } catch { return null; }
};
const ecrire = (e: EtatCoffre | null) => {
  try { if (e) localStorage.setItem(CLE, JSON.stringify(e)); else localStorage.removeItem(CLE); } catch { /* stockage indisponible */ }
};

/** Le mode de protection en place, ou null si le dossier n'est pas encore protégé. */
export const modeCoffre = (): ModeCoffre | null => lire()?.mode ?? null;
export const coffreDepuis = (): string | null => lire()?.depuis ?? null;
export const retirerCoffre = (): void => ecrire(null);

/** Le calcul d'empreinte demande un contexte sécurisé (c'est le cas de l'application installée). */
export const codePossible = (): boolean => typeof crypto !== 'undefined' && Boolean(crypto.subtle);

/** Un code acceptable : 4 à 8 chiffres, pas une suite évidente (0000, 1234, 4321…). */
export function codeFaible(code: string): boolean {
  if (!new RegExp(`^\\d{${CODE_MIN},${CODE_MAX}}$`).test(code)) return true;
  if (/^(\d)\1+$/.test(code)) return true;
  const pas = [...code].slice(1).map((c, i) => Number(c) - Number(code[i]));
  return pas.every((p) => p === 1) || pas.every((p) => p === -1);
}

const b64 = (o: ArrayBuffer | Uint8Array): string => btoa(String.fromCharCode(...new Uint8Array(o as ArrayBuffer)));
const deB64 = (s: string): Uint8Array => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

async function preuveDe(code: string, sel: Uint8Array): Promise<string> {
  const cle = await crypto.subtle.importKey('raw', new TextEncoder().encode(code), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: sel as BufferSource, iterations: TOURS }, cle, 256);
  return b64(bits);
}

/** Protège le dossier par un code secret choisi par le client. */
export async function definirCode(code: string): Promise<boolean> {
  if (!codePossible() || codeFaible(code)) return false;
  const sel = crypto.getRandomValues(new Uint8Array(16));
  ecrire({ mode: 'code', sel: b64(sel), preuve: await preuveDe(code, sel), essais: 0, depuis: new Date().toISOString() });
  return true;
}

/** Protège le dossier par l'empreinte ou le visage du téléphone (déjà vérifié par l'appelant). */
export function choisirEmpreinte(): void {
  ecrire({ mode: 'empreinte', essais: 0, depuis: new Date().toISOString() });
}

/** Secondes restantes avant de pouvoir ressaisir un code (0 = saisie ouverte). */
export function attenteCode(): number {
  const e = lire();
  return e?.suspenduJusqua ? Math.max(0, Math.ceil((e.suspenduJusqua - Date.now()) / 1000)) : 0;
}

export type IssueCode = { ok: true } | { ok: false; restants: number; attente: number };

/** Compare le code saisi à l'empreinte gardée ; compte les erreurs et suspend la saisie. */
export async function verifierCode(code: string): Promise<IssueCode> {
  const e = lire();
  if (!e || e.mode !== 'code' || !e.sel || !e.preuve || !codePossible()) return { ok: false, restants: 0, attente: 0 };
  const attente = attenteCode();
  if (attente > 0) return { ok: false, restants: 0, attente };
  const preuve = await preuveDe(code, deB64(e.sel));
  // Comparaison à durée constante : ne rien révéler par le temps de réponse.
  let ecart = preuve.length ^ e.preuve.length;
  for (let i = 0; i < preuve.length; i++) ecart |= preuve.charCodeAt(i) ^ (e.preuve.charCodeAt(i) || 0);
  if (ecart === 0) { ecrire({ ...e, essais: 0, suspenduJusqua: undefined }); return { ok: true }; }
  const essais = e.essais + 1;
  const pause = essais >= ESSAIS_LIBRES ? Math.min(900, 30 * 2 ** (essais - ESSAIS_LIBRES)) : 0;
  ecrire({ ...e, essais, suspenduJusqua: pause ? Date.now() + pause * 1000 : undefined });
  return { ok: false, restants: Math.max(0, ESSAIS_LIBRES - essais), attente: pause };
}
