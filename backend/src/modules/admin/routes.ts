import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { Container } from '../../container.js';
import { parse } from '../../core/validate.js';
import { notFound, unauthorized, forbidden } from '../../core/errors.js';
import { AdminService } from './service.js';
import { can, resolveAccount, ROLE_PERMISSIONS, ROLE_LABEL, type AdminAccount, type Permission } from './roles.js';

/**
 * Console Admin — centre de contrôle ORION (boîte noire).
 * Accès par RÔLE (RBAC) : chaque route exige une permission ; le rôle du compte
 * (résolu depuis x-admin-token) détermine ce qui est autorisé. Couches d'accès selon le poste.
 */
export async function adminRoutes(app: FastifyInstance, container: Container): Promise<void> {
  await app.register(async (scoped) => {
    const admin = new AdminService(container);

    // Résout le compte (rôle) à partir du jeton ; 401 si inconnu.
    scoped.addHook('preHandler', async (req) => {
      const account = resolveAccount(req.headers['x-admin-token'] as string | undefined);
      if (!account) throw unauthorized('Jeton administrateur invalide');
      (req as FastifyRequest & { admin: AdminAccount }).admin = account;
    });

    const require = (req: FastifyRequest, perm: Permission): void => {
      const { admin: account } = req as FastifyRequest & { admin: AdminAccount };
      if (!can(account.role, perm)) throw forbidden(`Accès refusé (permission ${perm} requise)`);
    };

    // Identité + permissions du compte connecté (le front adapte l'affichage).
    scoped.get('/admin/me', async (req) => {
      const { admin: account } = req as FastifyRequest & { admin: AdminAccount };
      return {
        name: account.name,
        role: account.role,
        roleLabel: ROLE_LABEL[account.role],
        permissions: ROLE_PERMISSIONS[account.role],
      };
    });

    scoped.get('/admin/overview', async (req) => { require(req, 'overview:read'); return admin.overview(); });

    scoped.get('/admin/rides', async (req) => {
      require(req, 'rides:read');
      const q = parse(z.object({ status: z.string().optional(), limit: z.coerce.number().int().positive().max(500).optional() }), req.query);
      return { rides: admin.rides(q) };
    });

    scoped.get('/admin/drivers', async (req) => { require(req, 'drivers:read'); return { drivers: admin.drivers() }; });

    scoped.get('/admin/fleet/live', async (req) => { require(req, 'drivers:read'); return { fleet: await admin.fleetLive() }; });

    // --- Supervision SAMU ---
    scoped.get('/admin/alerts', async (req) => { require(req, 'alerts:read'); return { alerts: container.safety.list() }; });

    scoped.post('/admin/alerts/:id/status', async (req) => {
      require(req, 'alerts:write');
      const { id } = req.params as { id: string };
      const body = parse(z.object({ status: z.enum(['raised', 'dispatched', 'acknowledged', 'resolved', 'cancelled']) }), req.body);
      const alert = container.safety.updateStatus(id, body.status);
      if (!alert) throw notFound('Alerte introuvable');
      return { alert };
    });

    // --- Tarification (leviers augmenter/réduire les prix) ---
    scoped.get('/admin/pricing', async (req) => { require(req, 'pricing:read'); return { pricing: container.settings.getPricing() }; });

    scoped.put('/admin/pricing', async (req) => {
      require(req, 'pricing:write');
      const num = z.number().positive();
      const rate = z.number().min(0).max(1);
      const body = parse(
        z.object({
          baseFare: num.optional(), perKm: num.optional(), perMinute: num.optional(),
          minFare: num.optional(), avgSpeedKmh: num.optional(),
          tvaRate: rate.optional(), feeRate: rate.optional(), insuranceRate: rate.optional(),
          trafficWeight: z.number().min(0).max(1).optional(), stopFee: z.number().min(0).optional(),
          multipliers: z.object({
            bronze: num.optional(), argent: num.optional(), or: num.optional(), diamant: num.optional(),
          }).partial().optional(),
        }),
        req.body,
      );
      return { pricing: container.settings.updatePricing(body) };
    });

    scoped.post('/admin/pricing/reset', async (req) => {
      require(req, 'pricing:write');
      return { pricing: container.settings.resetPricing() };
    });
  });
}
