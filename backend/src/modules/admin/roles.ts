import { config } from '../../config/index.js';

/**
 * Contrôle d'accès par rôle (RBAC) — couches d'accès selon le poste dans ORION.
 *
 * HIÉRARCHIE EXÉCUTIVE : seuls le CEO, le Directeur Général, le Directeur des
 * Affaires Administratives et le Directeur des Opérations ont l'accès COMPLET,
 * y compris l'APPROBATION des virements (treasury:approve). Le Directeur
 * Financier (CFO) voit tout le volet financier et peut DEMANDER un virement
 * (treasury:request) mais ne peut jamais l'exécuter seul : double validation
 * (maker-checker) obligatoire par un dirigeant.
 */
export type Role =
  | 'super_admin' // accès technique complet (équivalent direction)
  | 'ceo'         // Président Directeur Général — accès total
  | 'dg'          // Directeur Général — accès total
  | 'daa'         // Directeur des Affaires Administratives — accès total
  | 'coo'         // Directeur des Opérations — accès total
  | 'cfo'         // Directeur Financier — finance complète, virements sur approbation
  | 'ops'         // Équipe opérations / dispatch
  | 'finance'     // Équipe finance (lecture trésorerie, pas de demande)
  | 'support'     // Support client
  | 'viewer';     // Observateur (lecture seule)

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
  | 'treasury:read' | 'treasury:request' | 'treasury:approve'
  | 'search:read'
  | 'notify:read' | 'notify:write'
  | 'audit:read'
  | 'roles:read';

const ALL: Permission[] = [
  'overview:read', 'rides:read', 'rides:write', 'drivers:read', 'drivers:write',
  'clients:read', 'clients:write', 'alerts:read', 'alerts:write', 'pricing:read', 'pricing:write',
  'promos:read', 'promos:write', 'services:read', 'services:write', 'support:read', 'support:write',
  'finance:read', 'treasury:read', 'treasury:request', 'treasury:approve', 'search:read',
  'notify:read', 'notify:write', 'audit:read', 'roles:read',
];

/** Matrice rôle → permissions (couches d'accès selon le poste). */
export const ROLE_PERMISSIONS: Record<Role, Permission[]> = {
  super_admin: ALL,
  ceo: ALL,
  dg: ALL,
  daa: ALL,
  coo: ALL,
  // CFO : pilotage financier complet + DEMANDE de virement — jamais l'approbation.
  cfo: ['overview:read', 'rides:read', 'pricing:read', 'pricing:write', 'promos:read', 'promos:write', 'services:read', 'finance:read', 'treasury:read', 'treasury:request', 'search:read', 'notify:read', 'audit:read', 'roles:read'],
  ops: ['overview:read', 'rides:read', 'rides:write', 'drivers:read', 'drivers:write', 'clients:read', 'clients:write', 'alerts:read', 'alerts:write', 'support:read', 'support:write', 'services:read', 'search:read', 'notify:read', 'notify:write'],
  finance: ['overview:read', 'rides:read', 'pricing:read', 'promos:read', 'promos:write', 'services:read', 'finance:read', 'treasury:read', 'search:read', 'notify:read'],
  support: ['overview:read', 'rides:read', 'clients:read', 'clients:write', 'alerts:read', 'support:read', 'support:write', 'promos:read', 'search:read', 'notify:read', 'notify:write'],
  viewer: ['overview:read', 'rides:read', 'drivers:read', 'clients:read', 'alerts:read', 'pricing:read', 'promos:read', 'services:read', 'support:read', 'finance:read', 'search:read', 'notify:read'],
};

export const ROLE_LABEL: Record<Role, string> = {
  super_admin: 'Super Admin (technique)',
  ceo: 'CEO — Président Directeur Général',
  dg: 'Directeur Général',
  daa: 'Dir. des Affaires Administratives',
  coo: 'Directeur des Opérations',
  cfo: 'Directeur Financier (CFO)',
  ops: 'Opérations / Dispatch',
  finance: 'Équipe Finance',
  support: 'Support client',
  viewer: 'Observateur',
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
