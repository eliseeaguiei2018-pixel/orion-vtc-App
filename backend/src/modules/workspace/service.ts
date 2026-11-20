import type { Container } from '../../container.js';
import { ROLE_PERMISSIONS, type AdminAccount, type Permission } from '../admin/roles.js';
import { STATUT_RAPPORT_LABEL } from '../staff/comms.js';
import { nearestZone } from '../geo-ci/zones.js';
import { PLAFOND_AVANCE, PLAFOND_PRET, MAX_ECHEANCES, TYPE_LABEL, TYPES_FINANCIERS } from '../crew/requests.js';
import { lieuDe } from '../maps/lieux.js';

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
  identite: {
    nom: string; role: string; roleLabel: string; permissions: string[];
    username?: string; service?: string; teamId?: string; driverId?: string;
    mustChangePassword?: boolean;
  };
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
  /**
   * MESSAGES INTERNES reçus — ce que son chef ou un collègue lui a écrit. Sans
   * cela, un message envoyé dans la console n'est jamais lu : personne n'ouvre
   * une boîte qu'il ne voit pas.
   */
  messages: Array<{
    id: string; deNom: string; sujet?: string; texte: string; at: string;
    urgent: boolean; reponseAttendue: boolean; lu: boolean; reponses: number;
  }>;
  /** RAPPORTS qu'on lui a demandés et qu'il doit rendre. */
  rapports: Array<{
    id: string; titre: string; consigne: string; echeance: string; statut: string;
    statutLabel: string; demandeParNom: string; enRetard: boolean;
    rendu?: { texte: string; at: string }; retour?: { texte: string; at: string };
  }>;
  /** SA CAISSE, s'il en tient une : le poste de travail d'une trésorière. */
  caisse: {
    id: string; emplacement?: string; ouverteLe: string;
    fondDeCaisse: number; entrees: number; sorties: number; soldeTheorique: number;
    nbMouvements: number;
  } | null;
  /** SES ÉQUIPES, s'il en dirige : chacune avec ce qui y attend un geste. */
  equipes: Array<{
    id: string; name: string; mission?: string;
    membres: number; flotte: number;
    rapportsEnRetard: number; requetesOuvertes: number; alertesFlotte: number;
  }>;
  /** SA FLOTTE ACCRÉDITÉE : les chauffeurs dont il répond, et qui a besoin de lui. */
  flotte: Array<{
    driverId: string; matricule: string; name: string; phone: string | null;
    availability: string; requetesOuvertes: number; alertes: number;
  }>;
  /** SON PROPRE DOSSIER, s'il est chauffeur : c'est sa seule vue de la plateforme. */
  monDossier: {
    matricule: string; courses: number; revenus: number; solde: number;
    resteDu: number; requetes: Array<{ id: string; type: string; statut: string; montant?: number; createdAt: string }>;
    alertes: Array<{ severite: string; texte: string }>;
    /*
     * Le poste du chauffeur : tout ce qui touche à SON travail, sans un chiffre de
     * l'entreprise ni la donnée d'un collègue. Avant, la console s'arrêtait sur
     * « Chargement… » pour lui, et son dossier tenait en quatre compteurs.
     */
    driverId: string;
    profil: { name: string; category: string; availability: string; kycStatus: string; rating: number; trips: number; insuranceExpiry?: string };
    vehicule: { model?: string; plate?: string; color?: string; engine: string; batteryPct?: number };
    equipe: { name: string; mission?: string; managerName?: string; managerPhone?: string | null } | null;
    activite: { periodeJours: number; coursesAnnulees: number; kilometres: number; commissionVersee: number; noteMoyenne: number; nbNotes: number; joursTravailles: number };
    argent: { detteEspeces: number; plafondDette: number; dernieresEcritures: Array<{ at: string; type: string; amount: number; note: string }> };
    dernieresCourses: Array<{ id: string; at: string; trajet: string; montant: number; paiement: string; statut: string; note?: number }>;
    /** Ce qu'il peut demander depuis son poste, avec les plafonds en vigueur. */
    typesRequete: Array<{ code: string; label: string; financiere: boolean }>;
    plafonds: { avance: number; pret: number; echeancesMax: number };
  } | null;
  /** Compteurs du jour. */
  bilan: {
    dossiers: number; demandes: number; aTraiter: number; actionsAujourdhui: number;
    messagesNonLus: number; rapportsARendre: number;
  };
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
  crew: 'crew:read', equipages: 'crew:read', caisses: 'caisse:read',
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

    for (const a of this.c.safety.list(0)) {
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

    /* ------------------------- Messages et rapports ------------------------- */
    const username = account.username ?? '';
    const messages = this.c.staffComms.recus(username).slice(0, 20).map((m) => ({
      id: m.id, deNom: m.deNom, sujet: m.sujet, texte: m.texte, at: m.at,
      urgent: m.urgent, reponseAttendue: m.reponseAttendue,
      lu: Boolean(m.luLe), reponses: m.reponses.length,
    }));

    const maintenant = Date.now();
    const rapports = this.c.staffComms.rapports_({ destinataire: username })
      .filter((r) => r.statut !== 'accepte')
      .map((r) => ({
        id: r.id, titre: r.titre, consigne: r.consigne, echeance: r.echeance,
        statut: r.statut, statutLabel: STATUT_RAPPORT_LABEL[r.statut],
        demandeParNom: r.demandeParNom,
        enRetard: r.statut === 'demande' && Date.parse(r.echeance) < maintenant,
        rendu: r.rendu, retour: r.retour,
      }));

    /* ------------------------------ Sa caisse ------------------------------ */
    const ouverte = username ? this.c.caisses.caisseOuverteDe(username) : undefined;
    const etatCaisse = ouverte ? this.c.caisses.etat(ouverte.id) : null;
    const caisse = etatCaisse
      ? {
        id: etatCaisse.id, emplacement: etatCaisse.emplacement, ouverteLe: etatCaisse.ouverteLe,
        fondDeCaisse: etatCaisse.fondDeCaisse, entrees: etatCaisse.entrees, sorties: etatCaisse.sorties,
        soldeTheorique: etatCaisse.soldeTheorique, nbMouvements: etatCaisse.mouvements.length,
      }
      : null;

    /* --------------------------- Ses équipes --------------------------- */
    const sesEquipes = this.c.teamWorkspace.mesEquipes(account);
    const equipes = (account.role === 'manager' ? sesEquipes : []).map((t) => {
      const poste = this.c.teamWorkspace.poste(t.id, 7);
      return {
        id: t.id, name: t.name, mission: t.mission,
        membres: poste?.membres.length ?? 0,
        flotte: t.driverIds.length,
        rapportsEnRetard: poste?.bilan.rapportsEnRetard ?? 0,
        requetesOuvertes: poste?.bilan.requetesOuvertes ?? 0,
        alertesFlotte: poste?.flotte.reduce((n, f) => n + f.alertes, 0) ?? 0,
      };
    });

    /* ------------------------ Sa flotte accréditée ------------------------ */
    const flotte = (account.role === 'manager' || account.role === 'agent')
      ? [...new Set(sesEquipes.flatMap((t) => t.driverIds))]
        .map((id) => {
          const d = this.c.drivers.get(id);
          if (!d) return null;
          const dossier = this.c.crew.dossier(id, 7);
          return {
            driverId: d.id, matricule: d.matricule, name: d.name, phone: d.phone ?? null,
            availability: d.availability,
            requetesOuvertes: this.c.crewRequests.list({ driverId: id })
              .filter((r) => r.statut !== 'cloturee' && r.statut !== 'refusee').length,
            alertes: dossier?.alertes.length ?? 0,
          };
        })
        .filter((x): x is NonNullable<typeof x> => x !== null)
        // Ce qui demande une attention remonte en tête : une liste alphabétique
        // oblige à parcourir trente lignes pour trouver les deux qui comptent.
        .sort((a, b) => (b.alertes + b.requetesOuvertes) - (a.alertes + a.requetesOuvertes))
      : [];

    /* --------------------------- Son propre dossier --------------------------- */
    const fiche = username ? this.c.accounts.get(username) : undefined;
    const monDossier = fiche?.driverId
      ? (() => {
        const d = this.c.crew.dossier(fiche.driverId!, 30);
        if (!d) return null;
        const zone = (p: { lat: number; lng: number }) => lieuDe(p).libelle;
        const manager = d.equipe?.managerUsername ? this.c.accounts.get(d.equipe.managerUsername) : undefined;
        const courses = this.c.rides.listByDriver(fiche.driverId!)
          .slice(0, 8)
          .map((r) => {
            const note = r.events.find((e) => e.type === 'rated')?.payload as { stars?: number; rating?: number } | undefined;
            return {
              id: r.id, at: r.createdAt, trajet: `${zone(r.origin)} → ${zone(r.destination)}`,
              montant: r.quote.amount, paiement: r.paymentMethod ?? 'cash', statut: r.status,
              note: note?.stars ?? note?.rating,
            };
          });
        return {
          matricule: d.identite.matricule,
          courses: d.activite.courses,
          revenus: d.activite.revenus,
          solde: d.argent.solde,
          resteDu: d.argent.resteDu,
          requetes: d.requetes.map((r) => ({
            id: r.id, type: r.typeLabel, statut: r.statutLabel, montant: r.montantAccorde ?? r.montant, createdAt: r.createdAt,
          })),
          alertes: d.alertes,
          driverId: fiche.driverId!,
          profil: {
            name: d.identite.name, category: d.identite.category, availability: d.identite.availability,
            kycStatus: d.identite.kycStatus, rating: d.identite.rating, trips: d.identite.trips,
            insuranceExpiry: d.identite.insuranceExpiry,
          },
          vehicule: { model: d.vehicule.model, plate: d.vehicule.plate, color: d.vehicule.color, engine: d.vehicule.engine, batteryPct: d.vehicule.batteryPct },
          equipe: d.equipe ? { name: d.equipe.name, mission: d.equipe.mission, managerName: d.equipe.managerName, managerPhone: manager?.phone ?? null } : null,
          activite: {
            periodeJours: d.activite.periodeJours, coursesAnnulees: d.activite.coursesAnnulees, kilometres: d.activite.kilometres,
            commissionVersee: d.activite.commissionVersee, noteMoyenne: d.activite.noteMoyenne, nbNotes: d.activite.nbNotes,
            joursTravailles: d.activite.joursTravailles,
          },
          argent: {
            detteEspeces: d.argent.detteEspeces,
            plafondDette: this.c.settings.getOps().cashDebtLimit ?? 0,
            dernieresEcritures: d.argent.dernieresEcritures.slice(0, 6),
          },
          dernieresCourses: courses,
          typesRequete: Object.entries(TYPE_LABEL).map(([code, label]) => ({ code, label, financiere: TYPES_FINANCIERS.includes(code as never) })),
          plafonds: { avance: PLAFOND_AVANCE, pret: PLAFOND_PRET, echeancesMax: MAX_ECHEANCES },
        };
      })()
      : null;

    return {
      identite: {
        nom, role: account.role, roleLabel: account.role, permissions,
        username: account.username, service: fiche?.service, teamId: fiche?.teamId,
        driverId: fiche?.driverId, mustChangePassword: fiche?.mustChangePassword,
      },
      service: shift ? { date: shift.date, slot: shift.slot, zoneId: shift.zoneId } : null,
      mesDossiers,
      mesDemandes,
      aTraiter,
      monActivite,
      messages,
      rapports,
      caisse,
      equipes,
      flotte,
      monDossier,
      bilan: {
        dossiers: mesDossiers.length,
        demandes: mesDemandes.length,
        aTraiter: aTraiter.length,
        actionsAujourdhui: monActivite.length,
        messagesNonLus: messages.filter((m) => !m.lu).length,
        rapportsARendre: rapports.filter((r) => r.statut === 'demande' || r.statut === 'a_revoir').length,
      },
      genereA: new Date().toISOString(),
    };
  }
}
