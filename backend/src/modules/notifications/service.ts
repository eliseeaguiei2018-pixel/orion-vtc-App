import { randomUUID } from 'node:crypto';
import { clientRoom, driverRoom, SUPPORT_ROOM, type RealtimeHub } from '../realtime/hub.js';

/** Room globale des annonces (clients / chauffeurs). */
export const ANNOUNCE_ROOM = 'announcements';

export type Audience = 'clients' | 'drivers' | 'all';
/** Canal de diffusion : push in-app (défaut), SMS (critique/hors-ligne), e-mail (bilans). */
export type Channel = 'push' | 'sms' | 'email';
/** Segments comportementaux (hyper-ciblage) — audiences dynamiques. */
export type Segment = 'tous' | 'nouveaux' | 'vip' | 'green' | 'inactifs';

/** Annonce diffusée depuis la console (promo, info service, maintenance…). */
export interface Announcement {
  id: string;
  audience: Audience;
  title: string;
  body: string;
  author: string;
  at: string;
  /* --- Studio multicanal & ciblage --- */
  channel?: Channel;
  segment?: Segment;
  /** Geofencing : campagne circonscrite à une zone (id de zone console). */
  zoneId?: string;
  /** Planification : envoi différé à cette date/heure. */
  scheduledAt?: string;
  /** Performance de campagne (délivrabilité, ouverture, clics, courses générées). */
  stats?: { sent: number; delivered: number; opened: number; clicked: number; rides: number };
}

/** Taux d'ouverture de référence par canal (suivi de conversion). */
const OPEN_RATE: Record<Channel, number> = { push: 0.55, sms: 0.9, email: 0.32 };

/**
 * Notifications / diffusion : l'ORION « parle » à ses utilisateurs depuis la console.
 * Temps réel (WS) vers la room d'annonces + historique consultable.
 * Les balises de personnalisation ([Prénom], [Destination_Favorite]) sont résolues
 * côté app à l'affichage — le message stocké garde les balises.
 */
export class NotificationService {
  private readonly items: Announcement[] = [];

  constructor(private readonly realtime: RealtimeHub) {}

  broadcast(input: {
    audience: Audience; title: string; body: string; author: string;
    channel?: Channel; segment?: Segment; zoneId?: string; scheduledAt?: string;
    /** Taille de l'audience ciblée (calculée par la console) — alimente les stats. */
    audienceCount?: number;
  }): Announcement {
    const { audienceCount, ...rest } = input;
    const channel = input.channel ?? 'push';
    const sent = Math.max(0, Math.round(audienceCount ?? 0));
    const delivered = Math.round(sent * 0.97);
    const opened = Math.round(delivered * OPEN_RATE[channel]);
    const a: Announcement = {
      id: randomUUID().slice(0, 8),
      at: new Date().toISOString(),
      ...rest,
      channel,
      stats: { sent, delivered, opened, clicked: Math.round(opened * 0.3), rides: Math.round(opened * 0.08) },
    };
    this.items.unshift(a);
    if (this.items.length > 200) this.items.pop();
    // Diffusion temps réel (room globale + relais support pour la console).
    // Les campagnes planifiées ne partent qu'à l'échéance (historique seulement).
    if (!a.scheduledAt || Date.parse(a.scheduledAt) <= Date.now()) {
      this.realtime.publish(ANNOUNCE_ROOM, 'announcement', a);
      this.realtime.publish(SUPPORT_ROOM, 'announcement', a);
    }
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
    return this.items
      .filter((a) => (a.audience === aud || a.audience === 'all') && (!a.scheduledAt || Date.parse(a.scheduledAt) <= Date.now()))
      .slice(0, limit);
  }
}
