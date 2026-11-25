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
/**
 * Code en attente. Seule son EMPREINTE est gardée (HMAC du numéro et du code) : la base peut
 * la conserver sans jamais contenir un code en clair. Les codes survivent ainsi à un
 * redémarrage du serveur (déploiement) : un chauffeur qui saisit son code juste après
 * n'obtient plus « Code expiré ».
 */
interface PendingOtp { empreinte: string; expiresAt: number; attempts: number; sentAt: number }
export interface OtpEnregistre extends PendingOtp { id: string }
/** Dépôt minimal (même forme que les dépôts du serveur), pour garder les codes en base. */
interface DepotOtp { get(id: string): OtpEnregistre | undefined; put(o: OtpEnregistre): void; delete(id: string): void; all(): OtpEnregistre[] }

const empreinteCode = (phone: string, code: string): string =>
  createHmac('sha256', config.DRIVER_JWT_SECRET).update(`otp|${phone}|${code.replace(/\s/g, '')}`).digest('hex');
const memeEmpreinte = (a: string, b: string): boolean => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));
/** Essais d'un code d'invitation de la console : 5 erreurs bloquent un quart d'heure. */
const FENETRE_INVITATION_MS = 15 * 60_000;

const MAX_ATTEMPTS = 5;
const RESEND_COOLDOWN_MS = 30_000;
/** Plafond de codes par numéro et par heure : chaque SMS est facturé par l'opérateur. */
const MAX_PAR_HEURE = 5;
const HEURE_MS = 3_600_000;

export class OtpStore {
  private readonly pending = new Map<string, PendingOtp>();
  private readonly envois = new Map<string, number[]>();
  private readonly essaisInvitation = new Map<string, { n: number; depuis: number }>();

  constructor(private readonly depot?: DepotOtp) {
    const maintenant = Date.now();
    for (const e of depot?.all() ?? []) {
      if (e.expiresAt > maintenant && typeof e.empreinte === 'string') {
        this.pending.set(e.id, { empreinte: e.empreinte, expiresAt: e.expiresAt, attempts: e.attempts, sentAt: e.sentAt });
      } else depot?.delete(e.id);
    }
  }

  private garder(phone: string, p: PendingOtp): void {
    this.pending.set(phone, p);
    this.depot?.put({ id: phone, ...p });
  }

  private oublier(phone: string): void {
    this.pending.delete(phone);
    this.depot?.delete(phone);
  }

  /**
   * Génère un code à 6 chiffres. Refuse (avec le délai d'attente) si un code vient d'être
   * envoyé, ou si le numéro a déjà reçu 5 codes dans l'heure (`plafond`).
   */
  issue(phone: string, codeImpose?: string): { code: string; expiresAt: string } | { retryInSeconds: number; plafond?: true } {
    const now = Date.now();
    const prev = this.pending.get(phone);
    if (prev && now - prev.sentAt < RESEND_COOLDOWN_MS && prev.expiresAt > now) {
      return { retryInSeconds: Math.ceil((RESEND_COOLDOWN_MS - (now - prev.sentAt)) / 1000) };
    }
    const recents = (this.envois.get(phone) ?? []).filter((t) => now - t < HEURE_MS);
    if (!codeImpose && recents.length >= MAX_PAR_HEURE) {
      return { retryInSeconds: Math.ceil((recents[0]! + HEURE_MS - now) / 1000), plafond: true };
    }
    recents.push(now);
    this.envois.set(phone, recents);
    const code = codeImpose ?? String(randomInt(0, 1_000_000)).padStart(6, '0');
    const expiresAt = now + config.DRIVER_OTP_TTL_SECONDS * 1000;
    this.garder(phone, { empreinte: empreinteCode(phone, code), expiresAt, attempts: 0, sentAt: now });
    return { code, expiresAt: new Date(expiresAt).toISOString() };
  }

  /** Annule le dernier code (SMS non parti) : le client peut en redemander un aussitôt. */
  revoke(phone: string): void {
    this.oublier(phone);
    const recents = this.envois.get(phone);
    if (recents?.length) recents.pop();
  }

  /** Vérifie le code (temps constant). Le code est détruit après succès ou 5 échecs. */
  verify(phone: string, code: string): 'ok' | 'invalid' | 'expired' | 'locked' {
    const p = this.pending.get(phone);
    if (!p) return 'expired';
    if (p.expiresAt < Date.now()) {
      this.oublier(phone);
      return 'expired';
    }
    if (memeEmpreinte(p.empreinte, empreinteCode(phone, code))) {
      this.oublier(phone);
      return 'ok';
    }
    p.attempts += 1;
    if (p.attempts >= MAX_ATTEMPTS) {
      this.oublier(phone);
      return 'locked';
    }
    this.garder(phone, p);
    return 'invalid';
  }

  /**
   * CODE D'ACCÈS DONNÉ PAR LA CONSOLE (testeur invité par la direction) : il reste valable toute
   * sa durée (7 jours par défaut), même si le code envoyé a expiré ou si le serveur a redémarré
   * entre la demande et la saisie. Cinq erreurs bloquent ce recours un quart d'heure.
   */
  verifyInvitation(phone: string, code: string, invitation: string | undefined): boolean {
    if (!invitation) return false;
    const maintenant = Date.now();
    const e = this.essaisInvitation.get(phone);
    const enCours = e && maintenant - e.depuis < FENETRE_INVITATION_MS ? e : null;
    if (enCours && enCours.n >= MAX_ATTEMPTS) return false;
    if (memeEmpreinte(empreinteCode(phone, invitation), empreinteCode(phone, code))) {
      this.essaisInvitation.delete(phone);
      this.oublier(phone);
      return true;
    }
    this.essaisInvitation.set(phone, enCours ? { n: enCours.n + 1, depuis: enCours.depuis } : { n: 1, depuis: maintenant });
    return false;
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
