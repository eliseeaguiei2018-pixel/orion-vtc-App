import { randomBytes } from 'node:crypto';
import { config } from '../../config/index.js';

/**
 * Cookies de session de la console.
 *
 * Le jeton de session vivait dans localStorage : lisible par tout script de la page,
 * donc exfiltrable par une faille XSS. Il passe en cookie **HttpOnly** — le navigateur
 * l'envoie seul, JavaScript n'y a plus accès.
 *
 * Un cookie envoyé automatiquement expose en revanche au CSRF : un autre site peut
 * déclencher une requête authentifiée à l'insu de l'employé. D'où le second cookie,
 * lisible celui-là, dont la valeur doit être recopiée dans l'en-tête `x-csrf-token`
 * sur toute écriture (double soumission) : un site tiers ne peut pas lire ce cookie,
 * donc pas forger l'en-tête.
 *
 * Pas de dépendance ajoutée : le projet écrit déjà son JWT, son TOTP et ses PDF.
 */
export const SESSION_COOKIE = 'orion_admin';
export const CSRF_COOKIE = 'orion_csrf';
export const CSRF_HEADER = 'x-csrf-token';

/** Méthodes qui modifient l'état et exigent donc la preuve anti-CSRF. */
const METHODES_ECRITURE = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
export const estEcriture = (methode: string): boolean => METHODES_ECRITURE.has(methode.toUpperCase());

export interface CookieOptions {
  maxAgeSeconds?: number;
  httpOnly?: boolean;
}

/** Lit l'en-tête Cookie d'une requête. */
export function parseCookies(entete: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!entete) return out;
  for (const morceau of entete.split(';')) {
    const i = morceau.indexOf('=');
    if (i < 0) continue;
    const nom = morceau.slice(0, i).trim();
    if (!nom) continue;
    try { out[nom] = decodeURIComponent(morceau.slice(i + 1).trim()); } catch { /* valeur illisible */ }
  }
  return out;
}

/**
 * Fabrique un en-tête Set-Cookie.
 *
 * SameSite : « lax » suffit quand la console est servie depuis la même origine que
 * l'API (déploiement recommandé). Si elle est sur une autre origine, il faut
 * « none » — et donc Secure — sinon le navigateur n'enverra jamais le cookie.
 */
export function serializeCookie(nom: string, valeur: string, opts: CookieOptions = {}): string {
  const sameSite = config.ADMIN_COOKIE_SAMESITE;
  // SameSite=None impose Secure : sans cela le navigateur rejette le cookie.
  const secure = config.ADMIN_COOKIE_SECURE || sameSite === 'none';
  const parts = [
    `${nom}=${encodeURIComponent(valeur)}`,
    'Path=/',
    `SameSite=${sameSite.charAt(0).toUpperCase()}${sameSite.slice(1)}`,
  ];
  if (opts.httpOnly !== false) parts.push('HttpOnly');
  if (secure) parts.push('Secure');
  if (opts.maxAgeSeconds !== undefined) parts.push(`Max-Age=${Math.max(0, Math.floor(opts.maxAgeSeconds))}`);
  return parts.join('; ');
}

/** Jeton anti-CSRF : aléatoire, sans lien avec le secret de signature. */
export const newCsrfToken = (): string => randomBytes(24).toString('hex');

/** En-têtes posant les deux cookies à la connexion. */
export function cookiesDeConnexion(jeton: string, csrf: string, dureeSecondes: number): string[] {
  return [
    serializeCookie(SESSION_COOKIE, jeton, { maxAgeSeconds: dureeSecondes, httpOnly: true }),
    // Lisible par la console : elle doit recopier sa valeur dans l'en-tête.
    serializeCookie(CSRF_COOKIE, csrf, { maxAgeSeconds: dureeSecondes, httpOnly: false }),
  ];
}

/** En-têtes effaçant les deux cookies à la déconnexion. */
export function cookiesDeDeconnexion(): string[] {
  return [
    serializeCookie(SESSION_COOKIE, '', { maxAgeSeconds: 0, httpOnly: true }),
    serializeCookie(CSRF_COOKIE, '', { maxAgeSeconds: 0, httpOnly: false }),
  ];
}
