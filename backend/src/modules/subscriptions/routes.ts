import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Container } from '../../container.js';
import { parse } from '../../core/validate.js';
import { badRequest, notFound } from '../../core/errors.js';
import { PLANS, PLAN_IDS } from './service.js';

export async function subscriptionRoutes(app: FastifyInstance, container: Container): Promise<void> {
  app.get('/subscriptions/plans', async () => ({ plans: PLAN_IDS.map((p) => PLANS[p]) }));

  /** État complet : forfait, échéance, quota du jour, facture en attente. */
  app.get('/subscriptions/:userId', async (req) => {
    const { userId } = req.params as { userId: string };
    const etat = container.subscriptions.etat(userId);
    return { ...etat, invoices: container.subscriptions.facturesDe(userId) };
  });

  app.post('/subscriptions', async (req, reply) => {
    const body = parse(
      z.object({
        userId: z.string().min(1),
        plan: z.enum(['bronze', 'argent', 'gold']),
        paymentMethod: z.string().max(40).optional(),
        autoRenew: z.boolean().optional(),
      }),
      req.body,
    );
    const subscription = container.subscriptions.subscribe(body.userId, body.plan, {
      paymentMethod: body.paymentMethod,
      autoRenew: body.autoRenew,
    });
    // La facture de la période est émise d'office : un abonnement sans facture à
    // encaisser n'existe pas en pratique.
    const facture = container.subscriptions.facturesDe(body.userId)[0] ?? null;
    reply.code(201);
    return { subscription, facture };
  });

  /**
   * Ce que l'abonnement apporterait sur une course — sans rien consommer.
   * L'app cliente s'en sert pour afficher « course incluse » avant la commande.
   */
  app.post('/subscriptions/:userId/apercu', async (req) => {
    const { userId } = req.params as { userId: string };
    const body = parse(z.object({ amount: z.number().min(0), tier: z.string().max(20).optional() }), req.body);
    return { coverage: container.subscriptions.apercu(userId, body) };
  });

  /** Règlement de la facture d'abonnement via une passerelle (mobile money, carte). */
  app.post('/subscriptions/factures/:id/payer', async (req) => {
    const { id } = req.params as { id: string };
    const body = parse(
      z.object({
        method: z.enum(['cash', 'orange_money', 'mtn_momo', 'moov_money', 'wave', 'card']),
        phone: z.string().optional(),
      }),
      req.body,
    );
    const facture = container.subscriptions.factures().find((f) => f.id === id);
    if (!facture) throw notFound('Facture d’abonnement introuvable');
    const provider = container.payments.get(body.method);
    if (!provider) throw badRequest('Moyen de paiement indisponible');
    const result = await provider.charge({
      method: body.method, amount: facture.amount, currency: 'XOF',
      phone: body.phone, reference: facture.id,
    });
    // On n'encaisse que sur confirmation réelle de la passerelle. « pending » reste
    // en attente : le client doit confirmer sur son téléphone (mobile money).
    if (result.status === 'authorized' || result.status === 'captured') {
      return { payment: result, facture: container.subscriptions.payerFacture(id, { method: body.method, reference: result.reference }) };
    }
    if (result.status === 'failed') {
      return { payment: result, facture: container.subscriptions.echecFacture(id, result.message) };
    }
    return { payment: result, facture };
  });

  /** Renouvellement manuel (ou anticipé) de la période. */
  app.post('/subscriptions/:userId/renouveler', async (req) => {
    const { userId } = req.params as { userId: string };
    return container.subscriptions.renew(userId);
  });

  app.post('/subscriptions/:userId/cancel', async (req) => {
    const { userId } = req.params as { userId: string };
    const body = parse(z.object({ raison: z.string().max(200).optional() }), req.body ?? {});
    return { subscription: container.subscriptions.cancel(userId, body.raison) };
  });
}
