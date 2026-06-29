import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Container } from '../../container.js';
import { latLng, parse } from '../../core/validate.js';
import { notFound } from '../../core/errors.js';
import { EMERGENCY_NUMBERS } from './service.js';

export async function safetyRoutes(app: FastifyInstance, container: Container): Promise<void> {
  app.get('/safety/emergency-numbers', async () => ({ numbers: EMERGENCY_NUMBERS }));

  // SOS manuel.
  app.post('/safety/sos', async (req, reply) => {
    const body = parse(
      z.object({ userId: z.string().min(1), location: latLng, rideId: z.string().optional(), note: z.string().optional() }),
      req.body,
    );
    const alert = container.safety.raiseSos(body);
    reply.code(201);
    return { alert };
  });

  // Flux capteurs (accéléromètre) → détection automatique d'accident.
  app.post('/safety/sensor', async (req) => {
    const body = parse(
      z.object({
        userId: z.string().min(1),
        location: latLng,
        rideId: z.string().optional(),
        sample: z.object({
          ax: z.number(),
          ay: z.number(),
          az: z.number(),
          speedKmh: z.number().optional(),
        }),
      }),
      req.body,
    );
    const alert = container.safety.ingestSensor(body);
    return { crashDetected: alert !== null, alert };
  });

  app.get('/safety/alerts', async () => ({ alerts: container.safety.list() }));

  app.post('/safety/alerts/:id/status', async (req) => {
    const { id } = req.params as { id: string };
    const body = parse(
      z.object({ status: z.enum(['raised', 'dispatched', 'acknowledged', 'resolved', 'cancelled']) }),
      req.body,
    );
    const alert = container.safety.updateStatus(id, body.status);
    if (!alert) throw notFound('Alerte introuvable');
    return { alert };
  });
}
