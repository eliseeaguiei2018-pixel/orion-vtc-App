import type { FastifyInstance } from 'fastify';
import type { Container } from '../../container.js';
import { COUNTRIES } from './catalog.js';

/**
 * Pays où ORION est ouvert. Seuls les pays ACTIFS sont publiés : les pays en préparation
 * restent dans le catalogue (catalog.ts) pour le jour de leur ouverture, mais ne sont ni
 * annoncés ni visibles — ORION n'affiche aujourd'hui que la Côte d'Ivoire.
 */
export async function countryRoutes(app: FastifyInstance, _container: Container): Promise<void> {
  app.get('/countries', async () => {
    const actifs = COUNTRIES.filter((c) => c.status === 'active');
    return { countries: actifs, active: actifs.map((c) => c.code) };
  });
}
