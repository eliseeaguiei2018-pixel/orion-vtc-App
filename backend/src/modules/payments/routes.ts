import { randomUUID } from 'node:crypto';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { Container } from '../../container.js';
import { parse } from '../../core/validate.js';
import { badRequest, notFound } from '../../core/errors.js';
import { PAYMENT_CATALOG, type PaymentMethod } from './providers.js';

const idempotencyKey = (req: FastifyRequest): string | undefined => {
  const h = req.headers['idempotency-key'];
  return Array.isArray(h) ? h[0] : h;
};

export async function paymentRoutes(app: FastifyInstance, container: Container): Promise<void> {
  // Catalogue des moyens de paiement (mobile money en tête pour la CI).
  app.get('/payments/methods', async () => ({ methods: PAYMENT_CATALOG }));

  // Paiement d'une course (idempotent) via le moyen choisi.
  app.post('/rides/:id/pay', async (req) => {
    const { id } = req.params as { id: string };
    const schema = z.object({
      method: z.enum(['cash', 'orange_money', 'mtn_momo', 'moov_money', 'wave', 'card']),
      phone: z.string().optional(),
    });
    const body = parse(schema, req.body);

    const ride = container.rides.get(id);
    if (!ride) throw notFound('Course introuvable');
    if (ride.status !== 'completed') {
      throw badRequest('La course doit être terminée avant paiement');
    }

    const provider = container.payments.get(body.method as PaymentMethod);
    if (!provider) throw badRequest('Moyen de paiement indisponible');

    const result = await container.idempotency.run(idempotencyKey(req), () =>
      provider.charge({
        method: body.method as PaymentMethod,
        amount: ride.quote.amount,
        currency: 'XOF',
        phone: body.phone,
        reference: randomUUID(),
      }),
    );

    // Le paiement passe la course à l'état "paid" lorsqu'il est capturé/autorisé.
    if (result.status === 'authorized' || result.status === 'captured') {
      ride.status = 'paid';
      ride.events.push({ type: 'paid', at: new Date().toISOString(), payload: { method: result.method, amount: result.amount } });
    }
    return { payment: result, rideStatus: ride.status };
  });
}
