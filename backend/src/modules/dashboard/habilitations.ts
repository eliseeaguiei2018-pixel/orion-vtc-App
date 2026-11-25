import { randomUUID } from 'node:crypto';
import type { Repository } from '../../core/db/repository.js';
import { can, ROLE_LABEL, type AdminAccount, type Role } from '../admin/roles.js';

/**
 * HABILITATIONS AU TABLEAU DE BORD DE DIRECTION.
 *
 * Le tableau de bord (chiffres du jour, objectifs financiers, tendances) est réservé de
 * droit à la direction (PDG, DG, DAA, directeur des opérations, directeur financier,
 * DAF), à la trésorerie, à la comptabilité et au service informatique.
 *
 * Un manager n'y accède que sur habilitation INDIVIDUELLE, en trois temps :
 *   1. la demande : le manager la fait lui-même depuis l'écran de refus, ou le service
 *      informatique l'inscrit pour lui ;
 *   2. la transmission : le service informatique la vérifie et la transmet à la direction ;
 *   3. la décision : un membre de la direction accorde ou refuse. Celui qui a transmis ne
 *      peut jamais décider (séparation des tâches), et personne ne statue sur lui-même.
 * L'habilitation peut avoir une date de fin, et se révoque à tout moment. Chaque étape
 * est datée et signée dans l'historique de la demande.
 */

export type StatutHabilitation = 'demandee' | 'transmise' | 'accordee' | 'refusee' | 'revoquee';

export const STATUT_HABILITATION_LABEL: Record<StatutHabilitation, string> = {
  demandee: 'Demandée, en attente du service informatique',
  transmise: 'Transmise à la direction',
  accordee: 'Accordée',
  refusee: 'Refusée',
  revoquee: 'Révoquée',
};

/** Rôles qui peuvent recevoir une habilitation : les managers. */
export const ROLES_HABILITABLES: Role[] = ['manager', 'fleet_manager'];

export interface EtapeHabilitation { at: string; par: string; action: string; detail?: string }

export interface Habilitation {
  id: string;
  username: string;
  nom: string;
  role: Role;
  statut: StatutHabilitation;
  /** Pourquoi ce manager en a besoin (obligatoire : la direction décide sur pièce). */
  motif: string;
  /** Fin de l'habilitation (ISO) ; absente : jusqu'à révocation. */
  expireLe?: string;
  demandeLe: string;
  demandePar: string;
  transmiseLe?: string;
  transmisePar?: string;
  /** Identifiant de celui qui a transmis : celui-là ne peut jamais accorder. */
  transmiseParIdentifiant?: string;
  decisionLe?: string;
  decisionPar?: string;
  /** Motif d'un refus ou d'une révocation. */
  raison?: string;
  historique: EtapeHabilitation[];
}

export type ErreurHabilitation =
  | 'role_non_habilitable' | 'deja_en_cours' | 'introuvable' | 'mauvais_statut'
  | 'separation_des_taches' | 'sur_soi_meme' | 'date_passee';

const OUVERTS = new Set<StatutHabilitation>(['demandee', 'transmise', 'accordee']);

const signature = (c: AdminAccount) => `${c.name} (${ROLE_LABEL[c.role]})`;

export class ServiceHabilitations {
  private readonly items = new Map<string, Habilitation>();

  constructor(private readonly repo?: Repository<Habilitation>) {
    for (const h of repo?.all() ?? []) this.items.set(h.id, h);
  }

  private enregistrer(h: Habilitation, par: string, action: string, detail?: string): Habilitation {
    h.historique.push({ at: new Date().toISOString(), par, action, ...(detail ? { detail } : {}) });
    this.items.set(h.id, h);
    this.repo?.put(h);
    return h;
  }

  get(id: string): Habilitation | undefined { return this.items.get(id); }

  liste(): Habilitation[] {
    return [...this.items.values()].sort((a, b) => b.demandeLe.localeCompare(a.demandeLe));
  }

  /** La demande ouverte (demandée, transmise ou accordée) d'un identifiant. */
  courante(username: string, maintenant = Date.now()): Habilitation | undefined {
    // Une habilitation échue est close : le manager peut en redemander une.
    return this.liste().find((h) => h.username === username && OUVERTS.has(h.statut) && !(h.statut === 'accordee' && this.estExpiree(h, maintenant)));
  }

  /** Dernière demande d'un identifiant, ouverte ou close (affichée au manager). */
  derniere(username: string): Habilitation | undefined {
    return this.liste().find((h) => h.username === username);
  }

  estExpiree(h: Habilitation, maintenant = Date.now()): boolean {
    return Boolean(h.expireLe && Date.parse(h.expireLe) <= maintenant);
  }

  /** Accès effectif d'un manager : habilitation accordée et non échue. */
  estHabilite(username: string | undefined, maintenant = Date.now()): boolean {
    if (!username) return false;
    return this.courante(username, maintenant)?.statut === 'accordee';
  }

  /** Le compte peut-il ouvrir le tableau de bord ? De droit, ou sur habilitation. */
  peutVoirTableau(compte: AdminAccount): boolean {
    if (can(compte.role, 'dashboard:read')) return true;
    return ROLES_HABILITABLES.includes(compte.role) && this.estHabilite(compte.username);
  }

  /** Étape 1 (par le manager lui-même) : demander l'accès. */
  demander(compte: AdminAccount, motif: string): Habilitation | ErreurHabilitation {
    if (!compte.username || !ROLES_HABILITABLES.includes(compte.role)) return 'role_non_habilitable';
    if (this.courante(compte.username)) return 'deja_en_cours';
    const h: Habilitation = {
      id: randomUUID().slice(0, 8), username: compte.username, nom: compte.name, role: compte.role,
      statut: 'demandee', motif, demandeLe: new Date().toISOString(), demandePar: signature(compte), historique: [],
    };
    return this.enregistrer(h, signature(compte), 'Demande d’accès', motif);
  }

  /**
   * Étape 1 bis (par le service informatique) : inscrire un manager. La demande part
   * directement à la direction ; si le manager avait déjà demandé, c'est sa demande
   * qui est transmise.
   */
  inscrire(
    cible: { username: string; nom: string; role: Role },
    motif: string, expireLe: string | undefined, par: AdminAccount,
  ): Habilitation | ErreurHabilitation {
    if (!ROLES_HABILITABLES.includes(cible.role)) return 'role_non_habilitable';
    if (cible.username === par.username) return 'sur_soi_meme';
    if (expireLe && Date.parse(expireLe) <= Date.now()) return 'date_passee';
    const existante = this.courante(cible.username);
    if (existante && existante.statut !== 'demandee') return 'deja_en_cours';
    if (existante) return this.transmettre(existante.id, par, expireLe, motif);
    const h: Habilitation = {
      id: randomUUID().slice(0, 8), username: cible.username, nom: cible.nom, role: cible.role,
      statut: 'demandee', motif, demandeLe: new Date().toISOString(), demandePar: signature(par), historique: [],
    };
    this.enregistrer(h, signature(par), 'Inscription par le service informatique', motif);
    return this.transmettre(h.id, par, expireLe);
  }

  /** Étape 2 (service informatique) : vérifier et transmettre à la direction. */
  transmettre(id: string, par: AdminAccount, expireLe?: string, note?: string): Habilitation | ErreurHabilitation {
    const h = this.items.get(id);
    if (!h) return 'introuvable';
    if (h.statut !== 'demandee') return 'mauvais_statut';
    if (h.username === par.username) return 'sur_soi_meme';
    if (expireLe && Date.parse(expireLe) <= Date.now()) return 'date_passee';
    h.statut = 'transmise';
    h.transmiseLe = new Date().toISOString();
    h.transmisePar = signature(par);
    h.transmiseParIdentifiant = par.username ?? par.name;
    if (expireLe) h.expireLe = expireLe;
    return this.enregistrer(h, signature(par), 'Transmise à la direction', [note, expireLe ? `jusqu’au ${new Date(expireLe).toLocaleDateString('fr-FR')}` : ''].filter(Boolean).join(' · ') || undefined);
  }

  /** Étape 3 (direction) : accorder ou refuser. */
  statuer(id: string, accorder: boolean, par: AdminAccount, raison?: string): Habilitation | ErreurHabilitation {
    const h = this.items.get(id);
    if (!h) return 'introuvable';
    if (h.statut !== 'transmise') return 'mauvais_statut';
    if (h.username === par.username) return 'sur_soi_meme';
    if (h.transmiseParIdentifiant === (par.username ?? par.name)) return 'separation_des_taches';
    if (accorder && this.estExpiree(h)) return 'date_passee';
    h.statut = accorder ? 'accordee' : 'refusee';
    h.decisionLe = new Date().toISOString();
    h.decisionPar = signature(par);
    if (raison) h.raison = raison;
    return this.enregistrer(h, signature(par), accorder ? 'Accordée par la direction' : 'Refusée par la direction', raison);
  }

  /** Retirer l'accès (ou annuler une demande en cours), avec un motif. */
  revoquer(id: string, par: AdminAccount, raison: string): Habilitation | ErreurHabilitation {
    const h = this.items.get(id);
    if (!h) return 'introuvable';
    if (!OUVERTS.has(h.statut)) return 'mauvais_statut';
    h.statut = 'revoquee';
    h.raison = raison;
    return this.enregistrer(h, signature(par), 'Révoquée', raison);
  }
}
