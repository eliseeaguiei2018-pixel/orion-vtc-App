import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Container } from '../../container.js';
import { parse } from '../../core/validate.js';
import { notFound } from '../../core/errors.js';

export async function walletRoutes(app: FastifyInstance, container: Container): Promise<void> {
  app.get('/drivers/:id/wallet', async (req) => {
    const { id } = req.params as { id: string };
    if (!container.drivers.get(id)) throw notFound('Chauffeur introuvable');
    return { balance: container.wallet.balance(id), currency: 'XOF', history: container.wallet.history(id) };
  });

  app.post('/drivers/:id/payout', async (req) => {
    const { id } = req.params as { id: string };
    if (!container.drivers.get(id)) throw notFound('Chauffeur introuvable');
    const body = parse(z.object({ amount: z.number().positive(), method: z.string().optional() }), req.body);
    const entry = container.wallet.requestPayout(id, body.amount);
    return { payout: entry, balance: container.wallet.balance(id) };
  });
}
