import { verifyToken, bearerToken, isSessionInactive } from './auth.js';
import { parseCookies, SESSION_COOKIE, CSRF_COOKIE, CSRF_HEADER, estEcriture } from './cookies.js';
import { resolveAccount, can, type AdminAccount, type Permission } from './roles.js';

/**
 * Authentification du personnel EN DEHORS des routes /admin : flux WebSocket de
 * supervision, anciennes routes /safety/alerts.
 *
 * Ces points d'entrée étaient publics : n'importe qui pouvait lire en direct la
 * position de chaque personne en détresse, ou marquer une alerte « résolue » pour
 * la faire disparaître de la file. Ils suivent désormais les mêmes règles que la
 * console : cookie de session, Bearer ou jeton statique ; preuve anti-CSRF pour
 * une écriture par cookie ; session verrouillée après inactivité refusée.
 */
export type ResultatAcces =
  | { ok: true; compte: AdminAccount }
  | { ok: false; code: 401 | 403; message: string };

export function accesPersonnel(
  req: { headers: Record<string, string | string[] | undefined>; method: string },
  permission: Permission,
): ResultatAcces {
  const entete = (n: string) => {
    const v = req.headers[n];
    return Array.isArray(v) ? v[0] : v;
  };
  const cookies = parseCookies(entete('cookie'));
  const parCookie = verifyToken(cookies[SESSION_COOKIE]);
  const verifie = parCookie ?? verifyToken(bearerToken(entete('authorization')));
  const compte = verifie ?? resolveAccount(entete('x-admin-token'));
  if (!compte) return { ok: false, code: 401, message: 'Session invalide ou expirée' };
  if (verifie?.jti && isSessionInactive(verifie.jti)) {
    return { ok: false, code: 401, message: 'Session verrouillée pour inactivité — reconnecte-toi' };
  }
  if (parCookie && estEcriture(req.method)) {
    const attendu = cookies[CSRF_COOKIE];
    const fourni = entete(CSRF_HEADER);
    if (!attendu || !fourni || fourni !== attendu) {
      return { ok: false, code: 403, message: 'Requête rejetée : preuve anti-CSRF absente ou invalide.' };
    }
  }
  if (!can(compte.role, permission)) return { ok: false, code: 403, message: 'Accès réservé à la supervision' };
  return { ok: true, compte };
}
