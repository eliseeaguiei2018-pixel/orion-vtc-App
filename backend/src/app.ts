import Fastify, { type FastifyInstance } from 'fastify';
import rateLimit from '@fastify/rate-limit';
import { randomUUID } from 'node:crypto';
import { config } from './config/index.js';
import { loggerOptions } from './core/logger.js';
import { AppError } from './core/errors.js';
import { createContainer, type Container } from './container.js';
import { healthRoutes } from './modules/health/routes.js';
import { pricingRoutes } from './modules/pricing/routes.js';
import { driverRoutes } from './modules/drivers/routes.js';
import { rideRoutes } from './modules/rides/routes.js';
import { complianceRoutes } from './modules/compliance/routes.js';

export interface BuiltApp {
  app: FastifyInstance;
  container: Container;
}

/**
 * Construit l'application sans la démarrer (utilisé par le serveur ET par les tests via
 * app.inject() — aucun port réseau requis pour tester).
 */
export async function buildApp(container = createContainer()): Promise<BuiltApp> {
  const app = Fastify({
    logger: loggerOptions,
    // Corrélation des logs/traces : chaque requête a un id propagé (observabilité).
    genReqId: (req) => (req.headers['x-request-id'] as string) ?? randomUUID(),
    disableRequestLogging: config.NODE_ENV === 'test',
  });

  // Back-pressure : protège contre la surcharge (renvoie 429 plutôt que de s'effondrer).
  await app.register(rateLimit, {
    max: config.RATE_LIMIT_MAX,
    timeWindow: config.RATE_LIMIT_WINDOW,
  });

  // Gestion d'erreur homogène : codes métier stables + pas de fuite de stack en prod.
  app.setErrorHandler((err, req, reply) => {
    if (err instanceof AppError) {
      reply.code(err.statusCode).send({
        error: { code: err.code, message: err.message, details: err.details, requestId: req.id },
      });
      return;
    }
    if ((err as { statusCode?: number }).statusCode === 429) {
      reply.code(429).send({ error: { code: 'RATE_LIMITED', message: 'Trop de requêtes', requestId: req.id } });
      return;
    }
    req.log.error({ err }, 'Erreur non gérée');
    reply.code(500).send({ error: { code: 'INTERNAL', message: 'Erreur interne', requestId: req.id } });
  });

  app.setNotFoundHandler((req, reply) => {
    reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'Route introuvable', requestId: req.id } });
  });

  // Enregistrement des modules.
  await healthRoutes(app, container);
  await pricingRoutes(app, container);
  await driverRoutes(app, container);
  await rideRoutes(app, container);
  await complianceRoutes(app, container);

  app.get('/', async () => ({
    name: 'ORION VTC API',
    version: '0.1.0',
    docs: '/docs (voir le dossier docs/ du dépôt)',
    services: container.registry.list(),
  }));

  return { app, container };
}
