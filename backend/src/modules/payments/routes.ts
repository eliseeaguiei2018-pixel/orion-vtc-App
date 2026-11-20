import { randomUUID } from 'node:crypto';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { Container } from '../../container.js';
import { parse } from '../../core/validate.js';
import { badRequest, notFound } from '../../core/errors.js';
import { PAYMENT_CATALOG, type PaymentMethod } from './providers.js';
import { driverRoom, rideRoom } from '../realtime/hub.js';
import { rideReceipt, sendEmail } from '../../core/mailer.js';
import { effectiveCommissionRate } from '../wallet/service.js';

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
    // Montant réellement dû : la part prise en charge par l'abonnement est déduite,
    // sinon le lien profond enverrait le client payer une somme qu'il ne doit pas.
    const prisEnCharge = (ride.subscription?.montantCouvert ?? 0) + (ride.subscription?.remise ?? 0);
    const amount = Math.max(0, ride.quote.amount - prisEnCharge);
    return {
      reference,
      method: body.method,
      amount,
      brut: ride.quote.amount,
      subscription: ride.subscription ?? null,
      currency: 'XOF',
      // Mobile money → redirection vers l'app opérateur ; espèces/carte → pas de redirection.
      redirect: deeplink && amount > 0 ? `${deeplink}?ref=${reference}&amount=${amount}&to=ORION` : null,
      status: amount === 0 ? 'covered' : 'pending',
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

    // Passerelle désactivée (panne réseau opérateur) → paiement refusé côté serveur.
    const gateways = container.settings.getServices().gateways ?? {};
    if (gateways[body.method] === false) throw badRequest('Moyen de paiement temporairement indisponible');

    const provider = container.payments.get(body.method as PaymentMethod);
    if (!provider) throw badRequest('Moyen de paiement indisponible');

    // Total dû = PRIX FIXE verrouillé + attente facturée éventuelle. Les premières
    // minutes (courtoisie, console) sont OFFERTES avant facturation.
    const freeWait = container.settings.getPricing().freeWaitMinutes;
    const billableWait = Math.max(0, (ride.waitMinutes ?? 0) - freeWait);
    const waitFee = billableWait * container.settings.getOps().waitFeePerMin;
    // Montant BRUT de la course : c'est lui qui rémunère le chauffeur.
    const montantBrut = ride.quote.amount + waitFee;
    // ABONNEMENT ORION : la part prise en charge et la remise d'abonné, figées à la
    // commande, sont déduites de ce que le CLIENT paie. Le chauffeur, lui, continue
    // d'être payé sur le brut — l'abonnement est un effort commercial d'ORION, pas
    // une perte pour le chauffeur.
    const prisEnCharge = (ride.subscription?.montantCouvert ?? 0) + (ride.subscription?.remise ?? 0);
    const totalDue = Math.max(0, montantBrut - prisEnCharge);

    const result = totalDue === 0
      // Course ENTIÈREMENT couverte par l'abonnement : rien à encaisser, on ne
      // sollicite aucune passerelle (un appel à 0 F serait rejeté par l'opérateur).
      ? {
        reference: randomUUID(),
        method: body.method as PaymentMethod,
        amount: 0,
        currency: 'XOF' as const,
        status: 'captured' as const,
        message: 'Course incluse dans votre abonnement ORION — rien à payer',
      }
      : await container.idempotency.run(idempotencyKey(req), () =>
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
      // Le CLIENT l'apprend aussitôt (espèces déclarées par le chauffeur, confirmation de
      // l'opérateur) : son écran de paiement passe à « payé » sans qu'il ait à agir.
      container.realtime.publish(rideRoom(ride.id), 'ride.status', { rideId: ride.id, status: 'paid' });
      // Crédite le gain net du chauffeur (course + attente) et journalise la commission.
      if (ride.driverId) {
        const drv = container.drivers.get(ride.driverId);
        const ops = container.settings.getOps();
        const isElectric = (drv?.engine ?? 'electric') === 'electric';
        // Commission modulée : fidélité > verte réduite > standard (logique partagée
        // avec l'app chauffeur, qui affiche le même taux).
        const rate = effectiveCommissionRate(drv, ops);
        commission = container.wallet.creditRide(ride.driverId, ride.id, montantBrut, rate);
        // ESPÈCES : le chauffeur a encaissé le total en main propre. On l'inscrit au
        // ledger → son solde baisse du montant encaissé et la commission devient une
        // DETTE envers ORION (recouvrement + plafond console « dette espèces »).
        // En espèces, le chauffeur n'a encaissé que ce que le client a RÉELLEMENT
        // payé (totalDue, part d'abonnement déduite) — pas le montant brut.
        if (body.method === 'cash' && totalDue > 0) {
          container.wallet.credit(ride.driverId, -totalDue, 'cash_collected', 'Espèces encaissées (commission due à ORION)', ride.id);
        }
        // Compteur de courses électriques (fidélité verte).
        if (drv && isElectric) { drv.electricRides = (drv.electricRides ?? 0) + 1; container.drivers.persist(drv.id); }
        // Prime « prise en charge longue » : approche à vide au-delà du seuil → bonus chauffeur.
        const accepted = ride.events.find((e) => e.type === 'accepted');
        const etaSec = typeof accepted?.payload?.['etaSeconds'] === 'number' ? (accepted.payload['etaSeconds'] as number) : 0;
        const approachKm = (etaSec / 3600) * 28;
        const pr = container.settings.getPricing();
        if (approachKm > pr.longPickupThresholdKm) {
          const bonus = Math.round((approachKm - pr.longPickupThresholdKm) * pr.longPickupPerKm);
          if (bonus > 0) container.wallet.credit(ride.driverId, bonus, 'adjustment', 'Prime prise en charge longue', ride.id);
        }
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
        // Points Carbone (fidélisation verte) : 1 point par km 100 % électrique payé.
        if (isElectric) {
          const km = Math.max(1, Math.round((ride.quote.distanceMeters ?? 0) / 1000));
          container.clients.addGreenPoints(ride.clientId, km);
          // Empreinte carbone individuelle du passager (150 g/km thermique − 20 g/km élec.).
          const c = container.clients.get(ride.clientId);
          if (c) { c.co2SavedKg = Math.round(((c.co2SavedKg ?? 0) + km * 0.13) * 10) / 10; container.clients.persist(ride.clientId); }
        }
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
