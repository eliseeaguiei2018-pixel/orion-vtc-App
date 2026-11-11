import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Container } from '../../container.js';
import { latLng, parse } from '../../core/validate.js';
import { badRequest } from '../../core/errors.js';
import { dansLEmprise } from './routage.js';

export async function mapsRoutes(app: FastifyInstance, container: Container): Promise<void> {
  app.post('/maps/route', async (req) => {
    const body = parse(z.object({ origin: latLng, destination: latLng }), req.body);
    const route = await container.maps.route(body.origin, body.destination);
    return { route };
  });

  /**
   * Itinéraire routier réel entre 2 et 7 points (départ, arrêts, arrivée), limité à la
   * Côte d'Ivoire : le serveur n'est pas un calculateur d'itinéraires public.
   */
  app.post('/maps/itineraire', { config: { rateLimit: { max: 60, timeWindow: '1 minute' } } }, async (req) => {
    const body = parse(z.object({ points: z.array(latLng).min(2).max(7) }), req.body);
    if (!body.points.every(dansLEmprise)) throw badRequest('Itinéraire hors de Côte d’Ivoire');
    return { itineraire: await container.routage.itineraire(body.points) };
  });

  app.get('/maps/autocomplete', async (req) => {
    const q = parse(
      z.object({
        q: z.string().min(1),
        lat: z.coerce.number().optional(),
        lng: z.coerce.number().optional(),
      }),
      req.query,
    );
    const near = q.lat !== undefined && q.lng !== undefined ? { lat: q.lat, lng: q.lng } : undefined;
    const suggestions = await container.maps.autocomplete(q.q, near);
    return { suggestions };
  });
}
