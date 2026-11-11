import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Container } from '../../container.js';
import { notFound } from '../../core/errors.js';
import { parse } from '../../core/validate.js';
import { exigerTitulaire } from '../clients/auth.js';

/** Messagerie ORION : routes du client (boîte de réception, lecture, réponse rapide). */
export async function messagesRoutes(app: FastifyInstance, container: Container): Promise<void> {
  const titulaire = (req: Parameters<typeof exigerTitulaire>[0], id: string) =>
    exigerTitulaire(req, id, (c) => Boolean(container.clients.get(c)));

  app.get('/clients/:clientId/messages', async (req) => {
    const { clientId } = req.params as { clientId: string };
    titulaire(req, clientId);
    return { messages: container.messages.liste(clientId), nonLus: container.messages.nonLus(clientId) };
  });

  app.post('/clients/:clientId/messages/:id/lu', async (req) => {
    const { clientId, id } = req.params as { clientId: string; id: string };
    titulaire(req, clientId);
    const message = container.messages.marquerLu(clientId, id);
    if (!message) throw notFound('Message introuvable');
    return { message, nonLus: container.messages.nonLus(clientId) };
  });

  app.post('/clients/:clientId/messages/:id/reponse', { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } }, async (req) => {
    const { clientId, id } = req.params as { clientId: string; id: string };
    titulaire(req, clientId);
    const body = parse(z.object({ code: z.string().min(1).max(20) }), req.body);
    const r = container.messages.repondre(clientId, id, body.code);
    if (!r) throw notFound('Message ou réponse introuvable');
    container.audit.log({
      actor: `client:${clientId}`, role: 'client', action: r.alerteId ? 'message.reponse_alerte' : 'message.reponse',
      target: id, details: { code: body.code, alerte: r.alerteId },
    });
    return { message: r.message, alerteId: r.alerteId ?? null, nonLus: container.messages.nonLus(clientId) };
  });
}
