import { createHmac, scryptSync, randomBytes, timingSafeEqual } from 'node:crypto';
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
          users.push({ username: u.username, name: u.name ?? ROLE_LABEL[u.role], role: u.role, salt: u.salt, hash: u.hash });
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

/** Vérifie les identifiants et renvoie le compte (sans secret) ou null. */
export function login(username: string, password: string): AdminAccount | null {
  const user = adminUsers().find((u) => u.username === username);
  if (!user) return null;
  if (!verifyPassword(password, user.salt, user.hash)) return null;
  return { name: user.name, role: user.role, username: user.username };
}

/* ----------------------------------- JWT ----------------------------------- */
const b64url = (buf: Buffer | string): string =>
  Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

const b64urlJson = (obj: unknown): string => b64url(JSON.stringify(obj));

function sign(data: string): string {
  return b64url(createHmac('sha256', config.ADMIN_JWT_SECRET).update(data).digest());
}

interface JwtPayload { sub: string; name: string; role: Role; iat: number; exp: number; }

/** Émet un JWT HS256 pour un compte. Renvoie le jeton et l'expiration (ISO). */
export function issueToken(account: AdminAccount): { token: string; expiresAt: string } {
  const now = Math.floor(Date.now() / 1000);
  const exp = now + config.ADMIN_JWT_TTL_SECONDS;
  const header = b64urlJson({ alg: 'HS256', typ: 'JWT' });
  const payload = b64urlJson({ sub: account.username ?? account.name, name: account.name, role: account.role, iat: now, exp });
  const body = `${header}.${payload}`;
  return { token: `${body}.${sign(body)}`, expiresAt: new Date(exp * 1000).toISOString() };
}

/** Vérifie signature + expiration d'un JWT et renvoie le compte, ou null. */
export function verifyToken(token: string | undefined): AdminAccount | null {
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
  return { name: data.name, role: data.role, username: data.sub };
}

/** Extrait le jeton Bearer d'un en-tête Authorization. */
export function bearerToken(header: string | undefined): string | undefined {
  if (!header) return undefined;
  const m = /^Bearer\s+(.+)$/i.exec(header.trim());
  return m ? m[1] : undefined;
}
