/**
 * CONSOLE INSTALLÉE SUR TÉLÉPHONE (application Android « ORION Console »).
 *
 * Dans un navigateur, la console sert depuis la même origine que le serveur et garde sa
 * session dans un cookie HttpOnly. L'application téléphone, elle, parle au serveur depuis
 * une autre origine (`https://localhost`) : le cookie ne suit pas. Elle garde donc le jeton
 * de session que le serveur renvoie à la connexion et l'envoie dans l'en-tête
 * Authorization ; pour les canaux temps réel, elle demande un billet à usage unique
 * (`/admin/ws-billet`). La clé d'appareil (si l'enrôlement est exigé) suit le même chemin.
 *
 * L'application n'exécute que son propre code (aucune page tierce) : le jeton y est à
 * l'abri des scripts étrangers, la raison d'être du cookie HttpOnly dans un navigateur.
 */
const CLE_JETON = 'orion.admin.jeton';
const CLE_APPAREIL = 'orion.admin.appareil';

export function consoleNative(): boolean {
  const w = window as unknown as { Capacitor?: { isNativePlatform?: () => boolean } };
  return Boolean(w.Capacitor?.isNativePlatform?.()) || (import.meta.env.VITE_CONSOLE_NATIVE as string | undefined) === '1';
}

const lire = (k: string): string | null => { try { return localStorage.getItem(k); } catch { return null; } };
const ecrire = (k: string, v: string | null) => { try { if (v) localStorage.setItem(k, v); else localStorage.removeItem(k); } catch { /* stockage indisponible */ } };

export const jetonNatif = (): string | null => (consoleNative() ? lire(CLE_JETON) : null);
export const garderJetonNatif = (jeton: string | null): void => { if (consoleNative()) ecrire(CLE_JETON, jeton); };
export const garderCleAppareil = (cle: string | null): void => { if (consoleNative()) ecrire(CLE_APPAREIL, cle); };

/** En-têtes propres à l'application téléphone : session et appareil. */
export function enTetesNatifs(): Record<string, string> {
  if (!consoleNative()) return {};
  const h: Record<string, string> = {};
  const jeton = lire(CLE_JETON);
  if (jeton) h['authorization'] = `Bearer ${jeton}`;
  const appareil = lire(CLE_APPAREIL);
  if (appareil) h['x-orion-appareil'] = appareil;
  return h;
}
