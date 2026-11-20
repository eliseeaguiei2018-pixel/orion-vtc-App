import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import type { FastifyRequest } from 'fastify';
import { config } from '../../config/index.js';
import { forbidden, unauthorized } from '../../core/errors.js';

/**
 * Session du CLIENT : délivrée après vérification de son numéro par code SMS.
 *
 * Avant, l'app cliente n'avait aucune preuve d'identité : le code à 4 chiffres était
 * accepté quel qu'il soit, et le profil se modifiait avec le seul identifiant de
 * l'appareil. Le jeton est signé (HS256) avec un secret propre aux clients : il
 * n'ouvre ni l'app chauffeur, ni la console.
 */
const b64url = (buf: Buffer | string): string =>
  Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const sign = (data: string): string => b64url(createHmac('sha256', config.CLIENT_JWT_SECRET).update(data).digest());

interface ClientJwt { sub: string; typ: 'client'; iat: number; exp: number; jti: string }

export function issueClientToken(clientId: string): { token: string; expiresAt: string } {
  const now = Math.floor(Date.now() / 1000);
  const exp = now + config.CLIENT_JWT_TTL_SECONDS;
  const header = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const payload = b64url(JSON.stringify({ sub: clientId, typ: 'client', iat: now, exp, jti: randomUUID() } satisfies ClientJwt));
  const body = `${header}.${payload}`;
  return { token: `${body}.${sign(body)}`, expiresAt: new Date(exp * 1000).toISOString() };
}

export function verifyClientToken(token: string | undefined): string | null {
  if (!token) return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [header, payload, signature] = parts as [string, string, string];
  const a = Buffer.from(signature);
  const b = Buffer.from(sign(`${header}.${payload}`));
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  let data: Partial<ClientJwt>;
  try { data = JSON.parse(Buffer.from(payload, 'base64').toString('utf8')) as Partial<ClientJwt>; } catch { return null; }
  if (data.typ !== 'client' || typeof data.sub !== 'string') return null;
  if (typeof data.exp !== 'number' || data.exp < Math.floor(Date.now() / 1000)) return null;
  return data.sub;
}

/** Exige la session du client visé : son profil, sa photo, son historique sont à lui seul. */
export function requireClient(req: FastifyRequest, clientId: string): void {
  const h = req.headers.authorization;
  const m = h ? /^Bearer\s+(.+)$/i.exec(h.trim()) : null;
  const sub = verifyClientToken(m?.[1]);
  if (!sub) throw unauthorized('Session expirée — vérifiez à nouveau votre numéro');
  if (sub !== clientId) throw forbidden('Ce compte ne vous appartient pas');
}

/**
 * Données d'un client : seul son titulaire connecté y accède. Un identifiant qui ne
 * correspond à aucun compte (passager invité, identifiant aléatoire de l'appareil)
 * n'a pas de session possible ; il reste lisible par l'appareil qui l'a créé.
 */
export function exigerTitulaire(req: FastifyRequest, clientId: string, estCompte: (id: string) => boolean): void {
  if (estCompte(clientId)) requireClient(req, clientId);
}

/* ------------------------------ Photo de profil ------------------------------ */

/** Taille maximale d'une photo décodée : l'app la recadre et la compresse avant envoi. */
export const PHOTO_MAX_OCTETS = 400_000;

/**
 * Valide une photo envoyée en data URL. On vérifie les OCTETS, pas seulement le
 * type déclaré : un fichier quelconque renommé en « image/jpeg » est refusé.
 */
export function validerPhoto(dataUrl: string): { ok: true } | { ok: false; raison: string } {
  const m = /^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl);
  if (!m) return { ok: false, raison: 'Format accepté : photo JPEG, PNG ou WebP.' };
  const octets = Buffer.from(m[2]!, 'base64');
  if (octets.length === 0) return { ok: false, raison: 'Photo vide.' };
  if (octets.length > PHOTO_MAX_OCTETS) return { ok: false, raison: `Photo trop lourde (${Math.round(octets.length / 1000)} Ko, maximum ${PHOTO_MAX_OCTETS / 1000} Ko).` };
  const signatures: Record<string, (b: Buffer) => boolean> = {
    jpeg: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
    png: (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
    webp: (b) => b.subarray(0, 4).toString('ascii') === 'RIFF' && b.subarray(8, 12).toString('ascii') === 'WEBP',
  };
  if (!signatures[m[1]!]!(octets)) return { ok: false, raison: 'Le contenu ne correspond pas à une image.' };
  return { ok: true };
}
