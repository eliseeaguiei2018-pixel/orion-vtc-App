import type { FastifyInstance } from 'fastify';
import type { Container } from '../../container.js';
import { FLEET, TIERS } from './catalog.js';

/** Expose le catalogue de la flotte (niveaux Bronze→Diamant + marques). */
export async function fleetRoutes(app: FastifyInstance, _container: Container): Promise<void> {
  app.get('/fleet', async () => ({
    tiers: TIERS.map((t) => FLEET[t]),
  }));
}
