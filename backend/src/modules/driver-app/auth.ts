import { createHmac, randomInt, randomUUID, timingSafeEqual } from 'node:crypto';
import type { FastifyRequest } from 'fastify';
import { config } from '../../config/index.js';
import { forbidden, unauthorized } from '../../core/errors.js';

/**
 * Authentification de l'APP CHAUFFEUR : téléphone + code à usage unique (SMS) → jeton
 * signé HS256 (module `node:crypto`, zéro dépendance), avec un secret DISTINCT de celui
 * de la console : un jeton chauffeur ne peut jamais ouvrir la console, et inversement.
 *
 * En développement, le code est renvoyé dans la réponse (`devCode`) pour tester sans
 * opérateur SMS. En production il part par SMS et n'est JAMAIS renvoyé.
 */

/** Normalise un numéro ivoirien : chiffres seuls, indicatif 225 ajouté si absent. */
export function normalizePhone(raw: string): string | null {
  const digits = raw.replace(/\D/g, '');
  if (digits.length === 10) return `+225${digits}`;
  if (digits.length === 13 && digits.startsWith('225')) return `+${digits}`;
  if (digits.length >= 8 && digits.length <= 15) return `+${digits}`;
  return null;
}

/* ------------------------------ Codes SMS (OTP) ------------------------------ */
interface PendingOtp { code: string; expiresAt: number; attempts: number; sentAt: number }

const MAX_ATTEMPTS = 5;
const RESEND_COOLDOWN_MS = 30_000;

export class OtpStore {
  private readonly pending = new Map<string, PendingOtp>();

  /** Génère un code à 6 chiffres. Renvoie null si un code vient d'être envoyé (anti-spam). */
  issue(phone: string): { code: string; expiresAt: string } | { retryInSeconds: number } {
    const now = Date.now();
    const prev = this.pending.get(phone);
    if (prev && now - prev.sentAt < RESEND_COOLDOWN_MS && prev.expiresAt > now) {
      return { retryInSeconds: Math.ceil((RESEND_COOLDOWN_MS - (now - prev.sentAt)) / 1000) };
    }
    const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
    const expiresAt = now + config.DRIVER_OTP_TTL_SECONDS * 1000;
    this.pending.set(phone, { code, expiresAt, attempts: 0, sentAt: now });
    return { code, expiresAt: new Date(expiresAt).toISOString() };
  }

  /** Vérifie le code (temps constant). Le code est détruit après succès ou 5 échecs. */
  verify(phone: string, code: string): 'ok' | 'invalid' | 'expired' | 'locked' {
    const p = this.pending.get(phone);
    if (!p) return 'expired';
    if (p.expiresAt < Date.now()) {
      this.pending.delete(phone);
      return 'expired';
    }
    const a = Buffer.from(p.code);
    const b = Buffer.from(code.replace(/\s/g, ''));
    if (a.length === b.length && timingSafeEqual(a, b)) {
      this.pending.delete(phone);
      return 'ok';
    }
    p.attempts += 1;
    if (p.attempts >= MAX_ATTEMPTS) {
      this.pending.delete(phone);
      return 'locked';
    }
    return 'invalid';
  }
}

/* ------------------------------- Jeton chauffeur ------------------------------ */
const b64url = (buf: Buffer | string): string =>
  Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

function sign(data: string): string {
  return b64url(createHmac('sha256', config.DRIVER_JWT_SECRET).update(data).digest());
}

interface DriverJwt { sub: string; typ: 'driver'; iat: number; exp: number; jti: string }

/** Émet un jeton chauffeur (sub = id chauffeur). */
export function issueDriverToken(driverId: string): { token: string; expiresAt: string } {
  const now = Math.floor(Date.now() / 1000);
  const exp = now + config.DRIVER_JWT_TTL_SECONDS;
  const header = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const payload = b64url(JSON.stringify({ sub: driverId, typ: 'driver', iat: now, exp, jti: randomUUID() } satisfies DriverJwt));
  const body = `${header}.${payload}`;
  return { token: `${body}.${sign(body)}`, expiresAt: new Date(exp * 1000).toISOString() };
}

/** Vérifie signature + expiration + type. Renvoie l'id chauffeur ou null. */
export function verifyDriverToken(token: string | undefined): string | null {
  if (!token) return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [header, payload, signature] = parts as [string, string, string];
  const a = Buffer.from(signature);
  const b = Buffer.from(sign(`${header}.${payload}`));
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  let data: Partial<DriverJwt>;
  try {
    data = JSON.parse(Buffer.from(payload, 'base64').toString('utf8')) as Partial<DriverJwt>;
  } catch {
    return null;
  }
  if (data.typ !== 'driver' || typeof data.sub !== 'string') return null;
  if (typeof data.exp !== 'number' || data.exp < Math.floor(Date.now() / 1000)) return null;
  return data.sub;
}

/** Jeton présenté par la requête : en-tête Authorization: Bearer, ou ?token= (WebSocket). */
export function driverTokenOf(req: FastifyRequest): string | undefined {
  const h = req.headers.authorization;
  const m = h ? /^Bearer\s+(.+)$/i.exec(h.trim()) : null;
  if (m) return m[1];
  const q = (req.query as Record<string, unknown> | undefined)?.['token'];
  return typeof q === 'string' && q.length > 0 ? q : undefined;
}

/** Exige un jeton chauffeur valide ET correspondant au chauffeur visé. */
export function requireDriver(req: FastifyRequest, driverId: string): void {
  const sub = verifyDriverToken(driverTokenOf(req));
  if (!sub) throw unauthorized('Session chauffeur absente ou expirée — reconnectez-vous');
  if (sub !== driverId) throw forbidden('Ce compte chauffeur ne vous appartient pas');
}

/** La requête vient-elle de l'app chauffeur (jeton chauffeur valide présenté) ? */
export function fromDriverApp(req: FastifyRequest): boolean {
  return verifyDriverToken(driverTokenOf(req)) !== null;
}
