import { randomUUID } from 'node:crypto';

/**
 * Journal d'audit : trace QUI a fait QUOI (actions admin sensibles).
 * En production : stockage immuable (append-only) + rétention légale.
 */
export interface AuditEntry {
  id: string;
  at: string;
  actor: string;   // nom du compte admin
  role: string;
  action: string;  // ex. 'pricing.update', 'driver.suspend'
  target?: string; // id de l'objet concerné
  details?: Record<string, unknown>;
}

export class AuditService {
  private readonly entries: AuditEntry[] = [];

  log(entry: Omit<AuditEntry, 'id' | 'at'>): AuditEntry {
    const full: AuditEntry = { id: randomUUID(), at: new Date().toISOString(), ...entry };
    this.entries.unshift(full);
    if (this.entries.length > 1000) this.entries.pop(); // borne mémoire
    return full;
  }

  list(limit = 100): AuditEntry[] {
    return this.entries.slice(0, limit);
  }
}
