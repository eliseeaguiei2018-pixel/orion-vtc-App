import { randomUUID } from 'node:crypto';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { Container } from '../../container.js';
import { parse } from '../../core/validate.js';
import { badRequest, notFound } from '../../core/errors.js';
import { PAYMENT_CATALOG, type PaymentMethod } from './providers.js';
import { driverRoom } from '../realtime/hub.js';
import { rideReceipt, sendEmail } from '../../core/mailer.js';

/** Lien profond (deep link) vers l'app de paiement de l'opérateur choisi. */
const DEEPLINKS: Record<string, string> = {
  wave: 'wave://pay',
  orange_money: 'orangemoney://pay',
  mtn_momo: 'mtnmomo://pay',
  moov_money: 'moovmoney://pay',
};

const idempotencyKey = (req: FastifyRequest): string | undefined => {
  const h = req.headers['idempotency-key'];
  return Array.isArray(h) ? h[0] : h;
};

export async function paymentRoutes(app: FastifyInstance, container: Container): Promise<void> {
  // Catalogue des moyens de paiement (mobile money en tête pour la CI).
  app.get('/payments/methods', async () => ({ methods: PAYMENT_CATALOG }));

  // Démarre le paiement : renvoie le lien profond vers l'app opérateur (Wave, OM, MoMo, Moov)
  // pour que le client confirme SANS quitter manuellement ORION (redirection in-app).
  app.post('/rides/:id/pay/initiate', async (req) => {
    const { id } = req.params as { id: string };
    const body = parse(z.object({ method: z.enum(['cash', 'orange_money', 'mtn_momo', 'moov_money', 'wave', 'card']) }), req.body);
    const ride = container.rides.get(id);
    if (!ride) throw notFound('Course introuvable');
    const reference = randomUUID();
    const deeplink = DEEPLINKS[body.method];
    return {
      reference,
      method: body.method,
      amount: ride.quote.amount,
      currency: 'XOF',
      // Mobile money → redirection vers l'app opérateur ; espèces/carte → pas de redirection.
      redirect: deeplink ? `${deeplink}?ref=${reference}&amount=${ride.quote.amount}&to=ORION` : null,
      status: 'pending',
    };
  });

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

    // Total dû = PRIX FIXE verrouillé + attente facturée éventuelle (100 F/min, console).
    const waitFee = (ride.waitMinutes ?? 0) * container.settings.getOps().waitFeePerMin;
    const totalDue = ride.quote.amount + waitFee;

    const result = await container.idempotency.run(idempotencyKey(req), () =>
      provider.charge({
        method: body.method as PaymentMethod,
        amount: totalDue,
        currency: 'XOF',
        phone: body.phone,
        reference: randomUUID(),
      }),
    );

    // Le paiement passe la course à l'état "paid" lorsqu'il est capturé/autorisé.
    let commission;
    if (result.status === 'authorized' || result.status === 'captured') {
      ride.status = 'paid';
      ride.events.push({ type: 'paid', at: new Date().toISOString(), payload: { method: result.method, amount: result.amount } });
      container.rides.persist(ride);
      // Crédite le gain net du chauffeur (course + attente) et journalise la commission.
      if (ride.driverId) {
        commission = container.wallet.creditRide(ride.driverId, ride.id, totalDue);
        // Bonus de micro-secteur (fidélisation de l'offre dans les zones premium).
        const zone = container.settings.zoneForPoint(ride.origin);
        if (zone?.driverBonus) {
          container.wallet.credit(ride.driverId, zone.driverBonus, 'adjustment', `Bonus zone ${zone.name}`, ride.id);
        }
        // Notifie le chauffeur en temps réel du paiement reçu.
        container.realtime.publish(driverRoom(ride.driverId), 'payment.received', {
          rideId: ride.id, amount: totalDue, method: result.method,
        });
        // Fin de course : on libère le chauffeur (dispo pour une nouvelle course).
        // La notation restant optionnelle, on ne bloque pas le chauffeur dessus.
        container.matching.releaseLock(ride.driverId);
        container.drivers.setAvailability(ride.driverId, 'online');
      }
      // ORION Assurance : enregistre la cotisation 2% si activée.
      const ins = ride.quote.breakdown.insurance;
      if (ins > 0) container.insurance.addContribution(ride.clientId, ride.id, ins);
      // Reçu de course envoyé par e-mail au client (résumé).
      const receipt = rideReceipt(totalDue, result.method);
      await sendEmail(`${ride.clientId}@client.orion.ci`, receipt.subject, receipt.body);
    }
    return { payment: result, rideStatus: ride.status, commission, emailSent: ride.status === 'paid' };
  });
}
