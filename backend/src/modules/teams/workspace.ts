import type { Container } from '../../container.js';
import type { AdminAccount } from '../admin/roles.js';
import { ROLE_LABEL } from '../admin/roles.js';

/**
 * POSTE DE TRAVAIL DU CHEF D'ÉQUIPE.
 *
 * La session Équipes montrait des équipes : un nom, un manager, une liste de
 * chauffeurs. On pouvait la regarder, pas y travailler. Or diriger une équipe, c'est
 * savoir ce que chacun a fait aujourd'hui, pouvoir l'appeler, lui écrire, lui
 * demander un bilan — et voir ce qui n'a pas été rendu.
 *
 * Cette vue ne crée rien : elle rassemble, pour UNE équipe, ce que les autres
 * modules savent déjà de ses membres et de sa flotte. Le manager n'y voit que ses
 * propres équipes ; la portée est imposée au serveur, pas à l'écran.
 */

const JOUR = 86_400_000;
const REVENUS = new Set(['completed', 'rated']);

export interface MembreEquipe {
  username: string;
  name: string;
  role: string;
  roleLabel: string;
  phone?: string;
  email?: string;
  service?: string;
  active: boolean;
  lastLoginAt?: string;
  mustChangePassword: boolean;
  /** Ce qu'il a fait aujourd'hui, lu dans le journal d'audit. */
  actionsAujourdhui: number;
  derniereAction?: { at: string; action: string };
  /** Rapports attendus de lui, et combien sont en retard. */
  rapportsAttendus: number;
  rapportsEnRetard: number;
  messagesNonLus: number;
  /** Est-il de service aujourd'hui ? */
  service_du_jour?: { slot: string; zoneId?: string };
}

export interface PosteEquipe {
  equipe: { id: string; name: string; mission?: string; managerUsername: string; managerName?: string; createdAt: string };
  membres: MembreEquipe[];
  flotte: Array<{
    driverId: string; matricule: string; name: string; phone: string | null;
    category: string; kycStatus: string; availability: string;
    coursesPeriode: number; revenusPeriode: number;
    requetesOuvertes: number;
    /** Points de vigilance propres à ce chauffeur. */
    alertes: number;
  }>;
  /** Ce que l'équipe a produit sur la période. */
  bilan: {
    periodeJours: number;
    courses: number;
    revenusChauffeurs: number;
    commissionOrion: number;
    noteMoyenne: number;
    chauffeursEnService: number;
    requetesOuvertes: number;
    rapportsEnRetard: number;
    ticketsMaintenance: number;
  };
  rapports: ReturnType<Container['staffComms']['rapports_']>;
  messages: ReturnType<Container['staffComms']['messagesEquipe']>;
  genereA: string;
}

export class TeamWorkspaceService {
  constructor(private readonly c: Container) {}

  /** Les équipes qu'un compte a le droit d'ouvrir. */
  mesEquipes(account: AdminAccount): ReturnType<Container['teams']['list']> {
    if (account.role === 'manager') return this.c.teams.listByManager(account.username ?? '');
    if (account.role === 'agent') {
      const fiche = account.username ? this.c.accounts.get(account.username) : undefined;
      return this.c.teams.list().filter((t) => t.id === fiche?.teamId);
    }
    return this.c.teams.list();
  }

  /** Vrai si ce compte peut ouvrir cette équipe. */
  peutOuvrir(account: AdminAccount, teamId: string): boolean {
    return this.mesEquipes(account).some((t) => t.id === teamId);
  }

  poste(teamId: string, jours = 7): PosteEquipe | null {
    const equipe = this.c.teams.get(teamId);
    if (!equipe) return null;
    const depuis = Date.now() - jours * JOUR;
    const aujourdhui = new Date().toISOString().slice(0, 10);
    const journal = this.c.audit.list(500);
    const shifts = this.c.staff.listShifts(aujourdhui);

    /* -------------------------------- Membres -------------------------------- */
    const membres: MembreEquipe[] = this.c.accounts.parEquipe(teamId).map((m) => {
      const siennes = journal.filter((e) => e.actor === m.name && e.at.slice(0, 10) === aujourdhui);
      const rapports = this.c.staffComms.rapports_({ destinataire: m.username });
      const shift = shifts.find((s) => s.username === m.username);
      return {
        username: m.username,
        name: m.name,
        role: m.role,
        roleLabel: ROLE_LABEL[m.role],
        phone: m.phone,
        email: m.email,
        service: m.service,
        active: m.active,
        lastLoginAt: m.lastLoginAt,
        mustChangePassword: m.mustChangePassword,
        actionsAujourdhui: siennes.length,
        derniereAction: siennes[0] ? { at: siennes[0].at, action: siennes[0].action } : undefined,
        rapportsAttendus: rapports.filter((r) => r.statut === 'demande' || r.statut === 'a_revoir').length,
        rapportsEnRetard: rapports.filter((r) => r.statut === 'demande' && Date.parse(r.echeance) < Date.now()).length,
        messagesNonLus: this.c.staffComms.nonLus(m.username),
        service_du_jour: shift ? { slot: shift.slot, zoneId: shift.zoneId } : undefined,
      };
    });

    /* --------------------------------- Flotte --------------------------------- */
    const toutesCourses = this.c.rides.listAll();
    let coursesEquipe = 0;
    let revenusChauffeurs = 0;
    let commissionOrion = 0;
    const notes: number[] = [];

    const flotte = equipe.driverIds.map((id) => {
      const d = this.c.drivers.get(id);
      if (!d) {
        return {
          driverId: id, matricule: '—', name: 'Fiche supprimée', phone: null,
          category: '—', kycStatus: '—', availability: 'offline',
          coursesPeriode: 0, revenusPeriode: 0, requetesOuvertes: 0, alertes: 0,
        };
      }
      const sesCourses = toutesCourses.filter(
        (r) => r.driverId === id && REVENUS.has(r.status) && Date.parse(r.createdAt) >= depuis,
      );
      const ecritures = this.c.wallet.history(id).filter((e) => Date.parse(e.at) >= depuis);
      const revenus = ecritures.filter((e) => e.type === 'ride_earning').reduce((n, e) => n + e.amount, 0);
      const commission = Math.abs(ecritures.filter((e) => e.type === 'commission').reduce((n, e) => n + e.amount, 0));
      coursesEquipe += sesCourses.length;
      revenusChauffeurs += revenus;
      commissionOrion += commission;
      for (const r of sesCourses) {
        const stars = (r.events?.find((e) => e.type === 'rated')?.payload as { stars?: number } | undefined)?.stars;
        if (typeof stars === 'number') notes.push(stars);
      }
      const dossier = this.c.crew.dossier(id, jours);
      return {
        driverId: d.id, matricule: d.matricule, name: d.name, phone: d.phone ?? null,
        category: d.category, kycStatus: d.kycStatus, availability: d.availability,
        coursesPeriode: sesCourses.length,
        revenusPeriode: Math.round(revenus),
        requetesOuvertes: this.c.crewRequests.list({ driverId: id })
          .filter((r) => r.statut !== 'cloturee' && r.statut !== 'refusee').length,
        alertes: dossier?.alertes.length ?? 0,
      };
    });

    const rapports = this.c.staffComms.rapports_({ teamId });

    return {
      equipe: {
        id: equipe.id, name: equipe.name, mission: equipe.mission,
        managerUsername: equipe.managerUsername, managerName: equipe.managerName,
        createdAt: equipe.createdAt,
      },
      membres,
      flotte,
      bilan: {
        periodeJours: jours,
        courses: coursesEquipe,
        revenusChauffeurs: Math.round(revenusChauffeurs),
        commissionOrion: Math.round(commissionOrion),
        noteMoyenne: notes.length ? Math.round((notes.reduce((a, b) => a + b, 0) / notes.length) * 10) / 10 : 0,
        chauffeursEnService: flotte.filter((f) => f.availability === 'online' || f.availability === 'on_trip').length,
        requetesOuvertes: flotte.reduce((n, f) => n + f.requetesOuvertes, 0),
        rapportsEnRetard: rapports.filter((r) => r.statut === 'demande' && Date.parse(r.echeance) < Date.now()).length,
        ticketsMaintenance: this.c.staff.listTickets(teamId).filter((t) => t.status !== 'resolu').length,
      },
      rapports,
      messages: this.c.staffComms.messagesEquipe(teamId),
      genereA: new Date().toISOString(),
    };
  }
}
