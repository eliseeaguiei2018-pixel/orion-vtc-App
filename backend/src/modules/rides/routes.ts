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
});

const transitionSchema = z.object({ to: z.custom<RideStatus>() });

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
        createdAt: new Date().toISOString(),
      };
      appendEvent(created, 'created', { amount: quote.amount, currency: quote.currency });
      if (body.trustedContact) appendEvent(created, 'shared', { contact: body.trustedContact.name });

      // Matching : recherche d'un chauffeur disponible à proximité.
      const match = await container.matching.findDriver(created.origin, quote.category);
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

      // Tracking live : le serveur simule le trajet du chauffeur et émet les événements
      // temps réel (driver.location + ride.status) consommés par l'app via WebSocket.
      if (created.status === 'accepted') container.simulator.start(created);
      return created;
    });

    reply.code(201);
    return { ride, shareUrl: ride.shareToken ? `/share/${ride.shareToken}` : null };
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
    appendEvent(ride, 'rated', { stars: body.stars });
    container.rides.persist(ride);

    const driver = ride.driverId ? container.drivers.get(ride.driverId) : undefined;
    if (driver) {
      const total = driver.ratingAvg * driver.ratingCount + body.stars;
      driver.ratingCount += 1;
      driver.ratingAvg = Math.round((total / driver.ratingCount) * 100) / 100;
      container.matching.releaseLock(driver.id);
      container.drivers.setAvailability(driver.id, 'online');
    }
    return { ride };
  });
}
