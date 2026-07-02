import { randomUUID } from 'node:crypto';
import type { Repository } from '../../core/db/repository.js';

/**
 * Équipes ORION : chaque équipe est dirigée par un MANAGER (chef d'équipe) et
 * se voit affilier une FLOTTE de chauffeurs. Le manager ne supervise que son
 * équipe : la portée est imposée côté serveur (liste filtrée par son compte,
 * actions chauffeurs refusées hors de sa flotte).
 */
export interface Team {
  id: string;
  name: string;
  /** Identifiant de connexion du manager (compte console, rôle 'manager'). */
  managerUsername: string;
  managerName?: string;
  /** Flotte affiliée (ids chauffeurs). */
  driverIds: string[];
  createdAt: string;
}

export class TeamService {
  private readonly teams = new Map<string, Team>();

  constructor(private readonly repo?: Repository<Team>) {
    for (const t of repo?.all() ?? []) this.teams.set(t.id, t);
  }

  upsert(input: { id?: string; name: string; managerUsername: string; managerName?: string; driverIds?: string[] }): Team {
    const existing = input.id ? this.teams.get(input.id) : undefined;
    const team: Team = {
      id: existing?.id ?? input.id ?? randomUUID().slice(0, 8),
      name: input.name,
      managerUsername: input.managerUsername,
      managerName: input.managerName ?? existing?.managerName,
      driverIds: input.driverIds ?? existing?.driverIds ?? [],
      createdAt: existing?.createdAt ?? new Date().toISOString(),
    };
    this.teams.set(team.id, team);
    this.repo?.put(team);
    return team;
  }

  setDrivers(id: string, driverIds: string[]): Team | null {
    const t = this.teams.get(id);
    if (!t) return null;
    t.driverIds = [...new Set(driverIds)];
    this.repo?.put(t);
    return t;
  }

  remove(id: string): void {
    this.teams.delete(id);
    this.repo?.delete(id);
  }

  get(id: string): Team | undefined {
    return this.teams.get(id);
  }

  list(): Team[] {
    return [...this.teams.values()].sort((a, b) => a.name.localeCompare(b.name));
  }

  /** Équipes dirigées par ce manager (portée chef d'équipe). */
  listByManager(username: string): Team[] {
    return this.list().filter((t) => t.managerUsername === username);
  }

  /** Vrai si ce chauffeur appartient à la flotte de ce manager. */
  managerOwnsDriver(username: string, driverId: string): boolean {
    return this.listByManager(username).some((t) => t.driverIds.includes(driverId));
  }
}
