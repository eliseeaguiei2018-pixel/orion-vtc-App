import type { Container } from '../../container.js';
import { ROLE_PERMISSIONS, type AdminAccount, type Permission } from '../admin/roles.js';

/**
 * « MON POSTE » — la journée de travail d'un employé ORION.
 *
 * La console était organisée par SUJET : les courses d'un côté, les litiges de
 * l'autre, le support ailleurs. Logique pour la plateforme, inutilisable pour la
 * personne : un agent arrivant le matin devait ouvrir une dizaine de sessions pour
 * découvrir ce qui l'attendait, et un dossier qu'il avait pris en charge la veille
 * se perdait dans une liste commune.
 *
 * Cette vue est organisée par PERSONNE. Elle ne crée aucune donnée : elle retrouve,
 * dans les modules existants, tout ce qui porte le nom de l'employé connecté, et n'y
 * ajoute que ce que ses droits lui permettent de traiter.
 */

export interface TacheAssignee {
  id: string;
  type: 'sos' | 'support' | 'litige' | 'location' | 'maintenance';
  titre: string;
  detail: string;
  /** Depuis quand elle est sur son bureau. */
  depuis: string;
  /** Session où la traiter. */
  section: string;
  /** Urgence relative (plus petit = plus urgent). */
  priorite: number;
}

export interface DemandePersonnelle {
  id: string;
  type: 'note_de_frais' | 'virement';
  libelle: string;
  montant: number;
  statut: string;
  depuis: string;
  section: string;
}

export interface MonPoste {
  identite: { nom: string; role: string; roleLabel: string; permissions: string[] };
  /** Service du jour (astreinte / tranche horaire), s'il y en a un. */
  service: { date: string; slot: string; zoneId?: string } | null;
  /** Dossiers qui portent son nom et attendent son geste. */
  mesDossiers: TacheAssignee[];
  /** Ce qu'il a demandé et qui attend une décision d'autrui. */
  mesDemandes: DemandePersonnelle[];
  /**
   * Constats du moteur de vigilance qu'il peut RÉELLEMENT traiter : inutile de
   * montrer à un agent du support une alerte qu'il n'a pas le droit d'ouvrir.
   */
  aTraiter: Array<{ id: string; severite: string; titre: string; action: string; section: string }>;
  /** Ce qu'il a fait aujourd'hui (journal d'audit filtré sur son nom). */
  monActivite: Array<{ at: string; action: string; target?: string }>;
  /** Compteurs du jour. */
  bilan: { dossiers: number; demandes: number; aTraiter: number; actionsAujourdhui: number };
  genereA: string;
}

/** Droit minimal pour ouvrir chaque session — sert à filtrer ce qu'on propose. */
const DROIT_SECTION: Record<string, Permission> = {
  alerts: 'alerts:read', support: 'support:read', disputes: 'support:read',
  rides: 'rides:read', dispatch: 'rides:write', drivers: 'drivers:read',
  clients: 'clients:read', finance: 'finance:read', treasury: 'treasury:read',
  pricing: 'pricing:read', zones: 'pricing:read', promos: 'promos:read',
  services: 'services:read', rental: 'rental:read', rentalTarifs: 'rental:read',
  subscriptions: 'rental:read', green: 'overview:read', teams: 'teams:read',
  security: 'security:read', audit: 'audit:read',
};

const today = () => new Date().toISOString().slice(0, 10);

/** Libellés en clair : un employé ne doit jamais lire un code interne à l'écran. */
const KIND_ALERTE: Record<string, string> = {
  sos: 'SOS déclenché', crash: 'Choc détecté', deviation: 'Déviation d’itinéraire',
  immobilisation: 'Immobilisation anormale', mot_sensible: 'Mot sensible signalé',
};
const NIVEAU_ALERTE: Record<string, string> = { rouge: 'rouge', orange: 'orange', jaune: 'jaune' };
const KIND_LITIGE: Record<string, string> = {
  objet_perdu: 'objet oublié', trajet: 'contestation de trajet',
  facturation: 'erreur de facturation', comportement: 'comportement',
};
const STATUT_DEMANDE: Record<string, string> = {
  pending: 'en attente de décision', approved: 'approuvée', rejected: 'refusée',
  info: 'complément demandé', paid: 'versée',
};

export class WorkspaceService {
  constructor(private readonly c: Container) {}

  async monPoste(account: AdminAccount): Promise<MonPoste> {
    const nom = account.name;
    const permissions = ROLE_PERMISSIONS[account.role] ?? [];
    const peut = (p: Permission) => permissions.includes(p);

    /* --------------------- Dossiers portant son nom --------------------- */
    const mesDossiers: TacheAssignee[] = [];

    for (const a of this.c.safety.list()) {
      if (a.agent !== nom) continue;
      if (a.status === 'resolved' || a.status === 'cancelled') continue;
      mesDossiers.push({
        id: a.id, type: 'sos', priorite: 1,
        titre: `Alerte ${NIVEAU_ALERTE[a.level ?? 'rouge'] ?? a.level} — ${KIND_ALERTE[a.kind] ?? a.kind}`,
        detail: `${a.zoneName ?? 'zone inconnue'} · usager ${a.userId.slice(0, 10)}`,
        depuis: a.claimedAt ?? a.createdAt, section: 'alerts',
      });
    }

    for (const conv of this.c.support.list?.() ?? []) {
      if (conv.assignee !== nom || conv.status === 'closed') continue;
      mesDossiers.push({
        id: conv.id, type: 'support', priorite: conv.priority ?? 3,
        titre: conv.subject,
        detail: `${conv.messages.length} message(s) · client ${conv.clientId.slice(0, 10)}`,
        depuis: conv.updatedAt, section: 'support',
      });
    }

    for (const d of this.c.disputes.list()) {
      if (d.lockedBy !== nom) continue;
      if (d.status === 'resolved' || d.status === 'rejected') continue;
      mesDossiers.push({
        id: d.id, type: 'litige', priorite: d.escalation ? 2 : 4,
        titre: `Litige ${KIND_LITIGE[d.kind] ?? d.kind}${d.escalation ? ` (escaladé — ${d.escalation})` : ''}`,
        detail: d.description.slice(0, 90),
        depuis: d.createdAt, section: 'disputes',
      });
    }

    for (const t of this.c.staff.listTickets()) {
      if (t.assignee !== account.username && t.assignee !== nom) continue;
      if (t.status !== 'ouvert' && t.status !== 'assigne') continue;
      mesDossiers.push({
        id: t.id, type: 'maintenance', priorite: 5,
        titre: `Maintenance — ${t.title}`,
        detail: `${t.kind}${t.dueDate ? ` · échéance ${t.dueDate}` : ''}`,
        depuis: t.createdAt, section: 'teams',
      });
    }

    mesDossiers.sort((a, b) => a.priorite - b.priorite || Date.parse(a.depuis) - Date.parse(b.depuis));

    /* ------------------------ Ses propres demandes ------------------------ */
    const mesDemandes: DemandePersonnelle[] = [];

    for (const t of this.c.expenses.list()) {
      if (t.requesterId !== account.username && t.requesterName !== nom) continue;
      if (t.status === 'rejected' && t.credited) continue;
      mesDemandes.push({
        id: t.id, type: 'note_de_frais',
        libelle: `${t.category} — ${t.description.slice(0, 60)}`,
        montant: t.amount, statut: STATUT_DEMANDE[t.status] ?? t.status,
        depuis: t.createdAt, section: 'finance',
      });
    }

    for (const t of this.c.treasury.list()) {
      if (t.requestedBy !== nom || t.status !== 'pending') continue;
      mesDemandes.push({
        id: t.id, type: 'virement', libelle: t.reason,
        montant: t.amount, statut: 'en attente d’approbation',
        depuis: t.createdAt, section: 'treasury',
      });
    }

    mesDemandes.sort((a, b) => Date.parse(b.depuis) - Date.parse(a.depuis));

    /* ------------- Ce qu'il peut traiter, selon SES droits ------------- */
    const sante = peut('vigilance:read') ? await this.c.vigilance.sante() : { constats: [] };
    const aTraiter = sante.constats
      .filter((c) => {
        const droit = DROIT_SECTION[c.section];
        return droit ? peut(droit) : false;
      })
      .slice(0, 8)
      .map((c) => ({ id: c.id, severite: c.severite, titre: c.titre, action: c.action, section: c.section }));

    /* ---------------------------- Son activité ---------------------------- */
    const debutJour = `${today()}T00:00:00.000Z`;
    const monActivite = this.c.audit.list(300)
      .filter((e) => e.actor === nom && e.at >= debutJour)
      .slice(0, 20)
      .map((e) => ({ at: e.at, action: e.action, target: e.target }));

    /* ---------------------------- Son service ---------------------------- */
    const shift = this.c.staff.listShifts(today()).find((s) => s.username === account.username);

    return {
      identite: { nom, role: account.role, roleLabel: account.role, permissions },
      service: shift ? { date: shift.date, slot: shift.slot, zoneId: shift.zoneId } : null,
      mesDossiers,
      mesDemandes,
      aTraiter,
      monActivite,
      bilan: {
        dossiers: mesDossiers.length,
        demandes: mesDemandes.length,
        aTraiter: aTraiter.length,
        actionsAujourdhui: monActivite.length,
      },
      genereA: new Date().toISOString(),
    };
  }
}
