import { EventEmitter } from 'node:events';
import { BusLocal, type BusTempsReel } from './bus.js';

/**
 * Hub temps réel en mémoire (pub/sub par "room").
 *
 * Les clients s'abonnent à des rooms : `ride:{id}` (suivi d'une course), `driver:{id}`,
 * ou `emergency` (poste de supervision / SAMU). En production multi-instances, le hub est
 * relié aux autres instances par un bus Redis (`bus.ts`, variable REDIS_URL) : chaque
 * message publié ici est aussi livré aux clients connectés aux autres instances. Le reste
 * du code ne voit aucune différence.
 */
export interface RealtimeMessage {
  type: string;
  room: string;
  at: string;
  data: unknown;
}

export type RealtimeListener = (msg: RealtimeMessage) => void;

/** Canal interne qui reçoit une copie de chaque message publié. */
const TOUTES_LES_ROOMS = '*';

export class RealtimeHub {
  private readonly emitter = new EventEmitter();
  private bus: BusTempsReel = new BusLocal();

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
    this.livrer(msg);
    this.bus.diffuser(msg);
    return msg;
  }

  /** Livraison aux abonnés de CETTE instance. */
  private livrer(msg: RealtimeMessage): void {
    this.emitter.emit(msg.room, msg);
    // Copie sur le canal global : le tableau de bord voit tout l'écosystème en direct.
    this.emitter.emit(TOUTES_LES_ROOMS, msg);
  }

  /**
   * Relie ce hub aux autres instances. Les messages venus d'ailleurs sont livrés ici
   * sans être renvoyés sur le bus (pas de boucle).
   */
  brancherBus(bus: BusTempsReel): void {
    this.bus = bus;
    bus.ecouter((msg) => this.livrer(msg));
  }

  etatBus() {
    return this.bus.etat();
  }

  fermerBus(): Promise<void> {
    return this.bus.fermer();
  }

  /** Tous les messages, toutes rooms confondues (tableau de bord, journal serveur). */
  subscribeAll(listener: RealtimeListener): () => void {
    return this.subscribe(TOUTES_LES_ROOMS, listener);
  }

  subscriberCount(room: string): number {
    return this.emitter.listenerCount(room);
  }
}

export const rideRoom = (rideId: string) => `ride:${rideId}`;
export const driverRoom = (driverId: string) => `driver:${driverId}`;
export const EMERGENCY_ROOM = 'emergency';
/**
 * Room d'UNE alerte, côté usager : la personne en détresse y suit sa prise en charge
 * (agent, messages, secours prévenus). Elle ne voit jamais les autres alertes.
 */
export const sosRoom = (alertId: string) => `sos:${alertId}`;
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
/** Room du tableau de bord ORION (journal d'activité de tout l'écosystème). */
export const DASHBOARD_ROOM = 'tableau';
