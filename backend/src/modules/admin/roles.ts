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
  | 'fleet_manager'     // Gestionnaire de flotte — validation chauffeurs, véhicules, dispatch
  | 'financial_analyst' // Analyste financier — exports, factures, paiements (lecture)
  | 'manager'           // Chef d'équipe — supervise SON équipe et sa flotte affiliée
  | 'agent'             // Membre d'équipe — gère la flotte que son manager lui accrédite
  | 'daf'               // Directeur Administratif et Financier — demande ET statue
  | 'tresorier'         // Trésorier(ère) — tient sa caisse, compte les espèces, verse
  | 'chauffeur'         // Chauffeur ORION — son dossier et ses requêtes, rien d'autre
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
  /** Statuer sur une demande financière (note de frais, avance, prêt chauffeur). */
  | 'finance:write'
  | 'treasury:read' | 'treasury:request' | 'treasury:approve'
  /**
   * CAISSE NOMINATIVE : ouvrir sa caisse, y enregistrer les espèces reçues, les
   * compter coupure par coupure et arrêter la caisse. Chaque trésorier ne touche
   * QUE la sienne — la portée est imposée côté serveur.
   */
  | 'caisse:read' | 'caisse:write'
  | 'sessions:read' | 'sessions:write'
  | 'teams:read' | 'teams:write'
  | 'search:read'
  | 'notify:read' | 'notify:write'
  | 'audit:read'
  /** Location Signature (événements, entreprises, mise à disposition) + abonnements. */
  | 'rental:read' | 'rental:write'
  /**
   * DIRECTION GÉNÉRALE : vue consolidée de TOUS les flux financiers, décisions en
   * attente, journal des décisions des directeurs. Réservée à la direction.
   */
  | 'executive:read'
  /** Moteur de vigilance : constats et état de santé de la plateforme. */
  | 'vigilance:read'
  /**
   * ÉQUIPAGES : le dossier des chauffeurs ORION et leurs requêtes.
   * `crew:self` est le droit minimal du chauffeur lui-même — il ne voit que SON
   * dossier et ne dépose que SES requêtes.
   */
  | 'crew:read' | 'crew:write' | 'crew:self'
  /** Annuaire du personnel : créer et gérer les identifiants de connexion. */
  | 'accounts:read' | 'accounts:write'
  /** Alertes sécurité interne (tentatives d'accès non autorisé) — direction uniquement. */
  | 'security:read'
  | 'roles:read';

const ALL: Permission[] = [
  'overview:read', 'rides:read', 'rides:write', 'drivers:read', 'drivers:write',
  'clients:read', 'clients:write', 'alerts:read', 'alerts:write', 'pricing:read', 'pricing:write',
  'promos:read', 'promos:write', 'services:read', 'services:write', 'support:read', 'support:write',
  'finance:read', 'treasury:read', 'treasury:request', 'treasury:approve',
  'sessions:read', 'sessions:write', 'teams:read', 'teams:write', 'search:read',
  'notify:read', 'notify:write', 'audit:read', 'security:read', 'roles:read',
  'rental:read', 'rental:write', 'executive:read', 'vigilance:read',
  'finance:write', 'caisse:read', 'caisse:write',
  'crew:read', 'crew:write', 'crew:self',
  'accounts:read', 'accounts:write',
];

/** Matrice rôle → permissions (couches d'accès selon le poste). */
export const ROLE_PERMISSIONS: Record<Role, Permission[]> = {
  super_admin: ALL,
  ceo: ALL,
  dg: ALL,
  daa: ALL,
  coo: ALL,
  // CFO : pilotage financier complet + DEMANDE de virement — jamais l'approbation.
  cfo: ['overview:read', 'rides:read', 'pricing:read', 'pricing:write', 'promos:read', 'promos:write', 'services:read', 'finance:read', 'finance:write', 'treasury:read', 'treasury:request', 'caisse:read', 'search:read', 'notify:read', 'audit:read', 'security:read', 'roles:read', 'rental:read', 'executive:read', 'vigilance:read', 'crew:read'],
  // DAF : même périmètre financier que le CFO. Il DÉPOSE des demandes et STATUE sur
  // celles des autres — jamais sur la sienne, la séparation est imposée au service.
  daf: ['overview:read', 'rides:read', 'drivers:read', 'pricing:read', 'promos:read', 'services:read', 'finance:read', 'finance:write', 'treasury:read', 'treasury:request', 'caisse:read', 'caisse:write', 'search:read', 'notify:read', 'audit:read', 'roles:read', 'rental:read', 'executive:read', 'vigilance:read', 'crew:read', 'crew:write', 'teams:read'],
  // Trésorier(ère) : sa caisse, les espèces qu'il/elle encaisse, ses versements et ses
  // demandes. Aucune approbation : compter et faire approuver sont deux métiers.
  tresorier: ['overview:read', 'finance:read', 'treasury:read', 'treasury:request', 'caisse:read', 'caisse:write', 'drivers:read', 'search:read', 'notify:read', 'crew:read'],
  // Gestionnaire de flotte : validation chauffeurs (KYC), véhicules, surveillance dispatch.
  fleet_manager: ['overview:read', 'rides:read', 'rides:write', 'drivers:read', 'drivers:write', 'alerts:read', 'teams:read', 'teams:write', 'search:read', 'notify:read', 'rental:read', 'rental:write', 'vigilance:read'],
  // Analyste financier : accès RESTREINT en lecture — exports, factures, paiements chauffeurs.
  financial_analyst: ['overview:read', 'rides:read', 'finance:read', 'treasury:read', 'search:read', 'audit:read', 'rental:read'],
  // Chef d'équipe : supervise SON équipe (portée réduite imposée côté serveur sur /admin/teams
  // et sur les actions chauffeurs — uniquement les membres de sa flotte affiliée).
  manager: ['overview:read', 'rides:read', 'drivers:read', 'drivers:write', 'teams:read', 'teams:write', 'accounts:read', 'accounts:write', 'search:read', 'notify:read', 'notify:write', 'crew:read', 'crew:write', 'alerts:read', 'support:read', 'rental:read'],
  // Agent d'équipe : travaille sur la flotte que SON manager lui a accréditée.
  // Hors de cette flotte, il ne voit rien et ne peut rien faire.
  agent: ['overview:read', 'rides:read', 'drivers:read', 'drivers:write', 'teams:read', 'search:read', 'notify:read', 'crew:read', 'crew:write', 'alerts:read', 'support:read'],
  // Chauffeur : son dossier, ses courses, ses revenus, ses requêtes. Rien d'autre.
  // Aucune donnée d'un autre chauffeur, aucun chiffre d'entreprise.
  chauffeur: ['crew:self'],
  ops: ['overview:read', 'rides:read', 'rides:write', 'drivers:read', 'drivers:write', 'clients:read', 'clients:write', 'alerts:read', 'alerts:write', 'support:read', 'support:write', 'services:read', 'search:read', 'notify:read', 'notify:write', 'rental:read', 'rental:write', 'vigilance:read'],
  finance: ['overview:read', 'rides:read', 'pricing:read', 'promos:read', 'promos:write', 'services:read', 'finance:read', 'treasury:read', 'search:read', 'notify:read'],
  support: ['overview:read', 'rides:read', 'clients:read', 'clients:write', 'alerts:read', 'support:read', 'support:write', 'promos:read', 'search:read', 'notify:read', 'notify:write', 'rental:read', 'rental:write', 'vigilance:read'],
  viewer: ['overview:read', 'rides:read', 'drivers:read', 'clients:read', 'alerts:read', 'pricing:read', 'promos:read', 'services:read', 'support:read', 'finance:read', 'search:read', 'notify:read', 'rental:read', 'vigilance:read'],
};

export const ROLE_LABEL: Record<Role, string> = {
  super_admin: 'Super Admin (technique)',
  ceo: 'CEO — Président Directeur Général',
  dg: 'Directeur Général',
  daa: 'Dir. des Affaires Administratives',
  coo: 'Directeur des Opérations',
  cfo: 'Directeur Financier (CFO)',
  fleet_manager: 'Gestionnaire de Flotte',
  financial_analyst: 'Analyste Financier',
  manager: 'Chef d’équipe',
  agent: 'Agent d’équipe',
  daf: 'Directeur Administratif et Financier (DAF)',
  tresorier: 'Trésorier(ère)',
  chauffeur: 'Chauffeur ORION',
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
