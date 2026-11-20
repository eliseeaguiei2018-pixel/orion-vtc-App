import type { FastifyInstance, FastifyRequest } from 'fastify';
import { exigerTitulaire } from '../clients/auth.js';
import { z } from 'zod';
import type { Container } from '../../container.js';
import { parse } from '../../core/validate.js';
import { quoteWedding } from './service.js';

const optionsSchema = z.object({
  decoration: z.boolean().optional(),
  convoy: z.number().int().min(0).max(10).optional(),
  chauffeur: z.boolean().optional(),
});

export async function weddingRoutes(app: FastifyInstance, container: Container): Promise<void> {
  /** Données d'un client : un compte inscrit doit présenter sa propre session. */
  const titulaire = (req: FastifyRequest, id: string) =>
    exigerTitulaire(req, id, (c) => Boolean(container.clients.get(c)?.phoneVerifiedAt));

  // Devis de location mariage (prix selon niveau + durée + options).
  app.post('/wedding/quote', async (req) => {
    const body = parse(
      z.object({
        tier: z.enum(['bronze', 'argent', 'or', 'diamant']),
        date: z.string(),
        duration: z.enum(['halfday', 'fullday', 'weekend']).optional(),
        car: z.string().optional(),
        options: optionsSchema.optional(),
      }),
      req.body,
    );
    return { quote: quoteWedding(body) };
  });

  // Réservation ferme.
  app.post('/wedding/reserve', async (req, reply) => {
    const body = parse(
      z.object({
        userId: z.string().min(1),
        tier: z.enum(['bronze', 'argent', 'or', 'diamant']),
        date: z.string(),
        duration: z.enum(['halfday', 'fullday', 'weekend']).optional(),
        car: z.string().optional(),
        options: optionsSchema.optional(),
      }),
      req.body,
    );
    titulaire(req, body.userId);
    const quote = quoteWedding(body);
    const reservation = container.wedding.reserve(body.userId, quote);
    reply.code(201);
    return { reservation };
  });

  app.get('/wedding/:userId', async (req) => {
    const { userId } = req.params as { userId: string };
    titulaire(req, userId);
    return { reservations: container.wedding.listByUser(userId) };
  });
}
