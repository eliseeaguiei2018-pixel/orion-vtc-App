import type { FastifyInstance } from 'fastify';
import type { Container } from '../../container.js';

/**
 * Health checks distincts pour l'orchestrateur (Kubernetes) :
 *  - /health/live  : le process est vivant (liveness)
 *  - /health/ready : les dépendances répondent (readiness) — une instance non prête ne
 *    reçoit pas de trafic, ce qui évite de router vers une instance défaillante.
 */
export async function healthRoutes(app: FastifyInstance, container: Container): Promise<void> {
  app.get('/health/live', async () => ({ status: 'ok', uptime: process.uptime() }));

  app.get('/health/ready', async () => {
    // En prod : ping PostgreSQL/Redis ici. L'index géo doit répondre.
    await container.geo.size();
    // L'opérateur SMS est indiqué (sans aucun secret) : utile pour vérifier un déploiement.
    return { status: 'ready', services: container.registry.list(), sms: { fournisseur: container.sms.fournisseur, actif: container.sms.reel } };
  });
}
