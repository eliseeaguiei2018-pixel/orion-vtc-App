import { randomUUID } from 'node:crypto';
import type { Repository } from '../../core/db/repository.js';

/**
 * COMMUNICATION INTERNE — ce qu'un chef d'équipe dit à ses membres, et ce qu'il
 * leur demande de rendre.
 *
 * Diriger une équipe ne se réduit pas à voir une liste de noms. Un manager écrit à
 * quelqu'un, demande un point sur une situation, attend un bilan de fin de semaine,
 * et doit savoir qui a lu, qui a répondu, qui n'a rien rendu. Tout cela se faisait
 * par téléphone et par messages personnels : rien n'était rattaché au travail, rien
 * n'était retrouvable, et un chef muté laissait son équipe sans mémoire.
 *
 * Deux objets, volontairement distincts :
 *  - le MESSAGE, qui informe ou demande une réponse courte ;
 *  - la DEMANDE DE RAPPORT, qui appelle un livrable daté, avec une échéance, un
 *    rendu et un retour. Un rapport n'est pas un message : il se relance, il se
 *    refuse, et son absence se voit.
 */

export interface ReponseMessage {
  de: string;
  deNom: string;
  texte: string;
  at: string;
}

export interface MessageInterne {
  id: string;
  de: string;
  deNom: string;
  /** Destinataire (identifiant de connexion). */
  a: string;
  aNom: string;
  teamId?: string;
  sujet?: string;
  texte: string;
  /** Urgent : le destinataire doit le traiter avant le reste de sa journée. */
  urgent: boolean;
  /** Le message attend une réponse, pas seulement une lecture. */
  reponseAttendue: boolean;
  at: string;
  luLe?: string;
  reponses: ReponseMessage[];
}

export type StatutRapport = 'demande' | 'rendu' | 'accepte' | 'a_revoir';

export const STATUT_RAPPORT_LABEL: Record<StatutRapport, string> = {
  demande: 'Attendu', rendu: 'Rendu, en attente de lecture',
  accepte: 'Accepté', a_revoir: 'À revoir',
};

export interface DemandeRapport {
  id: string;
  teamId: string;
  demandePar: string;
  demandeParNom: string;
  destinataire: string;
  destinataireNom: string;
  titre: string;
  /** Ce qu'on attend précisément : sans consigne, on reçoit n'importe quoi. */
  consigne: string;
  echeance: string;
  statut: StatutRapport;
  createdAt: string;
  rendu?: { texte: string; at: string };
  retour?: { texte: string; at: string; par: string };
}

export class StaffCommsService {
  private readonly messages = new Map<string, MessageInterne>();
  private readonly rapports = new Map<string, DemandeRapport>();
  private readonly ecouteurs: Array<(e: { kind: 'message' | 'rapport'; a: string; objet: MessageInterne | DemandeRapport }) => void> = [];

  constructor(
    private readonly repoMessages?: Repository<MessageInterne>,
    private readonly repoRapports?: Repository<DemandeRapport>,
  ) {
    for (const m of repoMessages?.all() ?? []) this.messages.set(m.id, m);
    for (const r of repoRapports?.all() ?? []) this.rapports.set(r.id, r);
  }

  onChange(fn: (e: { kind: 'message' | 'rapport'; a: string; objet: MessageInterne | DemandeRapport }) => void): void {
    this.ecouteurs.push(fn);
  }

  private prevenir(kind: 'message' | 'rapport', a: string, objet: MessageInterne | DemandeRapport): void {
    for (const fn of this.ecouteurs) fn({ kind, a, objet });
  }

  /* --------------------------------- Messages -------------------------------- */

  ecrire(input: {
    de: string; deNom: string; a: string; aNom: string;
    teamId?: string; sujet?: string; texte: string;
    urgent?: boolean; reponseAttendue?: boolean;
  }): MessageInterne {
    const m: MessageInterne = {
      id: randomUUID().slice(0, 8),
      de: input.de, deNom: input.deNom, a: input.a, aNom: input.aNom,
      teamId: input.teamId, sujet: input.sujet, texte: input.texte,
      urgent: input.urgent ?? false,
      reponseAttendue: input.reponseAttendue ?? false,
      at: new Date().toISOString(),
      reponses: [],
    };
    this.messages.set(m.id, m);
    this.repoMessages?.put(m);
    this.prevenir('message', m.a, m);
    return m;
  }

  marquerLu(id: string, par: string): MessageInterne | 'pas_destinataire' | null {
    const m = this.messages.get(id);
    if (!m) return null;
    if (m.a !== par) return 'pas_destinataire';
    m.luLe ??= new Date().toISOString();
    this.repoMessages?.put(m);
    return m;
  }

  /** Répondre : l'auteur comme le destinataire peuvent poursuivre l'échange. */
  repondre(id: string, de: string, deNom: string, texte: string): MessageInterne | 'hors_conversation' | null {
    const m = this.messages.get(id);
    if (!m) return null;
    if (de !== m.a && de !== m.de) return 'hors_conversation';
    m.luLe ??= de === m.a ? new Date().toISOString() : m.luLe;
    m.reponses.push({ de, deNom, texte, at: new Date().toISOString() });
    this.repoMessages?.put(m);
    this.prevenir('message', de === m.a ? m.de : m.a, m);
    return m;
  }

  /** Boîte de réception : ce qui m'est adressé. */
  recus(username: string): MessageInterne[] {
    return [...this.messages.values()]
      .filter((m) => m.a === username)
      .sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
  }

  /** Ce que j'ai envoyé — un chef doit pouvoir vérifier qui n'a pas lu. */
  envoyes(username: string): MessageInterne[] {
    return [...this.messages.values()]
      .filter((m) => m.de === username)
      .sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
  }

  nonLus(username: string): number {
    return this.recus(username).filter((m) => !m.luLe).length;
  }

  messagesEquipe(teamId: string): MessageInterne[] {
    return [...this.messages.values()]
      .filter((m) => m.teamId === teamId)
      .sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
  }

  /* --------------------------------- Rapports -------------------------------- */

  demanderRapport(input: {
    teamId: string; demandePar: string; demandeParNom: string;
    destinataire: string; destinataireNom: string;
    titre: string; consigne: string; echeance: string;
  }): DemandeRapport {
    const r: DemandeRapport = {
      id: randomUUID().slice(0, 8),
      ...input,
      statut: 'demande',
      createdAt: new Date().toISOString(),
    };
    this.rapports.set(r.id, r);
    this.repoRapports?.put(r);
    this.prevenir('rapport', r.destinataire, r);
    return r;
  }

  /** Le membre rend son rapport. Un rapport rendu puis corrigé reste le même dossier. */
  rendre(id: string, par: string, texte: string): DemandeRapport | 'pas_destinataire' | 'deja_accepte' | null {
    const r = this.rapports.get(id);
    if (!r) return null;
    if (r.destinataire !== par) return 'pas_destinataire';
    if (r.statut === 'accepte') return 'deja_accepte';
    r.rendu = { texte, at: new Date().toISOString() };
    r.statut = 'rendu';
    this.repoRapports?.put(r);
    this.prevenir('rapport', r.demandePar, r);
    return r;
  }

  /** Le chef lit et tranche : accepté, ou à revoir avec un motif. */
  statuer(id: string, par: string, decision: 'accepte' | 'a_revoir', texte?: string): DemandeRapport | 'pas_demandeur' | 'rien_rendu' | null {
    const r = this.rapports.get(id);
    if (!r) return null;
    if (r.demandePar !== par) return 'pas_demandeur';
    if (!r.rendu) return 'rien_rendu';
    r.statut = decision;
    r.retour = { texte: texte ?? '', at: new Date().toISOString(), par };
    this.repoRapports?.put(r);
    this.prevenir('rapport', r.destinataire, r);
    return r;
  }

  get(id: string): DemandeRapport | undefined { return this.rapports.get(id); }
  getMessage(id: string): MessageInterne | undefined { return this.messages.get(id); }

  rapports_(filtre: { teamId?: string; destinataire?: string; demandePar?: string; statut?: StatutRapport } = {}): DemandeRapport[] {
    return [...this.rapports.values()]
      .filter((r) => (!filtre.teamId || r.teamId === filtre.teamId)
        && (!filtre.destinataire || r.destinataire === filtre.destinataire)
        && (!filtre.demandePar || r.demandePar === filtre.demandePar)
        && (!filtre.statut || r.statut === filtre.statut))
      .sort((a, b) => Date.parse(a.echeance) - Date.parse(b.echeance));
  }

  /** Rapports attendus dont l'échéance est passée : c'est ce qui doit se voir. */
  enRetard(now = Date.now()): DemandeRapport[] {
    return [...this.rapports.values()].filter(
      (r) => r.statut === 'demande' && Date.parse(r.echeance) < now,
    );
  }
}
