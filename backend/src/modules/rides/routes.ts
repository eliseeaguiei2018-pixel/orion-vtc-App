import { randomUUID } from 'node:crypto';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { Container } from '../../container.js';
import { parse } from '../../core/validate.js';
import { badRequest, conflict, notFound } from '../../core/errors.js';
import { rideStateMachine, type RideStatus } from '../services/ride/stateMachine.js';
import { rideRoom } from '../realtime/hub.js';
import type { Ride } from './store.js';

const createSchema = z.object({
  clientId: z.string().min(1),
  lockId: z.string().min(1), // devis verrouillé issu de /pricing/estimate
  // Contact de confiance prévenu au départ (partage de course).
  trustedContact: z.object({ name: z.string().min(1), phone: z.string().min(1) }).optional(),
  // Compte Entreprise (B2B) : la course est imputée à la ligne de crédit société.
  corporateCode: z.string().min(2).max(40).optional(),
});

const transitionSchema = z.object({ to: z.custom<RideStatus>() });

/** Analyse sémantique légère des commentaires : mots-clés → tags automatiques. */
const COMMENT_TAGS: Record<string, string> = {
  propre: '#Propreté', sale: '#Propreté', odeur: '#Odeur', retard: '#Retard',
  musique: '#MusiqueForte', danger: '#ConduiteDangereuse', vite: '#ConduiteDangereuse',
  frein: '#ConduiteDangereuse', aimable: '#Courtoisie', poli: '#Courtoisie',
};
/** Mots critiques → alerte de priorité absolue (équipe sécurité) + blocage préventif. */
const SENSITIVE_WORDS = ['accident', 'alcool', 'harcèlement', 'harcelement', 'vol', 'arme', 'drogue', 'agression'];

const idempotencyKey = (req: FastifyRequest): string | undefined => {
  const h = req.headers['idempotency-key'];
  return Array.isArray(h) ? h[0] : h;
};

function appendEvent(ride: Ride, type: string, payload?: Record<string, unknown>): void {
  ride.events.push({ type, at: new Date().toISOString(), payload });
}

export async function rideRoutes(app: FastifyInstance, container: Container): Promise<void> {
  // Création de course : idempotente + prix verrouillé + matching.
  app.post('/rides', async (req, reply) => {
    const body = parse(createSchema, req.body);

    const ride = await container.idempotency.run(idempotencyKey(req), async () => {
      // Prix verrouillé : on ne fait confiance qu'au devis serveur, jamais à un prix client.
      const quote = container.rides.consumeQuote(body.lockId);
      if (!quote) throw conflict('Devis introuvable ou expiré — re-demandez une estimation');
      if (new Date(quote.expiresAt).getTime() <= Date.now()) {
        throw conflict('Devis expiré — re-demandez une estimation');
      }

      // B2B : imputation sur la ligne de crédit société AVANT création (réservation).
      let corporateId: string | undefined;
      if (body.corporateCode) {
        const charged = container.corporate.charge(body.corporateCode, quote.amount);
        if (charged === null) throw conflict('Code société inconnu');
        if (charged === 'inactive') throw conflict('Compte entreprise suspendu');
        if (charged === 'over_limit') throw conflict('Ligne de crédit entreprise dépassée');
        corporateId = body.corporateCode;
      }
      // Conversion par zone : la commande confirmée est comptée dans sa cellule.
      container.demand.recordOrder(quote.origin);

      const created: Ride = {
        id: randomUUID(),
        clientId: body.clientId,
        serviceType: quote.serviceType,
        status: rideStateMachine.initial,
        origin: quote.origin,
        destination: quote.destination,
        quote,
        events: [],
        shareToken: randomUUID().slice(0, 8),
        trustedContact: body.trustedContact,
        corporateId,
        createdAt: new Date().toISOString(),
      };
      if (corporateId) appendEvent(created, 'corporate_charged', { corporateId, amount: quote.amount });
      appendEvent(created, 'created', { amount: quote.amount, currency: quote.currency });
      if (body.trustedContact) appendEvent(created, 'shared', { contact: body.trustedContact.name });

      // Matching : recherche d'un chauffeur disponible à proximité
      // (les paires désappariées après une note 1–2★ sont exclues).
      const match = await container.matching.findDriver(created.origin, quote.category, quote.distanceMeters, body.clientId);
      if (match) {
        rideStateMachine.assertTransition(created.status, 'accepted');
        created.status = 'accepted';
        created.driverId = match.driverId;
        container.drivers.setAvailability(match.driverId, 'on_trip');
        appendEvent(created, 'accepted', { driverId: match.driverId, etaSeconds: match.etaSeconds });
      } else {
        created.status = 'no_driver';
        appendEvent(created, 'no_driver');
      }

      container.rides.save(created);
      // Rattache la course au client (fiche client / support).
      container.clients.incrementRides(created.clientId);

      // Tracking live : le serveur simule le trajet du chauffeur et émet les événements
      // temps réel (driver.location + ride.status) consommés par l'app via WebSocket.
      if (created.status === 'accepted') container.simulator.start(created);
      return created;
    });

    // Chauffeur assigné (sous-ensemble sûr) : l'app cliente affiche le VRAI chauffeur
    // matché — cohérent avec la page de partage (contact de confiance).
    const drv = ride.driverId ? container.drivers.get(ride.driverId) : undefined;
    reply.code(201);
    return {
      ride,
      driver: drv ? { name: drv.name, matricule: drv.matricule, ratingAvg: drv.ratingAvg, ratingCount: drv.ratingCount } : null,
      shareUrl: ride.shareToken ? `/share/${ride.shareToken}` : null,
    };
  });

  // Vue publique d'une course (lien partagé à un contact de confiance) — lecture seule, infos sûres.
  app.get('/share/:token', async (req) => {
    const { token } = req.params as { token: string };
    const ride = container.rides.findByShareToken(token);
    if (!ride) throw notFound('Lien de partage invalide');
    const driver = ride.driverId ? container.drivers.get(ride.driverId) : undefined;
    return {
      status: ride.status,
      origin: ride.origin,
      destination: ride.destination,
      createdAt: ride.createdAt,
      driver: driver ? { name: driver.name, matricule: driver.matricule } : null,
      supervisedBy: 'ORION',
    };
  });

  app.get('/rides/:id', async (req) => {
    const { id } = req.params as { id: string };
    const ride = container.rides.get(id);
    if (!ride) throw notFound('Course introuvable');
    return { ride };
  });

  app.get('/clients/:clientId/rides', async (req) => {
    const { clientId } = req.params as { clientId: string };
    return { rides: container.rides.listByClient(clientId) };
  });

  // Transition d'état contrôlée par la machine à états (refuse les transitions illégales).
  app.post('/rides/:id/transition', async (req) => {
    const { id } = req.params as { id: string };
    const body = parse(transitionSchema, req.body);
    const ride = container.rides.get(id);
    if (!ride) throw notFound('Course introuvable');

    rideStateMachine.assertTransition(ride.status, body.to);
    ride.status = body.to;
    appendEvent(ride, body.to);
    container.rides.persist(ride);
    container.realtime.publish(rideRoom(ride.id), 'ride.status', { rideId: ride.id, status: ride.status });

    // Libère le chauffeur sur les états terminaux.
    if (ride.driverId && (body.to === 'rated' || body.to === 'cancelled')) {
      container.matching.releaseLock(ride.driverId);
      container.drivers.setAvailability(ride.driverId, 'online');
    }
    // Frais d'annulation progressifs : gratuits pendant le délai de grâce, facturés
    // au-delà (matrice tarifaire console). Enregistrés comme ligne connue.
    if (body.to === 'cancelled') {
      const pr = container.settings.getPricing();
      const ageMin = (Date.now() - Date.parse(ride.createdAt)) / 60_000;
      if (ageMin > pr.cancelGraceMinutes && pr.cancelFee > 0) {
        appendEvent(ride, 'cancel_fee', { amount: pr.cancelFee, afterMinutes: Math.round(ageMin) });
        container.rides.persist(ride);
      }
    }
    // Anti-abus : annulations cumulées → avertissement automatique tous les 3.
    if (body.to === 'cancelled') {
      const warned = container.clients.incrementCancellations(ride.clientId);
      if (warned) {
        container.audit.log({
          actor: 'Système ORION', role: 'super_admin', action: 'client.warning_auto',
          target: ride.clientId, details: { reason: 'annulations abusives', cancellations: container.clients.get(ride.clientId)?.cancellations },
        });
      }
    }
    return { ride };
  });

  // Notation (étape finale du parcours client).
  app.post('/rides/:id/rate', async (req) => {
    const { id } = req.params as { id: string };
    const schema = z.object({ stars: z.number().int().min(1).max(5), comment: z.string().optional() });
    const body = parse(schema, req.body);
    const ride = container.rides.get(id);
    if (!ride) throw notFound('Course introuvable');
    if (ride.status !== 'paid') throw badRequest('La course doit être payée avant notation');

    rideStateMachine.assertTransition(ride.status, 'rated');
    ride.status = 'rated';
    appendEvent(ride, 'rated', { stars: body.stars, comment: body.comment });
    container.rides.persist(ride);

    const driver = ride.driverId ? container.drivers.get(ride.driverId) : undefined;
    if (driver) {
      const total = driver.ratingAvg * driver.ratingCount + body.stars;
      driver.ratingCount += 1;
      driver.ratingAvg = Math.round((total / driver.ratingCount) * 100) / 100;

      // Modération qualité : avertissement AUTOMATIQUE si la moyenne passe sous le
      // seuil (console → OpsConfig), après un minimum de notes pour être significatif.
      const ops = container.settings.getOps();
      if (ops.autoWarn && driver.ratingCount >= 5 && driver.ratingAvg < ops.minRating) {
        driver.warnings = (driver.warnings ?? 0) + 1;
        container.audit.log({
          actor: 'Système ORION', role: 'super_admin', action: 'driver.warning_auto',
          target: driver.id, details: { rating: driver.ratingAvg, threshold: ops.minRating, warnings: driver.warnings },
        });
      }

      container.drivers.persist(driver.id);
      container.matching.releaseLock(driver.id);
      container.drivers.setAvailability(driver.id, 'online');
    }

    // Désappariement automatique : après une note 1–2★, ces deux usagers
    // ne seront plus JAMAIS mis en relation par l'algorithme.
    if (body.stars <= 2 && ride.driverId) {
      container.matching.blockPair(ride.clientId, ride.driverId);
      appendEvent(ride, 'unmatched', { clientId: ride.clientId, driverId: ride.driverId });
    }

    // Analyse sémantique du commentaire : tags automatiques + mots sensibles.
    if (body.comment) {
      const lc = body.comment.toLowerCase();
      const tags = [...new Set(Object.entries(COMMENT_TAGS).filter(([w]) => lc.includes(w)).map(([, t]) => t))];
      if (tags.length) appendEvent(ride, 'comment_tags', { tags });
      const hit = SENSITIVE_WORDS.find((w) => lc.includes(w));
      if (hit && driver) {
        // Alerte de priorité ABSOLUE (équipe sécurité) + blocage PRÉVENTIF du
        // chauffeur le temps de l'investigation.
        driver.kycStatus = 'suspended';
        await container.drivers.goOffline(driver.id);
        container.matching.releaseLock(driver.id);
        container.safety.raiseSystem({
          kind: 'mot_sensible', userId: ride.clientId, location: ride.destination, rideId: ride.id,
          note: `Mot sensible « ${hit} » dans un avis : ${body.comment.slice(0, 140)}`,
        });
        container.audit.log({
          actor: 'Système ORION', role: 'super_admin', action: 'driver.preventive_block',
          target: driver.id, details: { word: hit, rideId: ride.id },
        });
      }
      container.rides.persist(ride);
    }
    return { ride };
  });

  // Attente facturable : le chauffeur (app) déclare une pause demandée par le client
  // (arrêt course, course en cours) — facturée au tarif console (100 F/min par défaut)
  // et AJOUTÉE au prix fixe à la fin de la course, ligne visible et auditée.
  app.post('/rides/:id/wait', async (req) => {
    const { id } = req.params as { id: string };
    const body = parse(z.object({ minutes: z.number().min(1).max(120) }), req.body);
    const ride = container.rides.get(id);
    if (!ride) throw notFound('Course introuvable');
    if (ride.status !== 'in_progress' && ride.status !== 'arrived') {
      throw badRequest('L’attente ne se facture qu’en course (ou à l’arrivée)');
    }
    ride.waitMinutes = (ride.waitMinutes ?? 0) + Math.round(body.minutes);
    // Minutes de courtoisie offertes avant facturation (console Tarification).
    const freeWait = container.settings.getPricing().freeWaitMinutes;
    const billable = Math.max(0, ride.waitMinutes - freeWait);
    const fee = billable * container.settings.getOps().waitFeePerMin;
    appendEvent(ride, 'wait', { minutes: Math.round(body.minutes), totalMinutes: ride.waitMinutes, billableMinutes: billable, fee });
    container.rides.persist(ride);
    return { waitMinutes: ride.waitMinutes, freeMinutes: freeWait, billableMinutes: billable, waitFee: fee, perMinute: container.settings.getOps().waitFeePerMin };
  });

  // Réclamation / litige ouvert par le client (objet perdu, trajet, facturation, comportement).
  app.post('/rides/:id/dispute', async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = parse(z.object({
      clientId: z.string().min(1).max(80),
      kind: z.enum(['objet_perdu', 'trajet', 'facturation', 'comportement']),
      description: z.string().min(3).max(1000),
    }), req.body);
    const ride = container.rides.get(id);
    if (!ride) throw notFound('Course introuvable');
    if (ride.clientId !== body.clientId) throw badRequest('Cette course n’appartient pas à ce client');
    const dispute = container.disputes.open({ rideId: id, ...body });
    reply.code(201);
    return { dispute };
  });

  // Bouton « Urgence » de l'app (client OU chauffeur) : alerte SOS niveau ROUGE
  // liée à la course — apparaît immédiatement dans la file de triage SAMU.
  app.post('/rides/:id/sos', async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = parse(z.object({
      by: z.enum(['client', 'chauffeur']),
      note: z.string().max(300).optional(),
    }), req.body);
    const ride = container.rides.get(id);
    if (!ride) throw notFound('Course introuvable');
    const location = ride.trace?.length ? ride.trace[ride.trace.length - 1]! : ride.origin;
    const alert = container.safety.raiseSos({
      userId: body.by === 'chauffeur' ? (ride.driverId ?? ride.clientId) : ride.clientId,
      location, rideId: id, note: body.note, source: body.by,
    });
    appendEvent(ride, 'sos', { alertId: alert.id, by: body.by });
    container.rides.persist(ride);
    reply.code(201);
    return { alert: { id: alert.id, level: alert.level, status: alert.status } };
  });

  // Réservation à l'avance (aéroport, hôtel, rendez-vous) — au moins 15 min avant.
  app.post('/reservations', async (req, reply) => {
    const body = parse(z.object({
      clientId: z.string().min(1).max(80),
      origin: z.object({ lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180) }),
      destination: z.object({ lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180) }),
      category: z.string().min(2).max(20).default('bronze'),
      scheduledFor: z.string().datetime(),
      favoriteDriverId: z.string().optional(),
    }), req.body);
    if (Date.parse(body.scheduledFor) < Date.now() + 15 * 60_000) {
      throw badRequest('Une réservation se planifie au moins 15 minutes à l’avance');
    }
    container.clients.touch(body.clientId);
    const reservation = container.reservations.create(body);
    reply.code(201);
    return { reservation };
  });

  app.get('/clients/:clientId/reservations', async (req) => {
    const { clientId } = req.params as { clientId: string };
    return { reservations: container.reservations.listByClient(clientId) };
  });
}
