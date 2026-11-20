import { randomBytes } from 'node:crypto';
import type { Repository } from '../../core/db/repository.js';
import { hashPassword, verifyPassword, type AdminUser } from '../admin/auth.js';
import { ROLE_LABEL, ROLE_PERMISSIONS, type Role } from '../admin/roles.js';

/**
 * ANNUAIRE DU PERSONNEL ORION — qui travaille ici, et avec quel identifiant.
 *
 * Jusqu'ici les comptes de la console venaient UNIQUEMENT de la variable
 * d'environnement ADMIN_USERS : pour ouvrir un accès à une nouvelle trésorière ou
 * à un chauffeur, il fallait éditer la configuration du serveur et redémarrer.
 * Autant dire que personne n'aurait de compte. Une entreprise embauche, mute et
 * fait partir des gens toutes les semaines ; cela se fait depuis la console.
 *
 * L'annuaire persiste les comptes, et l'authentification les consulte en plus de
 * la configuration. Les comptes d'environnement restent prioritaires et ne sont
 * jamais modifiables depuis l'écran : le compte de secours de l'administrateur
 * technique ne doit pas pouvoir être supprimé par erreur depuis l'interface.
 *
 * Le mot de passe n'est JAMAIS stocké en clair ni relisible : à la création, un
 * mot de passe provisoire est renvoyé UNE SEULE FOIS à celui qui crée le compte,
 * à charge pour lui de le transmettre. La personne doit le changer à sa première
 * connexion.
 */

export interface StaffAccount {
  /** Clé de persistance : identique à `username` (un identifiant est unique). */
  id: string;
  username: string;
  name: string;
  role: Role;
  salt: string;
  hash: string;
  /** Secret TOTP (base32) — 2FA à la connexion si présent. */
  totp?: string;
  /** Service de rattachement (Opérations, Finances, Support…). */
  service?: string;
  phone?: string;
  email?: string;
  /** Matricule interne de l'employé (distinct du matricule véhicule). */
  matricule?: string;
  /** Équipe de rattachement, pour un membre d'équipe. */
  teamId?: string;
  /** Compte chauffeur : la fiche chauffeur à laquelle il donne accès. */
  driverId?: string;
  active: boolean;
  /** Vrai tant que la personne n'a pas remplacé son mot de passe provisoire. */
  mustChangePassword: boolean;
  createdAt: string;
  createdBy: string;
  updatedAt?: string;
  lastLoginAt?: string;
  /** Motif de désactivation (départ, suspension) — jamais de suppression muette. */
  disabledReason?: string;
}

/** Ce que l'on peut montrer à l'écran : ni sel, ni empreinte, ni secret TOTP. */
export type StaffAccountPublic = Omit<StaffAccount, 'id' | 'salt' | 'hash' | 'totp'> & {
  roleLabel: string;
  has2fa: boolean;
  permissions: number;
};

/** Identifiant de connexion lisible, dérivé du nom : « Awa Diomandé » → « awa.diomande ». */
export function identifiantDepuisNom(nom: string, pris: (u: string) => boolean): string {
  const base = nom
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/['’]/g, '')
    .split(/\s+/).filter(Boolean).slice(0, 2).join('.')
    .replace(/[^a-z0-9.]/g, '') || 'agent';
  if (!pris(base)) return base;
  for (let i = 2; i < 100; i += 1) {
    const essai = `${base}${i}`;
    if (!pris(essai)) return essai;
  }
  return `${base}.${randomBytes(2).toString('hex')}`;
}

/**
 * Mot de passe provisoire lisible à l'oral : on le dicte au téléphone à un
 * chauffeur. Pas de caractères ambigus (0/O, 1/l/I) — un mot de passe qu'on
 * saisit de travers trois fois finit sur un bout de papier collé à l'écran.
 */
const ALPHABET = 'abcdefghjkmnpqrstuvwxyz';
const CHIFFRES = '23456789';
export function motDePasseProvisoire(): string {
  const lettres = Array.from(randomBytes(6), (b) => ALPHABET[b % ALPHABET.length]).join('');
  const chiffres = Array.from(randomBytes(3), (b) => CHIFFRES[b % CHIFFRES.length]).join('');
  return `${lettres}-${chiffres}`;
}

const MDP_MIN = 10;

export type CreationResult =
  | { ok: true; account: StaffAccountPublic; motDePasseProvisoire: string }
  | { ok: false; raison: 'identifiant_pris' | 'chauffeur_deja_lie' };

export class StaffAccountService {
  private readonly comptes = new Map<string, StaffAccount>();
  /** Identifiants venant de la configuration : intouchables depuis la console. */
  private readonly proteges = new Set<string>();

  constructor(private readonly repo?: Repository<StaffAccount>) {
    for (const c of repo?.all() ?? []) this.comptes.set(c.username, c);
  }

  /** Déclare les comptes de configuration, pour ne jamais les écraser. */
  protege(usernames: string[]): void {
    for (const u of usernames) this.proteges.add(u);
  }

  estProtege(username: string): boolean { return this.proteges.has(username); }

  private publier(c: StaffAccount): StaffAccountPublic {
    const { id: _i, salt: _s, hash: _h, totp, ...reste } = c;
    return {
      ...reste,
      roleLabel: ROLE_LABEL[c.role],
      has2fa: Boolean(totp),
      permissions: (ROLE_PERMISSIONS[c.role] ?? []).length,
    };
  }

  creer(input: {
    name: string;
    role: Role;
    username?: string;
    service?: string;
    phone?: string;
    email?: string;
    matricule?: string;
    teamId?: string;
    driverId?: string;
    createdBy: string;
  }): CreationResult {
    const username = input.username?.trim().toLowerCase()
      ?? identifiantDepuisNom(input.name, (u) => this.comptes.has(u) || this.proteges.has(u));
    if (this.comptes.has(username) || this.proteges.has(username)) {
      return { ok: false, raison: 'identifiant_pris' };
    }
    // Un chauffeur n'a qu'un seul accès : deux comptes sur la même fiche, et
    // l'on ne sait plus qui a déposé quelle requête.
    if (input.driverId && this.parChauffeur(input.driverId)) {
      return { ok: false, raison: 'chauffeur_deja_lie' };
    }

    const motDePasse = motDePasseProvisoire();
    const { salt, hash } = hashPassword(motDePasse);
    const compte: StaffAccount = {
      id: username,
      username,
      name: input.name,
      role: input.role,
      salt,
      hash,
      service: input.service,
      phone: input.phone,
      email: input.email,
      matricule: input.matricule,
      teamId: input.teamId,
      driverId: input.driverId,
      active: true,
      mustChangePassword: true,
      createdAt: new Date().toISOString(),
      createdBy: input.createdBy,
    };
    this.comptes.set(username, compte);
    this.repo?.put(compte);
    return { ok: true, account: this.publier(compte), motDePasseProvisoire: motDePasse };
  }

  modifier(username: string, patch: {
    name?: string; role?: Role; service?: string; phone?: string; email?: string;
    matricule?: string; teamId?: string | null;
  }): StaffAccountPublic | null {
    const c = this.comptes.get(username);
    if (!c) return null;
    if (patch.name !== undefined) c.name = patch.name;
    if (patch.role !== undefined) c.role = patch.role;
    if (patch.service !== undefined) c.service = patch.service;
    if (patch.phone !== undefined) c.phone = patch.phone;
    if (patch.email !== undefined) c.email = patch.email;
    if (patch.matricule !== undefined) c.matricule = patch.matricule;
    if (patch.teamId !== undefined) c.teamId = patch.teamId ?? undefined;
    c.updatedAt = new Date().toISOString();
    this.repo?.put(c);
    return this.publier(c);
  }

  /**
   * Réinitialise le mot de passe : un nouveau provisoire est renvoyé une seule
   * fois, et la personne devra le changer. Sert quand quelqu'un l'a oublié —
   * cas le plus fréquent du support interne.
   */
  reinitialiser(username: string): { account: StaffAccountPublic; motDePasseProvisoire: string } | null {
    const c = this.comptes.get(username);
    if (!c) return null;
    const motDePasse = motDePasseProvisoire();
    const { salt, hash } = hashPassword(motDePasse);
    c.salt = salt;
    c.hash = hash;
    c.mustChangePassword = true;
    c.updatedAt = new Date().toISOString();
    this.repo?.put(c);
    return { account: this.publier(c), motDePasseProvisoire: motDePasse };
  }

  /** Changement par l'intéressé : on exige l'ancien mot de passe. */
  changerMotDePasse(username: string, ancien: string, nouveau: string):
  'ok' | 'ancien_invalide' | 'trop_court' | 'identique' | 'inconnu' {
    const c = this.comptes.get(username);
    if (!c) return 'inconnu';
    if (!verifyPassword(ancien, c.salt, c.hash)) return 'ancien_invalide';
    if (nouveau.length < MDP_MIN) return 'trop_court';
    if (verifyPassword(nouveau, c.salt, c.hash)) return 'identique';
    const { salt, hash } = hashPassword(nouveau);
    c.salt = salt;
    c.hash = hash;
    c.mustChangePassword = false;
    c.updatedAt = new Date().toISOString();
    this.repo?.put(c);
    return 'ok';
  }

  /**
   * Définit le mot de passe SANS l'ancien — réservé aux voies où l'identité est déjà
   * prouvée autrement (session d'app chauffeur obtenue par code SMS).
   */
  definirMotDePasse(username: string, nouveau: string): 'ok' | 'trop_court' | 'inconnu' {
    const c = this.comptes.get(username);
    if (!c) return 'inconnu';
    if (nouveau.length < MDP_MIN) return 'trop_court';
    const { salt, hash } = hashPassword(nouveau);
    c.salt = salt;
    c.hash = hash;
    c.mustChangePassword = false;
    c.updatedAt = new Date().toISOString();
    this.repo?.put(c);
    return 'ok';
  }

  /**
   * Désactive un compte avec un motif. On ne supprime pas : le journal d'audit
   * référence ce nom, et un dossier instruit par quelqu'un qui « n'existe plus »
   * n'est pas auditable.
   */
  desactiver(username: string, reason: string): StaffAccountPublic | null {
    const c = this.comptes.get(username);
    if (!c) return null;
    c.active = false;
    c.disabledReason = reason;
    c.updatedAt = new Date().toISOString();
    this.repo?.put(c);
    return this.publier(c);
  }

  reactiver(username: string): StaffAccountPublic | null {
    const c = this.comptes.get(username);
    if (!c) return null;
    c.active = true;
    c.disabledReason = undefined;
    c.updatedAt = new Date().toISOString();
    this.repo?.put(c);
    return this.publier(c);
  }

  marquerConnexion(username: string): void {
    const c = this.comptes.get(username);
    if (!c) return;
    c.lastLoginAt = new Date().toISOString();
    this.repo?.put(c);
  }

  get(username: string): StaffAccount | undefined { return this.comptes.get(username); }

  /** Le compte lié à une fiche chauffeur, s'il existe. */
  parChauffeur(driverId: string): StaffAccount | undefined {
    for (const c of this.comptes.values()) if (c.driverId === driverId) return c;
    return undefined;
  }

  parEquipe(teamId: string): StaffAccountPublic[] {
    return this.liste().filter((c) => c.teamId === teamId);
  }

  liste(filtre: { role?: Role; teamId?: string; actif?: boolean; q?: string } = {}): StaffAccountPublic[] {
    const q = filtre.q?.toLowerCase().trim();
    return [...this.comptes.values()]
      .filter((c) => (!filtre.role || c.role === filtre.role)
        && (!filtre.teamId || c.teamId === filtre.teamId)
        && (filtre.actif === undefined || c.active === filtre.actif)
        && (!q || c.name.toLowerCase().includes(q) || c.username.includes(q)
          || (c.matricule ?? '').toLowerCase().includes(q)))
      .sort((a, b) => a.name.localeCompare(b.name, 'fr'))
      .map((c) => this.publier(c));
  }

  /** Vue consommée par l'authentification de la console. */
  asAdminUsers(): AdminUser[] {
    return [...this.comptes.values()]
      .filter((c) => c.active)
      .map((c) => ({ username: c.username, name: c.name, role: c.role, salt: c.salt, hash: c.hash, totp: c.totp }));
  }

  /** Compteurs pour la session Rôles & accès. */
  stats(): { total: number; actifs: number; parRole: Record<string, number>; aChangerMdp: number } {
    const parRole: Record<string, number> = {};
    let actifs = 0;
    let aChangerMdp = 0;
    for (const c of this.comptes.values()) {
      parRole[c.role] = (parRole[c.role] ?? 0) + 1;
      if (c.active) actifs += 1;
      if (c.active && c.mustChangePassword) aChangerMdp += 1;
    }
    return { total: this.comptes.size, actifs, parRole, aChangerMdp };
  }
}
