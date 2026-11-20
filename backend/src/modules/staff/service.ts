import { randomUUID } from 'node:crypto';
import type { Repository } from '../../core/db/repository.js';

/**
 * SESSION ÉQUIPES (S8) — gestion du PERSONNEL INTERNE (agents support,
 * répartiteurs, auditeurs qualité, comptables) et de la logistique des flottes
 * confiées aux managers. Ne gère PAS les chauffeurs (cf. session Chauffeurs).
 *
 * Couvre les deltas non encore présents ailleurs :
 *  - planning des astreintes 24/7 (shifts) + affectation territoriale (zone) ;
 *  - pointage (time-tracking) alimenté par les connexions/déconnexions ;
 *  - tickets de maintenance des véhicules (cycle de vie du matériel) ;
 *  - chat interne d'équipe (manager ↔ agents) ;
 *  - objectifs mensuels d'équipe.
 * La productivité par employé est dérivée du journal d'audit (voir AdminService).
 */

export type ShiftSlot = 'matin' | 'soir' | 'nuit';

export interface Shift {
  id: string;
  /** Identifiant de connexion de l'employé. */
  username: string;
  name: string;
  date: string;         // AAAA-MM-JJ
  slot: ShiftSlot;
  /** Affectation territoriale (zone surveillée) — optionnelle. */
  zoneId?: string;
  createdAt: string;
}

export type MaintenanceKind = 'controle_technique' | 'batterie_soh' | 'reparation' | 'nettoyage' | 'assurance';
export type MaintenanceStatus = 'ouvert' | 'assigne' | 'resolu';

export interface MaintenanceTicket {
  id: string;
  driverId: string;         // véhicule = chauffeur (flotte)
  kind: MaintenanceKind;
  title: string;
  status: MaintenanceStatus;
  /** Équipe (squad) propriétaire du véhicule — portée manager. */
  teamId?: string;
  /** Agent chargé de la mission logistique. */
  assignee?: string;
  dueDate?: string;
  createdAt: string;
  resolvedAt?: string;
}

export interface TeamGoal {
  teamId: string;
  /** Objectif mensuel (ex. « temps de réponse < 1 min 30 »). */
  label: string;
  target: number;
  current: number;
}

export interface TeamMessage {
  id: string;
  teamId: string;
  author: string;
  text: string;
  at: string;
}

interface ShiftRecord extends Shift { kind: 'shift'; }
interface TicketRecord extends MaintenanceTicket { kind2: 'ticket'; }

export class StaffService {
  private readonly shifts = new Map<string, Shift>();
  private readonly tickets = new Map<string, MaintenanceTicket>();
  private readonly goals = new Map<string, TeamGoal>();
  private readonly chat = new Map<string, TeamMessage[]>(); // teamId → messages

  constructor(
    private readonly shiftRepo?: Repository<ShiftRecord>,
    private readonly ticketRepo?: Repository<TicketRecord>,
  ) {
    for (const s of shiftRepo?.all() ?? []) this.shifts.set(s.id, s);
    for (const t of ticketRepo?.all() ?? []) this.tickets.set(t.id, t);
  }

  /* --------------------------- Astreintes / shifts --------------------------- */
  assignShift(input: { username: string; name: string; date: string; slot: ShiftSlot; zoneId?: string }): Shift {
    const shift: Shift = { id: randomUUID().slice(0, 8), createdAt: new Date().toISOString(), ...input };
    this.shifts.set(shift.id, shift);
    this.shiftRepo?.put({ ...shift, kind: 'shift' });
    return shift;
  }

  removeShift(id: string): void {
    this.shifts.delete(id);
    this.shiftRepo?.delete(id);
  }

  /** Planning (optionnellement filtré par date). */
  listShifts(date?: string): Shift[] {
    const all = [...this.shifts.values()].sort((a, b) => (a.date + a.slot).localeCompare(b.date + b.slot));
    return date ? all.filter((s) => s.date === date) : all;
  }

  /* -------------------------- Tickets de maintenance ------------------------- */
  openTicket(input: { driverId: string; kind: MaintenanceKind; title: string; teamId?: string; dueDate?: string }): MaintenanceTicket {
    const t: MaintenanceTicket = { id: randomUUID().slice(0, 8), status: 'ouvert', createdAt: new Date().toISOString(), ...input };
    this.tickets.set(t.id, t);
    this.ticketRepo?.put({ ...t, kind2: 'ticket' });
    return t;
  }

  assignTicket(id: string, assignee: string): MaintenanceTicket | null {
    const t = this.tickets.get(id);
    if (!t) return null;
    t.assignee = assignee;
    t.status = 'assigne';
    this.ticketRepo?.put({ ...t, kind2: 'ticket' });
    return t;
  }

  resolveTicket(id: string): MaintenanceTicket | null {
    const t = this.tickets.get(id);
    if (!t) return null;
    t.status = 'resolu';
    t.resolvedAt = new Date().toISOString();
    this.ticketRepo?.put({ ...t, kind2: 'ticket' });
    return t;
  }

  listTickets(teamId?: string): MaintenanceTicket[] {
    const all = [...this.tickets.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return teamId ? all.filter((t) => t.teamId === teamId) : all;
  }

  /* ------------------------------- Objectifs -------------------------------- */
  setGoal(g: TeamGoal): TeamGoal {
    this.goals.set(g.teamId, g);
    return g;
  }
  getGoal(teamId: string): TeamGoal | undefined { return this.goals.get(teamId); }

  /* ---------------------------- Chat interne équipe -------------------------- */
  postChat(teamId: string, author: string, text: string): TeamMessage {
    const m: TeamMessage = { id: randomUUID().slice(0, 8), teamId, author, text, at: new Date().toISOString() };
    const arr = this.chat.get(teamId) ?? [];
    arr.push(m);
    if (arr.length > 200) arr.shift();
    this.chat.set(teamId, arr);
    return m;
  }
  listChat(teamId: string): TeamMessage[] {
    return this.chat.get(teamId) ?? [];
  }
}
