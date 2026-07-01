import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Container } from '../../container.js';
import { parse } from '../../core/validate.js';
import { notFound } from '../../core/errors.js';

/**
 * Endpoints SUPPORT côté client (app cliente) + config publique.
 * Le client ouvre une conversation et échange avec les agents ORION (chat).
 */
export async function supportClientRoutes(app: FastifyInstance, container: Container): Promise<void> {
  // Config publique : services activés + ville ouverte (l'app cliente adapte son hub).
  app.get('/config', async () => ({ ...container.settings.getServices(), currency: 'XOF' }));

  // Annonces publiques (bannière app cliente).
  app.get('/announcements', async () => ({ announcements: container.notifications.forAudience('clients') }));

  // Le client démarre / poursuit une conversation.
  app.post('/support/messages', async (req, reply) => {
    const body = parse(
      z.object({ clientId: z.string().min(1), subject: z.string().optional(), text: z.string().min(1).max(2000) }),
      req.body,
    );
    container.clients.touch(body.clientId);
    const conv = container.support.openFromClient(body);
    reply.code(201);
    return { conversation: conv };
  });

  // Le client consulte ses conversations.
  app.get('/clients/:clientId/support', async (req) => {
    const { clientId } = req.params as { clientId: string };
    return { conversations: container.support.listByClient(clientId) };
  });

  // Le client répond dans une conversation existante.
  app.post('/support/:id/reply', async (req) => {
    const { id } = req.params as { id: string };
    const body = parse(z.object({ text: z.string().min(1).max(2000) }), req.body);
    const msg = container.support.post(id, { from: 'client', text: body.text });
    if (!msg) throw notFound('Conversation introuvable');
    return { message: msg };
  });
}
