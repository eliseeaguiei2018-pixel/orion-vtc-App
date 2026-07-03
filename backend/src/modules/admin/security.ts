import { randomUUID } from 'node:crypto';
import type { Role } from './roles.js';

/**
 * Alerte de sécurité interne : un employé a tenté d'accéder à une SESSION de la
 * console qui ne lui est pas autorisée. Le message de refus est affiché à
 * l'employé, et la tentative est SIGNALÉE à la direction (DG, CFO et DAA) via
 * la boîte « Alertes sécurité » de la console (+ journal d'audit).
 */
export interface AccessAttempt {
  id: string;
  /** Identifiant de connexion de l'employé (si compte nominatif). */
  username?: string;
  name: string;
  role: Role;
  /** Permission manquante (tentative d'appel API direct). */
  permission?: string;
  /** Session (section de la console) visée lors du clic. */
  section?: string;
  path?: string;
  ip?: string;
  at: string;
  /** Destinataires du signalement (direction). */
  notified: string[];
}

/** Destinataires systématiques du signalement. */
export const SECURITY_NOTIFY = ['DG', 'CFO', 'DAA'];

export class SecurityAlertsService {
  private readonly items: AccessAttempt[] = [];

  record(input: { username?: string; name: string; role: Role; permission?: string; section?: string; path?: string; ip?: string }): AccessAttempt {
    const a: AccessAttempt = {
      id: randomUUID().slice(0, 8),
      at: new Date().toISOString(),
      notified: [...SECURITY_NOTIFY],
      ...input,
    };
    this.items.unshift(a);
    if (this.items.length > 300) this.items.pop();
    return a;
  }

  list(limit = 100): AccessAttempt[] {
    return this.items.slice(0, limit);
  }

  count(): number {
    return this.items.length;
  }
}
