import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Container } from '../../container.js';
import { latLng, parse } from '../../core/validate.js';

export async function mapsRoutes(app: FastifyInstance, container: Container): Promise<void> {
  app.post('/maps/route', async (req) => {
    const body = parse(z.object({ origin: latLng, destination: latLng }), req.body);
    const route = await container.maps.route(body.origin, body.destination);
    return { route };
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
