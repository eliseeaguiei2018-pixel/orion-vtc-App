import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Container } from '../../container.js';
import { config } from '../../config/index.js';
import { parse } from '../../core/validate.js';
import { notFound, unauthorized } from '../../core/errors.js';
import { AdminService } from './service.js';

/**
 * Dashboard Admin & supervision SAMU.
 *
 * RBAC simple : en-tête `x-admin-token` == config.ADMIN_TOKEN. En production, remplacer
 * par une authentification forte (SSO/JWT + rôles) et un audit log immuable des actions.
 * Toutes les routes sont en lecture seule, sauf la mise à jour du statut d'une alerte.
 */
export async function adminRoutes(app: FastifyInstance, container: Container): Promise<void> {
  // Plugin encapsulé : la garde d'authentification ne s'applique QU'aux routes /admin.
  await app.register(async (scoped) => {
    const admin = new AdminService(container);

    scoped.addHook('preHandler', async (req) => {
      const token = req.headers['x-admin-token'];
      if (token !== config.ADMIN_TOKEN) throw unauthorized('Jeton administrateur invalide');
    });

    scoped.get('/admin/overview', async () => admin.overview());

    scoped.get('/admin/rides', async (req) => {
      const q = parse(
        z.object({ status: z.string().optional(), limit: z.coerce.number().int().positive().max(500).optional() }),
        req.query,
      );
      return { rides: admin.rides(q) };
    });

    scoped.get('/admin/drivers', async () => ({ drivers: admin.drivers() }));

    scoped.get('/admin/fleet/live', async () => ({ fleet: await admin.fleetLive() }));

    // --- Supervision SAMU : file des alertes SOS / accidents ---
    scoped.get('/admin/alerts', async () => ({ alerts: container.safety.list() }));

    scoped.post('/admin/alerts/:id/status', async (req) => {
      const { id } = req.params as { id: string };
      const body = parse(
        z.object({ status: z.enum(['raised', 'dispatched', 'acknowledged', 'resolved', 'cancelled']) }),
        req.body,
      );
      const alert = container.safety.updateStatus(id, body.status);
      if (!alert) throw notFound('Alerte introuvable');
      return { alert };
    });
  });
}
