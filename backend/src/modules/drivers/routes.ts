import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Container } from '../../container.js';
import { latLng, parse } from '../../core/validate.js';
import { notFound } from '../../core/errors.js';
import { driverRoom, rideRoom } from '../realtime/hub.js';
import { genMatricule } from './store.js';

const registerSchema = z.object({
  name: z.string().min(1),
  category: z.string().default('bronze'),
});

const onlineSchema = z.object({ position: latLng });
const locationSchema = z.object({ position: latLng });

export async function driverRoutes(app: FastifyInstance, container: Container): Promise<void> {
  app.post('/drivers', async (req, reply) => {
    const body = parse(registerSchema, req.body);
    const driver = container.drivers.upsert({
      id: randomUUID(),
      name: body.name,
      matricule: genMatricule(),
      category: body.category,
      kycStatus: 'draft',
      availability: 'offline',
      ratingAvg: 0,
      ratingCount: 0,
    });
    reply.code(201);
    return { driver };
  });

  app.get('/drivers/:id', async (req) => {
    const { id } = req.params as { id: string };
    const driver = container.drivers.get(id);
    if (!driver) throw notFound('Chauffeur introuvable');
    return { driver };
  });

  // Activation de la disponibilité (passage en ligne) + publication de la position.
  app.post('/drivers/:id/online', async (req) => {
    const { id } = req.params as { id: string };
    if (!container.drivers.get(id)) throw notFound('Chauffeur introuvable');
    const body = parse(onlineSchema, req.body);
    await container.drivers.goOnline(id, body.position);
    return { status: 'online' };
  });

  app.post('/drivers/:id/offline', async (req) => {
    const { id } = req.params as { id: string };
    if (!container.drivers.get(id)) throw notFound('Chauffeur introuvable');
    await container.drivers.goOffline(id);
    container.matching.releaseLock(id);
    return { status: 'offline' };
  });

  // Heartbeat de position (renouvelle le TTL de présence).
  app.post('/drivers/:id/location', async (req) => {
    const { id } = req.params as { id: string };
    if (!container.drivers.get(id)) throw notFound('Chauffeur introuvable');
    const body = parse(locationSchema, req.body);
    await container.drivers.updateLocation(id, body.position);

    // Diffusion temps réel : suivi précis côté client (room de la course active).
    container.realtime.publish(driverRoom(id), 'driver.location', { driverId: id, position: body.position });
    const activeRide = container.rides.findActiveByDriver(id);
    if (activeRide) {
      container.realtime.publish(rideRoom(activeRide.id), 'driver.location', {
        driverId: id,
        position: body.position,
      });
    }
    return { status: 'updated' };
  });
}
