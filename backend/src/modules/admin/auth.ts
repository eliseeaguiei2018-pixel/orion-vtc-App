import { createHmac, scryptSync, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { config } from '../../config/index.js';
import { ROLE_PERMISSIONS, ROLE_LABEL, type AdminAccount, type Role } from './roles.js';

/**
 * Authentification de la console ORION : login + mot de passe → session JWT signée.
 * Zéro dépendance externe — JWT HS256 et hachage scrypt via le module `node:crypto`.
 *
 * En production : définir ADMIN_JWT_SECRET (secret fort) et ADMIN_USERS (mots de passe
 * hachés, jamais en clair). En dev : un compte super_admin par défaut est fourni
 * (ADMIN_USERNAME / ADMIN_PASSWORD).
 */

const isRole = (r: string): r is Role => r in ROLE_PERMISSIONS;

/* ------------------------------- Mots de passe ------------------------------ */
const KEYLEN = 32;

/** Hache un mot de passe avec scrypt + sel (renvoie sel + empreinte en hex). */
export function hashPassword(password: string, salt = randomBytes(16).toString('hex')): { salt: string; hash: string } {
  const hash = scryptSync(password, salt, KEYLEN).toString('hex');
  return { salt, hash };
}

/** Vérifie un mot de passe en temps constant (anti-timing). */
function verifyPassword(password: string, salt: string, expectedHex: string): boolean {
  let actual: Buffer;
  try {
    actual = scryptSync(password, salt, KEYLEN);
  } catch {
    return false;
  }
  let expected: Buffer;
  try {
    expected = Buffer.from(expectedHex, 'hex');
  } catch {
    return false;
  }
  return expected.length === actual.length && timingSafeEqual(actual, expected);
}

/* --------------------------------- Comptes --------------------------------- */
export interface AdminUser {
  username: string;
  name: string;
  role: Role;
  salt: string;
  hash: string;
  /** Secret TOTP (base32) — 2FA obligatoire à la connexion si présent. */
  totp?: string;
}

/**
 * Liste des comptes de connexion. ADMIN_USERS (JSON, mots de passe hachés) si fourni ;
 * sinon un compte super_admin par défaut dérivé de ADMIN_USERNAME / ADMIN_PASSWORD.
 */
export function adminUsers(): AdminUser[] {
  const raw = config.ADMIN_USERS?.trim();
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as Array<Partial<AdminUser>>;
      const users: AdminUser[] = [];
      for (const u of parsed) {
        if (u.username && u.salt && u.hash && u.role && isRole(u.role)) {
          users.push({ username: u.username, name: u.name ?? ROLE_LABEL[u.role], role: u.role, salt: u.salt, hash: u.hash, totp: u.totp });
        }
      }
      if (users.length > 0) return users;
    } catch {
      // ADMIN_USERS mal formé → on retombe sur le compte par défaut.
    }
  }
  const { salt, hash } = hashPassword(config.ADMIN_PASSWORD);
  return [{ username: config.ADMIN_USERNAME, name: 'Super Admin', role: 'super_admin', salt, hash }];
}

/** Vérifie les identifiants et renvoie l'utilisateur COMPLET (avec secret TOTP) ou null. */
export function authenticate(username: string, password: string): AdminUser | null {
  const user = adminUsers().find((u) => u.username === username);
  if (!user) return null;
  if (!verifyPassword(password, user.salt, user.hash)) return null;
  return user;
}

/** Vérifie les identifiants et renvoie le compte (sans secret) ou null. */
export function login(username: string, password: string): AdminAccount | null {
  const user = authenticate(username, password);
  return user ? { name: user.name, role: user.role, username: user.username } : null;
}

/* ------------------------ 2FA TOTP (RFC 6238) ------------------------------ */
const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

/** Décode un secret base32 (RFC 4648, sans padding) en Buffer. */
function base32Decode(input: string): Buffer {
  const clean = input.toUpperCase().replace(/[^A-Z2-7]/g, '');
  let bits = 0, value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    value = (value << 5) | B32.indexOf(ch);
    bits += 5;
    if (bits >= 8) { out.push((value >>> (bits - 8)) & 0xff); bits -= 8; }
  }
  return Buffer.from(out);
}

/** Encode un Buffer en base32 (pour générer les secrets d'enrôlement). */
export function base32Encode(buf: Buffer): string {
  let bits = 0, value = 0, out = '';
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) { out += B32[(value >>> (bits - 5)) & 31]; bits -= 5; }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}

/** Code TOTP à 6 chiffres pour un secret base32 (pas de 30 s, HMAC-SHA1). */
export function totp(secret: string, timeMs = Date.now()): string {
  const counter = Math.floor(timeMs / 1000 / 30);
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(counter));
  const digest = createHmac('sha1', base32Decode(secret)).update(msg).digest();
  const offset = digest[digest.length - 1]! & 0x0f;
  const code = ((digest.readUInt32BE(offset) & 0x7fffffff) % 1_000_000);
  return String(code).padStart(6, '0');
}

/** Vérifie un code TOTP avec une fenêtre de tolérance ±1 pas (dérive d'horloge). */
export function verifyTotp(secret: string, code: string): boolean {
  const c = code.replace(/\s/g, '');
  if (!/^\d{6}$/.test(c)) return false;
  const now = Date.now();
  for (const drift of [0, -30_000, 30_000]) {
    const expected = totp(secret, now + drift);
    if (expected.length === c.length && timingSafeEqual(Buffer.from(expected), Buffer.from(c))) return true;
  }
  return false;
}

/* ------------------------- Sessions actives (JWT) --------------------------- */
export interface ActiveSession {
  id: string;           // jti du JWT
  username: string;
  name: string;
  role: Role;
  ip?: string;
  userAgent?: string;
  createdAt: string;
  lastSeenAt: string;
  expiresAt: string;
  revoked?: boolean;
}

const sessions = new Map<string, ActiveSession>();

/** Purge paresseuse des sessions expirées (évite la croissance infinie). */
function pruneSessions(): void {
  const now = Date.now();
  for (const [id, s] of sessions) {
    if (Date.parse(s.expiresAt) < now) sessions.delete(id);
  }
}

export function registerSession(s: Omit<ActiveSession, 'lastSeenAt'>): void {
  pruneSessions();
  sessions.set(s.id, { ...s, lastSeenAt: s.createdAt });
}

/** Met à jour la dernière activité (appelée à chaque requête authentifiée). */
export function touchSession(id: string, ip?: string): void {
  const s = sessions.get(id);
  if (s) { s.lastSeenAt = new Date().toISOString(); if (ip) s.ip = ip; }
}

/** Révoque une session : le JWT associé est refusé immédiatement. */
export function revokeSession(id: string): boolean {
  const s = sessions.get(id);
  if (!s) return false;
  s.revoked = true;
  return true;
}

export function isSessionRevoked(id: string): boolean {
  return sessions.get(id)?.revoked === true;
}

/** Sessions actives (non expirées), plus récentes d'abord. */
export function listSessions(): ActiveSession[] {
  pruneSessions();
  return [...sessions.values()].sort((a, b) => b.lastSeenAt.localeCompare(a.lastSeenAt));
}

/* --------------------- Anti-brute-force (verrouillage) --------------------- */
const MAX_FAILS = 5;
const LOCK_MS = 15 * 60_000; // 15 minutes

const attempts = new Map<string, { fails: number; lockedUntil: number }>();

/** Secondes restantes de verrouillage pour ce compte (0 = non verrouillé). */
export function lockedFor(username: string): number {
  const a = attempts.get(username);
  if (!a) return 0;
  const remaining = a.lockedUntil - Date.now();
  return remaining > 0 ? Math.ceil(remaining / 1000) : 0;
}

/** Enregistre un échec ; verrouille le compte après MAX_FAILS tentatives. */
export function recordLoginFailure(username: string): void {
  const a = attempts.get(username) ?? { fails: 0, lockedUntil: 0 };
  a.fails += 1;
  if (a.fails >= MAX_FAILS) {
    a.lockedUntil = Date.now() + LOCK_MS;
    a.fails = 0; // le compteur repart après le verrou
  }
  attempts.set(username, a);
}

/** Réinitialise le compteur après une connexion réussie. */
export function clearLoginFailures(username: string): void {
  attempts.delete(username);
}

/* ----------------------------------- JWT ----------------------------------- */
const b64url = (buf: Buffer | string): string =>
  Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

const b64urlJson = (obj: unknown): string => b64url(JSON.stringify(obj));

function sign(data: string): string {
  return b64url(createHmac('sha256', config.ADMIN_JWT_SECRET).update(data).digest());
}

interface JwtPayload { sub: string; name: string; role: Role; iat: number; exp: number; jti: string; }

/** Émet un JWT HS256 pour un compte. Renvoie le jeton, l'expiration (ISO) et le jti (session). */
export function issueToken(account: AdminAccount): { token: string; expiresAt: string; jti: string } {
  const now = Math.floor(Date.now() / 1000);
  const exp = now + config.ADMIN_JWT_TTL_SECONDS;
  const jti = randomUUID();
  const header = b64urlJson({ alg: 'HS256', typ: 'JWT' });
  const payload = b64urlJson({ sub: account.username ?? account.name, name: account.name, role: account.role, iat: now, exp, jti });
  const body = `${header}.${payload}`;
  return { token: `${body}.${sign(body)}`, expiresAt: new Date(exp * 1000).toISOString(), jti };
}

/** Vérifie signature + expiration d'un JWT et renvoie le compte (+ jti), ou null. */
export function verifyToken(token: string | undefined): (AdminAccount & { jti?: string }) | null {
  if (!token) return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [header, payload, signature] = parts as [string, string, string];
  const expected = sign(`${header}.${payload}`);
  // Comparaison en temps constant de la signature.
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  let data: JwtPayload;
  try {
    data = JSON.parse(Buffer.from(payload, 'base64').toString('utf8')) as JwtPayload;
  } catch {
    return null;
  }
  if (!data.role || !isRole(data.role)) return null;
  if (typeof data.exp !== 'number' || data.exp < Math.floor(Date.now() / 1000)) return null;
  // Session révoquée depuis la console → jeton refusé immédiatement.
  if (data.jti && isSessionRevoked(data.jti)) return null;
  return { name: data.name, role: data.role, username: data.sub, jti: data.jti };
}

/** Extrait le jeton Bearer d'un en-tête Authorization. */
export function bearerToken(header: string | undefined): string | undefined {
  if (!header) return undefined;
  const m = /^Bearer\s+(.+)$/i.exec(header.trim());
  return m ? m[1] : undefined;
}
