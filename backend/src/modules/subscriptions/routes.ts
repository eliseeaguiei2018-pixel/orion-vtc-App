import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Container } from '../../container.js';
import { parse } from '../../core/validate.js';
import { PLANS, PLAN_IDS } from './service.js';

export async function subscriptionRoutes(app: FastifyInstance, container: Container): Promise<void> {
  app.get('/subscriptions/plans', async () => ({ plans: PLAN_IDS.map((p) => PLANS[p]) }));

  app.get('/subscriptions/:userId', async (req) => {
    const { userId } = req.params as { userId: string };
    return { subscription: container.subscriptions.get(userId) ?? null };
  });

  app.post('/subscriptions', async (req, reply) => {
    const body = parse(
      z.object({ userId: z.string().min(1), plan: z.enum(['bronze', 'argent', 'gold']), paymentMethod: z.string().optional() }),
      req.body,
    );
    const subscription = container.subscriptions.subscribe(body.userId, body.plan);
    reply.code(201);
    return { subscription };
  });

  app.post('/subscriptions/:userId/cancel', async (req) => {
    const { userId } = req.params as { userId: string };
    return { subscription: container.subscriptions.cancel(userId) };
  });
}
