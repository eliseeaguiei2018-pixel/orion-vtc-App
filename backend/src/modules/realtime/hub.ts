import { EventEmitter } from 'node:events';

/**
 * Hub temps réel en mémoire (pub/sub par "room").
 *
 * Les clients s'abonnent à des rooms : `ride:{id}` (suivi d'une course), `driver:{id}`,
 * ou `emergency` (poste de supervision / SAMU). En production multi-instances, on remplace
 * ce hub par Redis Pub/Sub afin que les nœuds WebSocket se propagent les messages entre
 * eux (cf. docs/05 §4) — l'interface reste identique.
 */
export interface RealtimeMessage {
  type: string;
  room: string;
  at: string;
  data: unknown;
}

export type RealtimeListener = (msg: RealtimeMessage) => void;

export class RealtimeHub {
  private readonly emitter = new EventEmitter();

  constructor() {
    // Beaucoup d'abonnés possibles (une course = client + chauffeur + superviseurs).
    this.emitter.setMaxListeners(0);
  }

  subscribe(room: string, listener: RealtimeListener): () => void {
    this.emitter.on(room, listener);
    return () => this.emitter.off(room, listener);
  }

  publish(room: string, type: string, data: unknown): RealtimeMessage {
    const msg: RealtimeMessage = { type, room, at: new Date().toISOString(), data };
    this.emitter.emit(room, msg);
    return msg;
  }

  subscriberCount(room: string): number {
    return this.emitter.listenerCount(room);
  }
}

export const rideRoom = (rideId: string) => `ride:${rideId}`;
export const driverRoom = (driverId: string) => `driver:${driverId}`;
export const EMERGENCY_ROOM = 'emergency';
/** Room globale des agents support + room par client (chat). */
export const SUPPORT_ROOM = 'support';
export const clientRoom = (clientId: string) => `client:${clientId}`;
/** Room de configuration publique : diffusion temps réel des changements pilotés depuis
 * la console (maintenance, services activés, passerelles de paiement). Toutes les apps
 * clientes connectées s'y mettent à jour instantanément. */
export const CONFIG_ROOM = 'config';
/** Room de la configuration CHAUFFEUR : réglages console qui concernent la flotte
 * (délai d'offre, commissions, dette espèces, heures creuses, attente, zones). Toutes les
 * apps chauffeur connectées s'y mettent à jour instantanément. */
export const DRIVER_CONFIG_ROOM = 'driver-config';
