import { randomUUID } from 'node:crypto';
import { SUPPORT_ROOM, clientRoom, type RealtimeHub } from '../realtime/hub.js';

/**
 * Support & chat : conversations entre les CLIENTS et les agents ORION.
 * C'est l'outil de travail du support (répondre, contacter, clore).
 * Temps réel : nouveaux messages poussés aux agents (room support) et au client.
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
  assignee?: string;
  messages: Message[];
  createdAt: string;
  updatedAt: string;
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
      conv = {
        id: randomUUID().slice(0, 8),
        clientId: input.clientId,
        subject: input.subject?.trim() || 'Assistance',
        status: 'open',
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

  get(convId: string): Conversation | undefined { return this.convs.get(convId); }

  list(): Conversation[] {
    return [...this.convs.values()].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  /** Conversations d'un client (app cliente). */
  listByClient(clientId: string): Conversation[] {
    return this.list().filter((c) => c.clientId === clientId);
  }
}
