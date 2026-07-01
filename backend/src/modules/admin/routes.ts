import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { Container } from '../../container.js';
import { parse } from '../../core/validate.js';
import { notFound, unauthorized, forbidden } from '../../core/errors.js';
import { AdminService, paginate } from './service.js';
import { can, resolveAccount, ROLE_PERMISSIONS, ROLE_LABEL, type AdminAccount, type Permission } from './roles.js';
import {
  authenticate, issueToken, verifyToken, bearerToken,
  lockedFor, recordLoginFailure, clearLoginFailures,
  verifyTotp, registerSession, touchSession, revokeSession, listSessions,
} from './auth.js';
import { config } from '../../config/index.js';

/** Rôles de direction : accès complet, 2FA exigible via ADMIN_REQUIRE_2FA. */
const EXEC_ROLES = new Set(['ceo', 'dg', 'daa', 'coo', 'super_admin']);

/**
 * Console Admin — centre de contrôle ORION (boîte noire).
 * Accès par RÔLE (RBAC) : chaque route exige une permission ; le rôle du compte
 * (résolu depuis x-admin-token) détermine ce qui est autorisé. Couches d'accès selon le poste.
 */
export async function adminRoutes(app: FastifyInstance, container: Container): Promise<void> {
  // Connexion (public) : login + mot de passe [+ code 2FA] → session JWT signée.
  // Anti-brute-force : 5 échecs → compte verrouillé 15 minutes (journalisé).
  app.post('/admin/login', async (req, reply) => {
    const body = parse(z.object({
      username: z.string().min(1).max(80),
      password: z.string().min(1).max(200),
      code: z.string().max(12).optional(), // code TOTP (2FA)
    }), req.body);
    const lock = lockedFor(body.username);
    if (lock > 0) {
      container.audit.log({ actor: body.username, role: 'viewer', action: 'login.locked' });
      reply.code(429);
      return { error: `Compte temporairement verrouillé (${Math.ceil(lock / 60)} min). Contacte un administrateur.` };
    }
    const user = authenticate(body.username, body.password);
    if (!user) {
      recordLoginFailure(body.username);
      container.audit.log({ actor: body.username, role: 'viewer', action: 'login.failed' });
      reply.code(401);
      return { error: 'Identifiants invalides' };
    }

    // 2FA : exigée si le compte a un secret TOTP, ou si la politique l'impose à la direction.
    const needs2fa = Boolean(user.totp) || (config.ADMIN_REQUIRE_2FA && EXEC_ROLES.has(user.role));
    if (needs2fa) {
      if (!user.totp) {
        container.audit.log({ actor: user.name, role: user.role, action: 'login.2fa_missing' });
        reply.code(403);
        return { error: '2FA obligatoire pour la direction : configure un secret TOTP (npm run totp-secret).' };
      }
      if (!body.code) {
        return { mfaRequired: true }; // le mot de passe est bon → demander le code
      }
      if (!verifyTotp(user.totp, body.code)) {
        recordLoginFailure(body.username);
        container.audit.log({ actor: user.name, role: user.role, action: 'login.2fa_failed' });
        reply.code(401);
        return { error: 'Code 2FA invalide' };
      }
    }

    clearLoginFailures(body.username);
    const account = { name: user.name, role: user.role, username: user.username };
    const { token, expiresAt, jti } = issueToken(account);
    registerSession({
      id: jti, username: user.username, name: user.name, role: user.role,
      ip: req.ip, userAgent: (req.headers['user-agent'] as string | undefined)?.slice(0, 120),
      createdAt: new Date().toISOString(), expiresAt,
    });
    container.audit.log({ actor: account.name, role: account.role, action: needs2fa ? 'login.success_2fa' : 'login.success' });
    return {
      token, expiresAt,
      account: { name: account.name, role: account.role, roleLabel: ROLE_LABEL[account.role], permissions: ROLE_PERMISSIONS[account.role] },
    };
  });

  await app.register(async (scoped) => {
    const admin = new AdminService(container);

    // Résout le compte : session JWT (Authorization: Bearer) OU jeton statique
    // (x-admin-token, compatibilité/automatisation). 401 si aucun n'est valide.
    scoped.addHook('preHandler', async (req) => {
      const jwt = bearerToken(req.headers['authorization'] as string | undefined);
      const verified = verifyToken(jwt);
      const account = verified ?? resolveAccount(req.headers['x-admin-token'] as string | undefined);
      if (!account) throw unauthorized('Session invalide ou expirée');
      if (verified?.jti) touchSession(verified.jti, req.ip); // trace d'activité (sessions actives)
      (req as FastifyRequest & { admin: AdminAccount }).admin = account;
    });

    const require = (req: FastifyRequest, perm: Permission): void => {
      const { admin: account } = req as FastifyRequest & { admin: AdminAccount };
      if (!can(account.role, perm)) throw forbidden(`Accès refusé (permission ${perm} requise)`);
    };

    // Journalise une action sensible (qui a fait quoi).
    const audit = (req: FastifyRequest, action: string, target?: string, details?: Record<string, unknown>) => {
      const { admin: account } = req as FastifyRequest & { admin: AdminAccount };
      container.audit.log({ actor: account.name, role: account.role, action, target, details });
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

    scoped.get('/admin/stats', async (req) => {
      require(req, 'overview:read');
      const q = parse(z.object({ days: z.coerce.number().int().min(1).max(90).optional() }), req.query);
      return admin.stats(q.days ?? 7);
    });

    // --- Recherche globale (résultats limités aux permissions du rôle) ---
    scoped.get('/admin/search', async (req) => {
      require(req, 'search:read');
      const { admin: account } = req as FastifyRequest & { admin: AdminAccount };
      const q = parse(z.object({ q: z.string().max(80).default('') }), req.query);
      return admin.search(q.q, {
        drivers: can(account.role, 'drivers:read'),
        clients: can(account.role, 'clients:read'),
        rides: can(account.role, 'rides:read'),
      });
    });

    // --- Trésorerie : virements à DOUBLE VALIDATION (maker-checker) ---
    scoped.get('/admin/treasury', async (req) => {
      require(req, 'treasury:read');
      return { transfers: container.treasury.list(), pending: container.treasury.pendingCount() };
    });

    scoped.post('/admin/treasury/request', async (req) => {
      require(req, 'treasury:request');
      const { admin: account } = req as FastifyRequest & { admin: AdminAccount };
      const body = parse(z.object({
        amount: z.number().positive().max(1_000_000_000),
        destination: z.string().min(3).max(120),
        reason: z.string().min(3).max(300),
      }), req.body);
      const transfer = container.treasury.request({ ...body, requestedBy: account.name, requestedRole: account.role });
      audit(req, 'treasury.request', transfer.id, { amount: transfer.amount, destination: transfer.destination });
      return { transfer };
    });

    scoped.post('/admin/treasury/:id/approve', async (req, reply) => {
      require(req, 'treasury:approve');
      const { id } = req.params as { id: string };
      const { admin: account } = req as FastifyRequest & { admin: AdminAccount };
      const result = container.treasury.approve(id, account.name);
      if (result === 'self') {
        reply.code(403);
        return { error: 'Séparation des tâches : impossible d’approuver sa propre demande.' };
      }
      if (!result) throw notFound('Demande introuvable ou déjà décidée');
      audit(req, 'treasury.approve', id, { amount: result.amount, destination: result.destination });
      return { transfer: result };
    });

    // Export comptable des virements (CSV — comptabilité / commissariat aux comptes).
    scoped.get('/admin/treasury.csv', async (req, reply) => {
      require(req, 'treasury:read');
      reply.header('content-type', 'text/csv; charset=utf-8');
      reply.header('content-disposition', 'attachment; filename="orion-tresorerie.csv"');
      return container.treasury.csv();
    });

    scoped.post('/admin/treasury/:id/reject', async (req) => {
      require(req, 'treasury:approve');
      const { id } = req.params as { id: string };
      const { admin: account } = req as FastifyRequest & { admin: AdminAccount };
      const body = parse(z.object({ note: z.string().max(300).optional() }), req.body ?? {});
      const transfer = container.treasury.reject(id, account.name, body.note);
      if (!transfer) throw notFound('Demande introuvable ou déjà décidée');
      audit(req, 'treasury.reject', id, { note: body.note });
      return { transfer };
    });

    const pageQuery = z.object({
      page: z.coerce.number().int().positive().optional(),
      limit: z.coerce.number().int().positive().max(200).optional(),
    });

    scoped.get('/admin/rides', async (req) => {
      require(req, 'rides:read');
      const q = parse(pageQuery.extend({ status: z.string().optional() }), req.query);
      return admin.rides(q);
    });

    scoped.get('/admin/drivers', async (req) => {
      require(req, 'drivers:read');
      const q = parse(pageQuery, req.query);
      return admin.drivers(q);
    });

    scoped.get('/admin/drivers/:id', async (req) => {
      require(req, 'drivers:read');
      const { id } = req.params as { id: string };
      const detail = admin.driverDetail(id);
      if (!detail) throw notFound('Chauffeur introuvable');
      return { driver: detail };
    });

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
      audit(req, 'pricing.update', undefined, body);
      return { pricing: container.settings.updatePricing(body) };
    });

    scoped.post('/admin/pricing/reset', async (req) => {
      require(req, 'pricing:write');
      audit(req, 'pricing.reset');
      return { pricing: container.settings.resetPricing() };
    });

    // --- Zones & tarifs par zone (levier prix par commune) ---
    scoped.get('/admin/zones', async (req) => { require(req, 'pricing:read'); return { zones: container.settings.getZones() }; });

    scoped.put('/admin/zones', async (req) => {
      require(req, 'pricing:write');
      const body = parse(z.object({
        id: z.string().min(2).max(40).regex(/^[a-z0-9_-]+$/),
        name: z.string().min(2).max(60),
        factor: z.number().min(0.1).max(5),
        lat: z.number().min(-90).max(90),
        lng: z.number().min(-180).max(180),
        radiusKm: z.number().min(0.1).max(100),
        active: z.boolean().optional(),
      }), req.body);
      const zone = container.settings.upsertZone({ active: true, ...body });
      audit(req, 'zone.upsert', zone.id, { name: zone.name, factor: zone.factor });
      return { zone };
    });

    scoped.post('/admin/zones/:id/active', async (req) => {
      require(req, 'pricing:write');
      const { id } = req.params as { id: string };
      const body = parse(z.object({ active: z.boolean() }), req.body);
      const zone = container.settings.setZoneActive(id, body.active);
      if (!zone) throw notFound('Zone introuvable');
      audit(req, 'zone.active', id, { active: body.active });
      return { zone };
    });

    scoped.delete('/admin/zones/:id', async (req) => {
      require(req, 'pricing:write');
      const { id } = req.params as { id: string };
      container.settings.removeZone(id);
      audit(req, 'zone.delete', id);
      return { ok: true };
    });

    scoped.post('/admin/zones/reset', async (req) => {
      require(req, 'pricing:write');
      audit(req, 'zone.reset');
      return { zones: container.settings.resetZones() };
    });

    // --- Sessions actives (qui est connecté à la console) ---
    scoped.get('/admin/sessions', async (req) => {
      require(req, 'sessions:read');
      const { admin: account } = req as FastifyRequest & { admin: AdminAccount & { jti?: string } };
      return { sessions: listSessions(), self: account.jti ?? null };
    });

    scoped.post('/admin/sessions/:id/revoke', async (req) => {
      require(req, 'sessions:write');
      const { id } = req.params as { id: string };
      if (!revokeSession(id)) throw notFound('Session introuvable ou expirée');
      audit(req, 'session.revoke', id);
      return { ok: true };
    });

    // --- Gestion chauffeurs (actions) ---
    scoped.post('/admin/drivers/:id/kyc', async (req) => {
      require(req, 'drivers:write');
      const { id } = req.params as { id: string };
      const body = parse(z.object({ status: z.enum(['draft', 'docs_submitted', 'manual_review', 'approved', 'active', 'suspended']) }), req.body);
      const d = container.drivers.get(id);
      if (!d) throw notFound('Chauffeur introuvable');
      d.kycStatus = body.status;
      if (body.status === 'suspended') void container.drivers.goOffline(id);
      container.drivers.persist(id);
      audit(req, 'driver.kyc', id, { status: body.status });
      return { driver: { id: d.id, kycStatus: d.kycStatus, availability: d.availability } };
    });

    scoped.post('/admin/drivers/:id/availability', async (req) => {
      require(req, 'drivers:write');
      const { id } = req.params as { id: string };
      const body = parse(z.object({ availability: z.enum(['offline', 'online', 'on_trip', 'paused']) }), req.body);
      if (!container.drivers.get(id)) throw notFound('Chauffeur introuvable');
      container.drivers.setAvailability(id, body.availability);
      audit(req, 'driver.availability', id, { availability: body.availability });
      return { ok: true };
    });

    // --- Clients ---
    scoped.get('/admin/clients', async (req) => {
      require(req, 'clients:read');
      const q = parse(pageQuery, req.query);
      const { items, meta } = paginate(container.clients.list(), q.page, q.limit);
      return { clients: items, ...meta };
    });

    scoped.get('/admin/clients/:id', async (req) => {
      require(req, 'clients:read');
      const { id } = req.params as { id: string };
      return { client: admin.clientDetail(id) };
    });

    scoped.post('/admin/clients/:id/status', async (req) => {
      require(req, 'clients:write');
      const { id } = req.params as { id: string };
      const body = parse(z.object({ status: z.enum(['active', 'blocked']) }), req.body);
      const c = container.clients.setStatus(id, body.status);
      if (!c) throw notFound('Client introuvable');
      audit(req, 'client.status', id, { status: body.status });
      return { client: c };
    });

    // --- Codes promo ---
    scoped.get('/admin/promos', async (req) => { require(req, 'promos:read'); return { promos: container.promos.list() }; });

    scoped.put('/admin/promos', async (req) => {
      require(req, 'promos:write');
      const body = parse(z.object({
        code: z.string().min(2).max(24),
        kind: z.enum(['percent', 'amount']),
        value: z.number().positive(),
        maxUses: z.number().int().positive().optional(),
        active: z.boolean().optional(),
      }), req.body);
      const promo = container.promos.upsert(body);
      audit(req, 'promo.upsert', promo.id, { kind: promo.kind, value: promo.value });
      return { promo };
    });

    scoped.post('/admin/promos/:code/active', async (req) => {
      require(req, 'promos:write');
      const { code } = req.params as { code: string };
      const body = parse(z.object({ active: z.boolean() }), req.body);
      const p = container.promos.setActive(code, body.active);
      if (!p) throw notFound('Code promo introuvable');
      audit(req, 'promo.active', code, { active: body.active });
      return { promo: p };
    });

    scoped.delete('/admin/promos/:code', async (req) => {
      require(req, 'promos:write');
      const { code } = req.params as { code: string };
      container.promos.remove(code);
      audit(req, 'promo.delete', code);
      return { ok: true };
    });

    // --- Services & disponibilité (zones) ---
    scoped.get('/admin/services', async (req) => { require(req, 'services:read'); return { config: container.settings.getServices() }; });

    scoped.put('/admin/services', async (req) => {
      require(req, 'services:write');
      const body = parse(z.object({
        city: z.string().optional(),
        open: z.boolean().optional(),
        services: z.record(z.string(), z.boolean()).optional(),
      }), req.body);
      const config = container.settings.updateServices(body);
      audit(req, 'services.update', undefined, body);
      return { config };
    });

    // --- Support & chat (côté agent) ---
    scoped.get('/admin/support', async (req) => { require(req, 'support:read'); return { conversations: container.support.list() }; });

    scoped.post('/admin/support/:id/reply', async (req) => {
      require(req, 'support:write');
      const { id } = req.params as { id: string };
      const body = parse(z.object({ text: z.string().min(1).max(2000) }), req.body);
      const { admin: account } = req as FastifyRequest & { admin: AdminAccount };
      const msg = container.support.post(id, { from: 'agent', author: account.name, text: body.text });
      if (!msg) throw notFound('Conversation introuvable');
      container.support.assign(id, account.name);
      audit(req, 'support.reply', id);
      return { message: msg };
    });

    scoped.post('/admin/support/:id/status', async (req) => {
      require(req, 'support:write');
      const { id } = req.params as { id: string };
      const body = parse(z.object({ status: z.enum(['open', 'pending', 'closed']) }), req.body);
      const conv = container.support.setStatus(id, body.status);
      if (!conv) throw notFound('Conversation introuvable');
      audit(req, 'support.status', id, { status: body.status });
      return { conversation: conv };
    });

    // --- Finances & export ---
    scoped.get('/admin/finance', async (req) => { require(req, 'finance:read'); return admin.finance(); });

    scoped.get('/admin/rides.csv', async (req, reply) => {
      require(req, 'rides:read');
      reply.header('content-type', 'text/csv; charset=utf-8');
      reply.header('content-disposition', 'attachment; filename="orion-courses.csv"');
      return admin.ridesCsv();
    });

    // --- Notifications / diffusion ---
    scoped.get('/admin/broadcasts', async (req) => { require(req, 'notify:read'); return { announcements: container.notifications.list() }; });

    scoped.post('/admin/broadcast', async (req) => {
      require(req, 'notify:write');
      const { admin: account } = req as FastifyRequest & { admin: AdminAccount };
      const body = parse(z.object({
        audience: z.enum(['clients', 'drivers', 'all']),
        title: z.string().min(1).max(120),
        body: z.string().min(1).max(1000),
      }), req.body);
      const a = container.notifications.broadcast({ ...body, author: account.name });
      audit(req, 'broadcast', a.id, { audience: a.audience, title: a.title });
      return { announcement: a };
    });

    // --- Journal d'audit ---
    scoped.get('/admin/audit', async (req) => { require(req, 'audit:read'); return { entries: container.audit.list(200) }; });
  });
}
