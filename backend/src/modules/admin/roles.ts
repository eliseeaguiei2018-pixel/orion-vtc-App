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
  | 'clients:read'
  | 'alerts:read' | 'alerts:write'
  | 'pricing:read' | 'pricing:write'
  | 'roles:read';

const ALL: Permission[] = [
  'overview:read', 'rides:read', 'rides:write', 'drivers:read', 'drivers:write',
  'clients:read', 'alerts:read', 'alerts:write', 'pricing:read', 'pricing:write', 'roles:read',
];

/** Matrice rôle → permissions (couches d'accès). */
export const ROLE_PERMISSIONS: Record<Role, Permission[]> = {
  super_admin: ALL,
  ops: ['overview:read', 'rides:read', 'rides:write', 'drivers:read', 'drivers:write', 'clients:read', 'alerts:read', 'alerts:write'],
  finance: ['overview:read', 'rides:read', 'pricing:read', 'pricing:write'],
  support: ['overview:read', 'rides:read', 'clients:read', 'alerts:read'],
  viewer: ['overview:read', 'rides:read', 'drivers:read', 'clients:read', 'alerts:read', 'pricing:read'],
};

export const ROLE_LABEL: Record<Role, string> = {
  super_admin: 'Super Admin', ops: 'Opérations / Dispatch', finance: 'Finance',
  support: 'Support client', viewer: 'Observateur',
};

export interface AdminAccount {
  token: string;
  name: string;
  role: Role;
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
