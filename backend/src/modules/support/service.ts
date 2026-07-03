import { randomUUID } from 'node:crypto';
import { SUPPORT_ROOM, clientRoom, type RealtimeHub } from '../realtime/hub.js';

/**
 * Support & chat : conversations entre les CLIENTS et les agents ORION.
 * C'est l'outil de travail du support (répondre, contacter, clore).
 * Temps réel : nouveaux messages poussés aux agents (room support) et au client.
 *
 * File d'attente INTELLIGENTE : chaque ticket reçoit une priorité automatique
 * (1 = objet oublié > 2 = facturation > 3 = question générale) ; la console trie
 * la boîte de réception par priorité puis ancienneté. Le CSAT post-résolution et
 * le temps de première réponse alimentent les indicateurs SLA des agents.
 */
export type Sender = 'client' | 'agent';
export type ConvStatus = 'open' | 'pending' | 'closed';

export interface Message {
  id: string;
  from: Sender;
  author?: string; // nom de l'agent
  text: string;
  at: string;
}

export interface Conversation {
  id: string;
  clientId: string;
  subject: string;
  status: ConvStatus;
  /** Priorité automatique : 1 (objet oublié) > 2 (facturation) > 3 (général). */
  priority: number;
  assignee?: string;
  messages: Message[];
  /** Première réponse d'un agent (calcul du SLA de première réponse). */
  firstAgentAt?: string;
  /** Satisfaction post-résolution (1–5) laissée par le client. */
  csat?: number;
  createdAt: string;
  updatedAt: string;
}

/** Bibliothèque de réponses pré-rédigées (macros) — réponse en un clic. */
export const SUPPORT_MACROS = [
  { title: 'Objet oublié', text: 'Nous avons contacté votre chauffeur au sujet de l’objet oublié. Nous revenons vers vous dès qu’il nous confirme l’avoir retrouvé. Votre objet vous sera restitué sans frais.' },
  { title: 'Procédure d’annulation', text: 'Vous pouvez annuler sans frais tant que le chauffeur n’est pas arrivé au point de rendez-vous. Au-delà, des frais d’annulation peuvent s’appliquer pour dédommager le chauffeur.' },
  { title: 'Erreur de facturation', text: 'Après vérification du trajet GPS et du devis verrouillé, nous procédons à l’ajustement. La différence sera recréditée sur votre portefeuille ORION sous 24 h.' },
  { title: 'Fonctionnement du parrainage', text: 'Partagez votre code depuis l’app : votre filleul reçoit une réduction sur sa première course et vous recevez votre prime dès sa course terminée.' },
  { title: 'Prix fixe garanti', text: 'Chez ORION, le prix affiché avant la course est FIXE et garanti : trafic déjà intégré, aucun supplément surprise à l’arrivée.' },
  { title: 'Geste commercial', text: 'Pour nous excuser de ce désagrément, nous venons de déposer un code de réduction personnalisé dans votre application. Merci de votre fidélité.' },
];

/** Priorité automatique déduite de l'objet du ticket. */
function priorityFor(subject: string): number {
  const s = subject.toLowerCase();
  if (/objet|oubli|perdu|t[ée]l[ée]phone|sac/.test(s)) return 1;
  if (/factur|paiement|prix|rembours|d[ée]bit/.test(s)) return 2;
  return 3;
}

export class SupportService {
  private readonly convs = new Map<string, Conversation>();

  constructor(private readonly realtime: RealtimeHub) {}

  /** Ouvre (ou récupère) une conversation pour un client et poste son 1er message. */
  openFromClient(input: { clientId: string; subject?: string; text: string }): Conversation {
    // Réutilise une conversation ouverte du même client s'il en existe une.
    let conv = [...this.convs.values()].find((c) => c.clientId === input.clientId && c.status !== 'closed');
    const now = new Date().toISOString();
    if (!conv) {
      const subject = input.subject?.trim() || 'Assistance';
      conv = {
        id: randomUUID().slice(0, 8),
        clientId: input.clientId,
        subject,
        status: 'open',
        priority: priorityFor(subject),
        messages: [],
        createdAt: now,
        updatedAt: now,
      };
      this.convs.set(conv.id, conv);
    }
    this.post(conv.id, { from: 'client', text: input.text });
    return conv;
  }

  post(convId: string, input: { from: Sender; author?: string; text: string }): Message | undefined {
    const conv = this.convs.get(convId);
    if (!conv) return undefined;
    const msg: Message = { id: randomUUID().slice(0, 8), from: input.from, author: input.author, text: input.text, at: new Date().toISOString() };
    conv.messages.push(msg);
    conv.updatedAt = msg.at;
    conv.status = input.from === 'client' ? 'open' : 'pending';
    if (input.from === 'agent') conv.firstAgentAt ??= msg.at; // SLA de première réponse
    // Temps réel : agents + client concerné.
    this.realtime.publish(SUPPORT_ROOM, 'support.message', { convId, message: msg });
    this.realtime.publish(clientRoom(conv.clientId), 'support.message', { convId, message: msg });
    return msg;
  }

  assign(convId: string, agent: string): Conversation | undefined {
    const conv = this.convs.get(convId);
    if (conv) { conv.assignee = agent; conv.updatedAt = new Date().toISOString(); }
    return conv;
  }

  setStatus(convId: string, status: ConvStatus): Conversation | undefined {
    const conv = this.convs.get(convId);
    if (conv) { conv.status = status; conv.updatedAt = new Date().toISOString(); }
    return conv;
  }

  /** Note de satisfaction post-résolution (CSAT) laissée par le client. */
  rateCsat(convId: string, stars: number): Conversation | undefined {
    const conv = this.convs.get(convId);
    if (conv) { conv.csat = Math.min(5, Math.max(1, Math.round(stars))); conv.updatedAt = new Date().toISOString(); }
    return conv;
  }

  get(convId: string): Conversation | undefined { return this.convs.get(convId); }

  list(): Conversation[] {
    return [...this.convs.values()].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  /** Boîte de réception triée : priorité (1 d'abord) puis ancienneté (SLA). */
  inbox(): Conversation[] {
    const rank = (c: Conversation) => (c.status === 'closed' ? 10 : c.priority ?? 3);
    return [...this.convs.values()].sort((a, b) => rank(a) - rank(b) || a.updatedAt.localeCompare(b.updatedAt));
  }

  /** Indicateurs SLA / CSAT de la session support (temps réel). */
  stats(): { open: number; resolvedToday: number; avgFirstReplyMin: number | null; csat: number | null } {
    const convs = [...this.convs.values()];
    const today = new Date().toISOString().slice(0, 10);
    const replied = convs.filter((c) => c.firstAgentAt);
    const avg = replied.length
      ? replied.reduce((s, c) => s + (Date.parse(c.firstAgentAt!) - Date.parse(c.createdAt)), 0) / replied.length / 60_000
      : null;
    const rated = convs.filter((c) => c.csat !== undefined);
    return {
      open: convs.filter((c) => c.status !== 'closed').length,
      resolvedToday: convs.filter((c) => c.status === 'closed' && c.updatedAt.startsWith(today)).length,
      avgFirstReplyMin: avg === null ? null : Math.round(avg * 10) / 10,
      csat: rated.length ? Math.round((rated.reduce((s, c) => s + (c.csat ?? 0), 0) / rated.length) * 100) / 100 : null,
    };
  }

  /** Conversations d'un client (app cliente). */
  listByClient(clientId: string): Conversation[] {
    return this.list().filter((c) => c.clientId === clientId);
  }
}
