import { randomUUID } from 'node:crypto';
import { clientRoom, driverRoom, SUPPORT_ROOM, type RealtimeHub } from '../realtime/hub.js';

/** Room globale des annonces (clients / chauffeurs). */
export const ANNOUNCE_ROOM = 'announcements';

export type Audience = 'clients' | 'drivers' | 'all';

/** Annonce diffusée depuis la console (promo, info service, maintenance…). */
export interface Announcement {
  id: string;
  audience: Audience;
  title: string;
  body: string;
  author: string;
  at: string;
}

/**
 * Notifications / diffusion : l'ORION « parle » à ses utilisateurs depuis la console.
 * Temps réel (WS) vers la room d'annonces + historique consultable.
 */
export class NotificationService {
  private readonly items: Announcement[] = [];

  constructor(private readonly realtime: RealtimeHub) {}

  broadcast(input: { audience: Audience; title: string; body: string; author: string }): Announcement {
    const a: Announcement = { id: randomUUID().slice(0, 8), at: new Date().toISOString(), ...input };
    this.items.unshift(a);
    if (this.items.length > 200) this.items.pop();
    // Diffusion temps réel (room globale + relais support pour la console).
    this.realtime.publish(ANNOUNCE_ROOM, 'announcement', a);
    this.realtime.publish(SUPPORT_ROOM, 'announcement', a);
    return a;
  }

  /** Notification ciblée à un client ou un chauffeur précis. */
  notify(to: { clientId?: string; driverId?: string }, title: string, body: string): void {
    const payload = { id: randomUUID().slice(0, 8), title, body, at: new Date().toISOString() };
    if (to.clientId) this.realtime.publish(clientRoom(to.clientId), 'notification', payload);
    if (to.driverId) this.realtime.publish(driverRoom(to.driverId), 'notification', payload);
  }

  list(limit = 50): Announcement[] {
    return this.items.slice(0, limit);
  }

  /** Annonces visibles par un public (app cliente / chauffeur). */
  forAudience(aud: 'clients' | 'drivers', limit = 10): Announcement[] {
    return this.items.filter((a) => a.audience === aud || a.audience === 'all').slice(0, limit);
  }
}
