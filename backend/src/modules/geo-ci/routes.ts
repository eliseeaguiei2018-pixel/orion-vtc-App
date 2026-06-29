import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Container } from '../../container.js';
import { latLng, parse } from '../../core/validate.js';
import { ABIDJAN_ZONES, ALL_ZONES, CITY_ZONES, isWithinCotedIvoire, nearestZone } from './zones.js';

/** Expose le plan directeur ivoirien (zones) et le rattachement géographique. */
export async function geoCiRoutes(app: FastifyInstance, _container: Container): Promise<void> {
  app.get('/geo/zones', async () => ({
    abidjan: ABIDJAN_ZONES,
    cities: CITY_ZONES,
    total: ALL_ZONES.length,
  }));

  app.post('/geo/resolve', async (req) => {
    const body = parse(z.object({ point: latLng }), req.body);
    const inService = isWithinCotedIvoire(body.point);
    const nearest = nearestZone(body.point);
    return {
      inServiceArea: inService,
      zone: nearest?.zone ?? null,
      distanceMeters: nearest ? Math.round(nearest.distanceMeters) : null,
    };
  });
}
