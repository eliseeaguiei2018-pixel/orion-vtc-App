import { randomBytes } from 'node:crypto';
import type { AdminAccount } from './roles.js';

/**
 * BILLETS DE CONNEXION TEMPS RÉEL (console installée sur téléphone).
 *
 * Dans un navigateur, la console ouvre ses canaux WebSocket avec son cookie de session.
 * L'application console Android, elle, parle au serveur depuis une autre origine : le
 * cookie ne suit pas, et un WebSocket ne peut pas porter d'en-tête Authorization. Elle
 * demande donc, avec sa session, un billet à usage unique valable 60 secondes, qu'elle
 * présente en ouvrant le canal (`?billet=`). Le jeton de session n'apparaît jamais dans
 * une adresse (journaux, historique).
 */
const DUREE_MS = 60_000;
const billets = new Map<string, { compte: AdminAccount; jti?: string; expire: number }>();

export function emettreBillet(compte: AdminAccount & { jti?: string }): { billet: string; expireDansSecondes: number } {
  const maintenant = Date.now();
  if (billets.size > 5000) for (const [k, b] of billets) if (b.expire <= maintenant) billets.delete(k);
  const billet = randomBytes(24).toString('base64url');
  billets.set(billet, { compte: { name: compte.name, role: compte.role, username: compte.username }, jti: compte.jti, expire: maintenant + DUREE_MS });
  return { billet, expireDansSecondes: DUREE_MS / 1000 };
}

/** Consomme le billet (usage unique) : le compte du personnel, ou null s'il est inconnu ou expiré. */
export function consommerBillet(billet: string | undefined): (AdminAccount & { jti?: string }) | null {
  if (!billet) return null;
  const b = billets.get(billet);
  billets.delete(billet);
  if (!b || b.expire <= Date.now()) return null;
  return { ...b.compte, jti: b.jti };
}
