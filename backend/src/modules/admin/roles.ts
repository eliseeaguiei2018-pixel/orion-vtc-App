import { config } from '../../config/index.js';

/**
 * Contrôle d'accès par rôle (RBAC) — couches d'accès selon le poste dans ORION.
 * MVP : un jeton = un compte = un rôle. En production : SSO/JWT + rôles + audit log.
 */
export type Role = 'super_admin' | 'ops' | 'finance' | 'support' | 'viewer';

export type Permission =
  | 'overview:read'
  | 'rides:read' | 'rides:write'
  | 'drivers:read' | 'drivers:write'
  | 'clients:read' | 'clients:write'
  | 'alerts:read' | 'alerts:write'
  | 'pricing:read' | 'pricing:write'
  | 'promos:read' | 'promos:write'
  | 'services:read' | 'services:write'
  | 'support:read' | 'support:write'
  | 'finance:read'
  | 'notify:read' | 'notify:write'
  | 'audit:read'
  | 'roles:read';

const ALL: Permission[] = [
  'overview:read', 'rides:read', 'rides:write', 'drivers:read', 'drivers:write',
  'clients:read', 'clients:write', 'alerts:read', 'alerts:write', 'pricing:read', 'pricing:write',
  'promos:read', 'promos:write', 'services:read', 'services:write', 'support:read', 'support:write',
  'finance:read', 'notify:read', 'notify:write', 'audit:read', 'roles:read',
];

/** Matrice rôle → permissions (couches d'accès selon le poste). */
export const ROLE_PERMISSIONS: Record<Role, Permission[]> = {
  super_admin: ALL,
  ops: ['overview:read', 'rides:read', 'rides:write', 'drivers:read', 'drivers:write', 'clients:read', 'clients:write', 'alerts:read', 'alerts:write', 'support:read', 'support:write', 'services:read', 'notify:read', 'notify:write'],
  finance: ['overview:read', 'rides:read', 'pricing:read', 'pricing:write', 'promos:read', 'promos:write', 'services:read', 'finance:read', 'notify:read'],
  support: ['overview:read', 'rides:read', 'clients:read', 'clients:write', 'alerts:read', 'support:read', 'support:write', 'promos:read', 'notify:read', 'notify:write'],
  viewer: ['overview:read', 'rides:read', 'drivers:read', 'clients:read', 'alerts:read', 'pricing:read', 'promos:read', 'services:read', 'support:read', 'finance:read', 'notify:read'],
};

export const ROLE_LABEL: Record<Role, string> = {
  super_admin: 'Super Admin', ops: 'Opérations / Dispatch', finance: 'Finance',
  support: 'Support client', viewer: 'Observateur',
};

export interface AdminAccount {
  name: string;
  role: Role;
  /** Identifiant de connexion (comptes JWT) ; absent pour les jetons statiques. */
  username?: string;
  /** Jeton statique (compatibilité / automatisation) ; absent pour les comptes JWT. */
  token?: string;
}

const isRole = (r: string): r is Role => r in ROLE_PERMISSIONS;

/** Comptes admin : ADMIN_TOKEN = super_admin, + comptes optionnels (ADMIN_ACCOUNTS JSON). */
export function adminAccounts(): AdminAccount[] {
  const accounts: AdminAccount[] = [{ token: config.ADMIN_TOKEN, name: 'Super Admin', role: 'super_admin' }];
  const raw = config.ADMIN_ACCOUNTS?.trim();
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as Array<{ token: string; name?: string; role: string }>;
      for (const a of parsed) {
        if (a.token && isRole(a.role)) accounts.push({ token: a.token, name: a.name ?? ROLE_LABEL[a.role], role: a.role });
      }
    } catch {
      // ADMIN_ACCOUNTS mal formé → ignoré (seul le super_admin reste actif).
    }
  }
  return accounts;
}

export function resolveAccount(token: string | undefined): AdminAccount | null {
  if (!token) return null;
  return adminAccounts().find((a) => a.token === token) ?? null;
}

export function can(role: Role, perm: Permission): boolean {
  return ROLE_PERMISSIONS[role].includes(perm);
}
