import { createHmac, timingSafeEqual } from 'node:crypto';
import { config } from '../../config/index.js';

/**
 * PHOTO DU CHAUFFEUR : adresse SIGNÉE et EXPIRANTE.
 *
 * L'identifiant d'un chauffeur ne suffit plus à voir sa photo : le serveur ne remet une
 * adresse valable (24 h au plus) qu'aux personnes qui ont le droit de la voir — son
 * passager pendant la course, le contact de confiance de ce passager, la console, le
 * chauffeur lui-même. Une adresse copiée ailleurs cesse de fonctionner à l'expiration.
 */
const VALIDITE_MS = 24 * 3_600_000;
const PALIER_MS = 3_600_000;

const signer = (id: string, v: string, exp: number) =>
  createHmac('sha256', `${config.DRIVER_JWT_SECRET}:photo`).update(`${id}|${v}|${exp}`).digest('base64url').slice(0, 32);

/** Adresse signée de la photo (null si le chauffeur n'en a pas). */
export function photoUrl(d: { id: string; photoUpdatedAt?: string }, now = Date.now()): string | null {
  if (!d.photoUpdatedAt) return null;
  // Expiration arrondie à l'heure : l'adresse reste stable une heure (cache du navigateur).
  const exp = Math.ceil((now + VALIDITE_MS) / PALIER_MS) * PALIER_MS;
  const v = d.photoUpdatedAt;
  return `/drivers/${encodeURIComponent(d.id)}/photo?v=${encodeURIComponent(v)}&exp=${exp}&sig=${signer(d.id, v, exp)}`;
}

/** La signature présentée est-elle valide et non expirée pour cette photo ? */
export function signatureValide(id: string, v: string | undefined, exp: string | undefined, sig: string | undefined, now = Date.now()): boolean {
  if (!v || !exp || !sig) return false;
  const e = Number(exp);
  if (!Number.isFinite(e) || e < now || e > now + VALIDITE_MS + PALIER_MS) return false;
  const a = Buffer.from(sig);
  const b = Buffer.from(signer(id, v, e));
  return a.length === b.length && timingSafeEqual(a, b);
}
