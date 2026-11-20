import { randomUUID } from 'node:crypto';
import type { Repository } from '../../core/db/repository.js';
import type { LatLng } from '../../core/geo.js';
import { clientRoom, rideRoom, type RealtimeHub } from '../realtime/hub.js';
import type { SafetyService } from '../safety/service.js';

/**
 * MESSAGERIE ORION → CLIENT.
 *
 * La supervision informe les clients (consignes : pluies, route coupée, mesure de
 * sécurité) et, pendant une course, l'app pose d'elle-même la question qui compte :
 * « Votre course se passe-t-elle bien ? Êtes-vous en sécurité ? ». Le client répond
 * d'un geste, par une réponse proposée.
 *
 * Une réponse « Je ne me sens pas en sécurité » n'est pas un simple accusé de
 * lecture : elle lève AUSSITÔT une alerte SOS auprès de la supervision, avec la
 * course et la position, exactement comme le bouton SOS.
 */

export type TypeMessage = 'info' | 'consigne' | 'controle';

export interface ReponseProposee {
  code: string;
  libelle: string;
  /** Réponse qui déclenche une alerte de sécurité. */
  alerte?: boolean;
}

export interface MessageClient {
  id: string;
  clientId: string;
  type: TypeMessage;
  titre: string;
  texte: string;
  /** Agent de la console, ou « ORION » pour les messages automatiques. */
  auteur: string;
  rideId?: string;
  reponses: ReponseProposee[];
  reponse?: { code: string; libelle: string; le: string };
  envoyeLe: string;
  luLe?: string;
  /** Contrôle de sécurité d'une course terminée : il n'attend plus de réponse. */
  clos?: boolean;
}

/** Contrôle de sécurité pendant la course : les réponses que le client voit. */
export const REPONSES_CONTROLE: ReponseProposee[] = [
  { code: 'ok', libelle: 'Tout va bien, merci' },
  { code: 'appel', libelle: 'Appelez-moi' },
  { code: 'danger', libelle: 'Je ne me sens pas en sécurité', alerte: true },
];

/** Consigne : le client confirme qu'il l'a lue. */
export const REPONSES_CONSIGNE: ReponseProposee[] = [
  { code: 'lu', libelle: 'J’ai compris' },
  { code: 'question', libelle: 'J’ai une question' },
];

export interface ContexteAlerte {
  /** Dernière position connue de la course (ou départ), pour l'alerte. */
  position(rideId: string | undefined, clientId: string): LatLng;
  /** La course est-elle encore en cours ? Un contrôle de sécurité ne vaut que pendant sa course. */
  courseActive?(rideId: string): boolean;
}

export class MessagerieService {
  constructor(
    private readonly repo: Repository<MessageClient>,
    private readonly realtime: RealtimeHub,
    private readonly safety: SafetyService,
    private readonly contexte: ContexteAlerte,
  ) {}

  envoyer(clientId: string, m: { type: TypeMessage; titre: string; texte: string; auteur?: string; rideId?: string; reponses?: ReponseProposee[] }): MessageClient {
    const message: MessageClient = {
      id: randomUUID(),
      clientId,
      type: m.type,
      titre: m.titre,
      texte: m.texte,
      auteur: m.auteur ?? 'ORION',
      rideId: m.rideId,
      reponses: m.reponses ?? (m.type === 'controle' ? REPONSES_CONTROLE : m.type === 'consigne' ? REPONSES_CONSIGNE : []),
      envoyeLe: new Date().toISOString(),
    };
    this.repo.put(message);
    this.realtime.publish(clientRoom(clientId), 'message', message);
    // Pendant une course, l'app écoute le canal de la course : le message s'affiche aussitôt.
    if (message.rideId) this.realtime.publish(rideRoom(message.rideId), 'message', message);
    return message;
  }

  /** Message automatique d'information (ex. : consultation du dossier ORION Assurance). */
  envoyerSysteme(clientId: string, m: { titre: string; texte: string; type?: TypeMessage }): MessageClient {
    return this.envoyer(clientId, { type: m.type ?? 'info', titre: m.titre, texte: m.texte });
  }

  /** Contrôle de sécurité d'une course (automatique ou demandé par la console). */
  controleSecurite(clientId: string, rideId: string, auteur = 'ORION'): MessageClient {
    return this.envoyer(clientId, {
      type: 'controle', rideId, auteur,
      titre: 'Votre course se passe-t-elle bien ?',
      texte: 'La supervision ORION veille sur votre trajet. Êtes-vous en sécurité ? Répondez d’un geste.',
    });
  }

  aDejaUnControle(rideId: string): boolean {
    return this.repo.all().some((m) => m.rideId === rideId && m.type === 'controle');
  }

  liste(clientId: string): MessageClient[] {
    return this.repo.all().filter((m) => m.clientId === clientId).sort((a, b) => b.envoyeLe.localeCompare(a.envoyeLe))
      .map((m) => (this.controleClos(m) ? { ...m, reponses: [], clos: true } : m));
  }

  /**
   * Un contrôle de sécurité sans réponse dont la course est terminée n'appelle plus de
   * réponse : « je ne me sens pas en sécurité » lèverait une alerte sur une course finie.
   * Le client garde le bouton SOS pour toute urgence.
   */
  private controleClos(m: MessageClient): boolean {
    return m.type === 'controle' && !m.reponse && Boolean(m.rideId) && this.contexte.courseActive?.(m.rideId!) === false;
  }

  nonLus(clientId: string): number {
    return this.repo.all().filter((m) => m.clientId === clientId && !m.luLe).length;
  }

  marquerLu(clientId: string, id: string): MessageClient | null {
    const m = this.repo.get(id);
    if (!m || m.clientId !== clientId) return null;
    if (!m.luLe) {
      m.luLe = new Date().toISOString();
      this.repo.put(m);
    }
    return m;
  }

  /**
   * Réponse du client. « danger » lève une alerte SOS (la supervision la voit dans
   * la file SAMU comme un appui sur le bouton SOS).
   */
  repondre(clientId: string, id: string, code: string): { message: MessageClient; alerteId?: string } | null {
    const m = this.repo.get(id);
    if (!m || m.clientId !== clientId || this.controleClos(m)) return null;
    const choix = m.reponses.find((r) => r.code === code);
    if (!choix) return null;
    const le = new Date().toISOString();
    m.reponse = { code: choix.code, libelle: choix.libelle, le };
    m.luLe = m.luLe ?? le;
    this.repo.put(m);
    let alerteId: string | undefined;
    if (choix.alerte) {
      const alerte = this.safety.raiseSos({
        userId: clientId,
        rideId: m.rideId,
        location: this.contexte.position(m.rideId, clientId),
        note: `Réponse au contrôle de sécurité : « ${choix.libelle} »`,
        source: 'client',
      });
      alerteId = alerte.id;
    }
    return { message: m, alerteId };
  }

  /** Console : derniers messages envoyés et réponses reçues. */
  recents(limite = 100): MessageClient[] {
    return this.repo.all().sort((a, b) => b.envoyeLe.localeCompare(a.envoyeLe)).slice(0, limite);
  }
}
