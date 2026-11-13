import Fastify, { type FastifyInstance } from 'fastify';
import rateLimit from '@fastify/rate-limit';
import cors from '@fastify/cors';
import compress from '@fastify/compress';
import { constants as zlib } from 'node:zlib';
import { randomUUID } from 'node:crypto';
import { config } from './config/index.js';
import { loggerOptions } from './core/logger.js';
import { AppError } from './core/errors.js';
import { createContainer, type Container } from './container.js';
import { healthRoutes } from './modules/health/routes.js';
import { pricingRoutes } from './modules/pricing/routes.js';
import { driverRoutes, greenTelemetryRoutes } from './modules/drivers/routes.js';
import { rideRoutes } from './modules/rides/routes.js';
import { complianceRoutes } from './modules/compliance/routes.js';
import { geoCiRoutes } from './modules/geo-ci/routes.js';
import { paymentRoutes } from './modules/payments/routes.js';
import { safetyRoutes } from './modules/safety/routes.js';
import { mapsRoutes } from './modules/maps/routes.js';
import { realtimeRoutes } from './modules/realtime/routes.js';
import { walletRoutes } from './modules/wallet/routes.js';
import { fleetRoutes } from './modules/fleet/routes.js';
import { countryRoutes } from './modules/countries/routes.js';
import { subscriptionRoutes } from './modules/subscriptions/routes.js';
import { weddingRoutes } from './modules/wedding/routes.js';
import { rentalRoutes } from './modules/rental/routes.js';
import { insuranceRoutes } from './modules/insurance/routes.js';
import { assuranceRoutes } from './modules/assurance/routes.js';
import { messagesRoutes } from './modules/messages/routes.js';
import { adminRoutes } from './modules/admin/routes.js';
import { supportClientRoutes } from './modules/support/routes.js';
import { clientAccountRoutes } from './modules/clients/routes.js';
import { driverAppRoutes, registerDriverGuard } from './modules/driver-app/routes.js';

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

  // CORS : autorise l'app cliente (autre origine) à appeler l'API.
  //
  // Les cookies de session de la console ne traversent les origines QUE si le
  // navigateur reçoit `credentials: true` avec une origine EXPLICITE. On ne les
  // active donc pas quand CORS_ORIGIN vaut « * » : refléter n'importe quelle
  // origine tout en acceptant les cookies laisserait n'importe quel site émettre
  // des requêtes authentifiées. Avec « * », la console doit être servie depuis la
  // même origine que l'API (déploiement recommandé) — les cookies fonctionnent
  // alors sans CORS du tout.
  const originsExplicites = config.CORS_ORIGIN !== '*';
  await app.register(cors, {
    origin: originsExplicites ? config.CORS_ORIGIN.split(',').map((s) => s.trim()) : true,
    credentials: originsExplicites,
  });

  // VOLUME : réponses compressées (Brotli, sinon gzip) dès 1 Ko. Une carte de flotte ou une
  // file SOS de plusieurs centaines de kilo-octets pèse cinq à dix fois moins sur le
  // réseau : c'est ce qui garde la console fluide en 4G et en télétravail. Brotli en
  // qualité 4 : presque aussi compact que le maximum, vingt fois plus rapide à produire.
  await app.register(compress, {
    global: true,
    threshold: 1024,
    encodings: ['br', 'gzip', 'deflate'],
    brotliOptions: { params: { [zlib.BROTLI_PARAM_QUALITY]: 4 } },
    zlibOptions: { level: 5 },
  });

  // Back-pressure : protège contre la surcharge (renvoie 429 plutôt que de s'effondrer).
  await app.register(rateLimit, {
    max: config.RATE_LIMIT_MAX,
    timeWindow: config.RATE_LIMIT_WINDOW,
    // Se DÉCONNECTER doit toujours rester possible : un administrateur bloqué par
    // le limiteur garderait sinon une session ouverte, ce qui est exactement
    // l'inverse du but recherché. La route ne fait que révoquer une session.
    allowList: (req) => req.url.split('?')[0] === '/admin/logout',
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

  // Mesures continues (posées avant toute route) : chaque réponse alimente la fenêtre glissante (route type, pas l'URL).
  app.addHook('onResponse', async (req, reply) => {
    container.mesures.noterRequete(`${req.method} ${req.routeOptions?.url ?? 'inconnue'}`, reply.elapsedTime, reply.statusCode);
  });

  // Garde d'accès app chauffeur (jeton) sur les routes chauffeur existantes.
  registerDriverGuard(app, container);

  // Passerelle temps réel (WebSocket) — enregistrée avant les routes HTTP.
  await realtimeRoutes(app, container);

  // Enregistrement des modules HTTP.
  await healthRoutes(app, container);
  await pricingRoutes(app, container);
  await driverRoutes(app, container);
  await greenTelemetryRoutes(app, container);
  await rideRoutes(app, container);
  await complianceRoutes(app, container);
  await geoCiRoutes(app, container);
  await paymentRoutes(app, container);
  await safetyRoutes(app, container);
  await mapsRoutes(app, container);
  await walletRoutes(app, container);
  await fleetRoutes(app, container);
  await countryRoutes(app, container);
  await subscriptionRoutes(app, container);
  await weddingRoutes(app, container);
  // Location Signature : événements/mariages, entreprises & institutions, mise à disposition.
  await rentalRoutes(app, container);
  await insuranceRoutes(app, container);
  await assuranceRoutes(app, container);
  await messagesRoutes(app, container);
  await adminRoutes(app, container);
  await supportClientRoutes(app, container);
  await clientAccountRoutes(app, container);
  // App Chauffeur : connexion, config flotte, historique, course en cours, canal WS.
  await driverAppRoutes(app, container);

  // Arrêt en douceur : couper les timers de simulation.
  app.addHook('onClose', async () => container.simulator.stopAll());

  app.get('/', async () => ({
    name: 'ORION VTC API',
    version: '0.2.0',
    country: 'CI',
    currency: 'XOF',
    docs: '/docs (voir le dossier docs/ du dépôt)',
    services: container.registry.list(),
    tiers: ['bronze', 'argent', 'or', 'diamant'],
    features: ['geo-ci', 'mobile-money', 'safety-samu', 'realtime-ws', 'live-tracking', 'wallet-commissions', 'subscriptions', 'wedding-rental', 'rental-signature', 'rental-corporate', 'rental-hourly', 'multi-country', 'insurance', 'trusted-contact-share', 'in-app-call', 'biometric-ready', 'google-maps-ready', 'admin-dashboard', 'samu-supervision'],
  }));

  return { app, container };
}
