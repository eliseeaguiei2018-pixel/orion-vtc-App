import type { FastifyInstance } from 'fastify';
import type { Container } from '../../container.js';
import { COUNTRIES } from './catalog.js';

export async function countryRoutes(app: FastifyInstance, _container: Container): Promise<void> {
  app.get('/countries', async () => ({
    countries: COUNTRIES,
    active: COUNTRIES.filter((c) => c.status === 'active').map((c) => c.code),
  }));
}
