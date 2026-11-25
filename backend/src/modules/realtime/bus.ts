import { randomUUID } from 'node:crypto';
import { Redis } from 'ioredis';
import type { RealtimeMessage } from './hub.js';

/**
 * BUS TEMPS RÉEL ENTRE INSTANCES.
 *
 * Un seul serveur ne suffit pas à des millions d'utilisateurs : on en fait tourner
 * plusieurs derrière un répartiteur de charge. Mais un chauffeur connecté à l'instance A
 * doit voir la course commandée par un client connecté à l'instance B, et le poste SAMU,
 * branché sur n'importe quelle instance, doit recevoir chaque SOS.
 *
 * Chaque instance publie donc ses messages temps réel sur un canal Redis commun, et
 * rediffuse localement ceux des autres. Son propre écho est ignoré (identifiant
 * d'instance) : un message n'est jamais livré deux fois.
 */
export interface BusTempsReel {
  readonly mode: 'local' | 'redis';
  readonly instance: string;
  /** Envoie un message aux autres instances. */
  diffuser(msg: RealtimeMessage): void;
  /** Reçoit les messages des AUTRES instances. */
  ecouter(recevoir: (msg: RealtimeMessage) => void): void;
  etat(): { mode: 'local' | 'redis'; instance: string; connecte: boolean; recus: number; envoyes: number; pertes: number };
  fermer(): Promise<void>;
}

/** Une seule instance (développement, petit déploiement) : rien ne sort du processus. */
export class BusLocal implements BusTempsReel {
  readonly mode = 'local' as const;
  readonly instance = `local-${process.pid}`;
  diffuser(): void {}
  ecouter(): void {}
  etat() {
    return { mode: this.mode, instance: this.instance, connecte: true, recus: 0, envoyes: 0, pertes: 0 };
  }
  async fermer(): Promise<void> {}
}

interface Enveloppe { o: string; m: RealtimeMessage }

export class BusRedis implements BusTempsReel {
  readonly mode = 'redis' as const;
  readonly instance = `${process.env.HOSTNAME ?? 'orion'}-${process.pid}-${randomUUID().slice(0, 8)}`;
  private readonly pub: Redis;
  private readonly sub: Redis;
  private recus = 0;
  private envoyes = 0;
  private pertes = 0;
  private connecte = false;

  constructor(url: string, private readonly canal = 'orion:temps-reel') {
    // Deux connexions : une connexion abonnée à Redis ne peut plus publier.
    const options = { lazyConnect: false, maxRetriesPerRequest: 2, enableOfflineQueue: true };
    this.pub = new Redis(url, options);
    this.sub = new Redis(url, options);
    this.sub.on('ready', () => { this.connecte = true; });
    this.sub.on('end', () => { this.connecte = false; });
    this.sub.on('error', () => { this.connecte = false; });
    this.pub.on('error', () => {});
  }

  /** Attend que l'abonnement soit actif : avant, des messages des autres instances seraient perdus. */
  async pret(): Promise<void> {
    await this.sub.subscribe(this.canal);
    this.connecte = true;
  }

  diffuser(msg: RealtimeMessage): void {
    const enveloppe: Enveloppe = { o: this.instance, m: msg };
    this.pub.publish(this.canal, JSON.stringify(enveloppe)).then(
      () => { this.envoyes += 1; },
      // Redis injoignable : l'instance continue de servir ses propres clients ; les
      // autres instances ne recevront pas ce message (compté, visible dans les mesures).
      () => { this.pertes += 1; },
    );
  }

  ecouter(recevoir: (msg: RealtimeMessage) => void): void {
    this.sub.on('message', (canal: string, texte: string) => {
      if (canal !== this.canal) return;
      let e: Enveloppe;
      try { e = JSON.parse(texte) as Enveloppe; } catch { return; }
      if (e.o === this.instance) return; // son propre écho
      this.recus += 1;
      recevoir(e.m);
    });
  }

  etat() {
    return { mode: this.mode, instance: this.instance, connecte: this.connecte, recus: this.recus, envoyes: this.envoyes, pertes: this.pertes };
  }

  async fermer(): Promise<void> {
    // Fermeture polie si Redis répond, coupée net après 500 ms sinon : un serveur qui
    // s'arrête ne doit jamais rester suspendu à un Redis tombé.
    await Promise.race([
      Promise.allSettled([this.sub.quit(), this.pub.quit()]),
      new Promise((ok) => setTimeout(ok, 500).unref()),
    ]);
    this.sub.disconnect();
    this.pub.disconnect();
  }
}
