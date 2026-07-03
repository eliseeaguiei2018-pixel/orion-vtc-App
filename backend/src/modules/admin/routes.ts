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
import { SOS_PRESETS } from '../safety/service.js';

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
      if (!can(account.role, perm)) {
        // SIGNALEMENT DIRECTION : toute tentative d'accès à une session non autorisée
        // est enregistrée et notifiée au DG, au CFO et au DAA (alertes sécurité + audit).
        container.security.record({
          username: account.username, name: account.name, role: account.role,
          permission: perm, path: req.url, ip: req.ip,
        });
        container.audit.log({
          actor: account.name, role: account.role, action: 'access.denied',
          details: { permission: perm, path: req.url },
        });
        throw forbidden('Vous n’avez pas le droit d’accéder à cette session sans autorisation de la direction. Cette tentative a été signalée à la direction (DG, CFO, DAA).');
      }
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

    // Clic sur une session verrouillée dans la console : le refus est affiché à
    // l'employé ET la tentative est signalée à la direction (DG, CFO, DAA).
    scoped.post('/admin/access-denied', async (req) => {
      const body = parse(z.object({ section: z.string().min(1).max(60) }), req.body);
      const { admin: account } = req as FastifyRequest & { admin: AdminAccount };
      container.security.record({
        username: account.username, name: account.name, role: account.role,
        section: body.section, path: req.url, ip: req.ip,
      });
      container.audit.log({ actor: account.name, role: account.role, action: 'access.denied', details: { section: body.section } });
      return {
        reported: true,
        message: 'Vous n’avez pas le droit d’accéder à cette session sans autorisation de la direction. Cette tentative a été signalée à la direction (DG, CFO, DAA).',
      };
    });

    // Boîte « Alertes sécurité » de la direction : qui a tenté d'accéder à quoi.
    scoped.get('/admin/security-alerts', async (req) => {
      require(req, 'security:read');
      return { attempts: container.security.list(), total: container.security.count() };
    });

    scoped.get('/admin/overview', async (req) => { require(req, 'overview:read'); return admin.overview(); });

    scoped.get('/admin/stats', async (req) => {
      require(req, 'overview:read');
      const q = parse(z.object({ days: z.coerce.number().int().min(1).max(90).optional() }), req.query);
      return admin.stats(q.days ?? 7);
    });

    // --- Mobilité verte : CO2 économisé, part électrique, télémétrie batteries ---
    scoped.get('/admin/green', async (req) => { require(req, 'overview:read'); return admin.green(); });

    // Bilan carbone PDF (communication institutionnelle / subventions).
    scoped.get('/admin/green/report.pdf', async (req, reply) => {
      require(req, 'overview:read');
      reply.header('content-type', 'application/pdf');
      reply.header('content-disposition', 'attachment; filename="orion-bilan-carbone.pdf"');
      return admin.greenReportPdf();
    });

    // Export DATA ÉNERGIE (Excel) : km électriques, kWh estimés, coûts de recharge (OPEX).
    scoped.get('/admin/green/energy.csv', async (req, reply) => {
      require(req, 'overview:read');
      reply.header('content-type', 'text/csv; charset=utf-8');
      reply.header('content-disposition', 'attachment; filename="orion-energie.csv"');
      return admin.energyCsv();
    });

    // --- Intelligence & prédiction ---
    scoped.get('/admin/predict', async (req) => { require(req, 'rides:read'); return admin.predict(); });
    scoped.get('/admin/conversion', async (req) => { require(req, 'rides:read'); return { cells: container.demand.conversion() }; });
    scoped.get('/admin/churn', async (req) => { require(req, 'overview:read'); return admin.churn(); });

    // --- Comptes Entreprises (B2B) ---
    scoped.get('/admin/corporate', async (req) => { require(req, 'finance:read'); return { accounts: container.corporate.list() }; });

    scoped.put('/admin/corporate', async (req) => {
      require(req, 'treasury:request'); // création/modification : niveau finance dirigeante
      const body = parse(z.object({
        id: z.string().min(2).max(40).optional(),
        name: z.string().min(2).max(80),
        contactEmail: z.string().email().optional(),
        creditLimit: z.number().min(0).max(1_000_000_000),
        active: z.boolean().optional(),
      }), req.body);
      const account = container.corporate.upsert(body);
      audit(req, 'corporate.upsert', account.id, { name: account.name, creditLimit: account.creditLimit });
      return { account };
    });

    // Facture mensuelle consolidée (CSV compatible logiciels comptables).
    scoped.get('/admin/corporate/:id/invoice', async (req, reply) => {
      require(req, 'finance:read');
      const { id } = req.params as { id: string };
      const q = parse(z.object({ month: z.string().regex(/^\d{4}-\d{2}$/).optional() }), req.query);
      const month = q.month ?? new Date().toISOString().slice(0, 7);
      const acc = container.corporate.get(id);
      if (!acc) throw notFound('Compte entreprise introuvable');
      const rides = container.rides.listAll().filter((r) => r.corporateId === id && r.createdAt.startsWith(month));
      const total = rides.reduce((s, r) => s + r.quote.amount, 0);
      const esc = (v: unknown) => { let s = String(v ?? ''); if (/^[=+\-@]/.test(s)) s = `'${s}`; return `"${s.replace(/"/g, '""')}"`; };
      const head = ['course', 'date', 'client', 'statut', 'montant_fcfa'].join(',');
      const rows = rides.map((r) => [r.id, r.createdAt, r.clientId, r.status, r.quote.amount].map(esc).join(','));
      reply.header('content-type', 'text/csv; charset=utf-8');
      reply.header('content-disposition', `attachment; filename="facture-${id}-${month}.csv"`);
      return [`"Facture ORION — ${acc.name} — ${month}"`, head, ...rows, `"TOTAL",,,,"${total}"`].join('\n');
    });

    // Rapport ESG/RSE PDF : bilan carbone certifié des déplacements du client B2B.
    scoped.get('/admin/corporate/:id/esg.pdf', async (req, reply) => {
      require(req, 'finance:read');
      const { id } = req.params as { id: string };
      const pdf = admin.esgPdf(id);
      if (!pdf) throw notFound('Compte entreprise introuvable');
      reply.header('content-type', 'application/pdf');
      reply.header('content-disposition', `attachment; filename="orion-esg-${id}.pdf"`);
      return pdf;
    });

    // Facture réglée : réinitialise le crédit consommé (nouvelle période).
    scoped.post('/admin/corporate/:id/settle', async (req) => {
      require(req, 'treasury:approve'); // encaissement : aval direction
      const { id } = req.params as { id: string };
      const account = container.corporate.settle(id);
      if (!account) throw notFound('Compte entreprise introuvable');
      audit(req, 'corporate.settle', id);
      return { account };
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

    /** Dossier scellé : lecture réservée à la direction après clôture. */
    const assertSealedAccess = (req: FastifyRequest, sealed?: boolean): void => {
      const { admin: account } = req as FastifyRequest & { admin: AdminAccount };
      if (sealed && !EXEC_ROLES.has(account.role)) {
        throw forbidden('Dossier scellé — accès réservé à la direction');
      }
    };

    // File de TRIAGE SAMU : niveaux rouge/orange/jaune + chrono SLA + détection
    // automatique des déviations majeures / courses figées sur le réseau actif.
    scoped.get('/admin/sos', async (req) => {
      require(req, 'alerts:read');
      for (const r of container.rides.listAll()) {
        const anomaly = admin.rideAnomaly(r);
        if (anomaly === 'detour') {
          container.safety.raiseSystem({
            kind: 'deviation', userId: r.clientId, rideId: r.id,
            location: r.trace?.length ? r.trace[r.trace.length - 1]! : r.origin,
            note: 'Déviation majeure inexpliquée (itinéraire réel très supérieur au prévu)',
          });
        } else if (anomaly === 'immobile') {
          container.safety.raiseSystem({
            kind: 'immobilisation', userId: r.clientId, rideId: r.id,
            location: r.trace?.length ? r.trace[r.trace.length - 1]! : r.origin,
            note: 'Véhicule anormalement immobilisé (course figée)',
          });
        }
      }
      const now = Date.now();
      const alerts = container.safety.triage().map((a) => ({
        ...a,
        slaSeconds: Math.max(0, Math.round((now - Date.parse(a.createdAt)) / 1000)),
      }));
      return { alerts, presets: SOS_PRESETS };
    });

    // Prise en charge NOMINATIVE : verrou anti-doublon (un seul agent par crise).
    scoped.post('/admin/sos/:id/claim', async (req, reply) => {
      require(req, 'alerts:write');
      const { id } = req.params as { id: string };
      const { admin: account } = req as FastifyRequest & { admin: AdminAccount };
      const result = container.safety.claim(id, account.name);
      if (!result) throw notFound('Alerte introuvable');
      if (result === 'taken') {
        reply.code(409);
        return { error: 'Alerte déjà prise en charge par un autre agent (verrou nominatif).' };
      }
      audit(req, 'sos.claim', id, { level: result.level });
      return { alert: result };
    });

    // Chat sécurisé DISCRET : messages pré-enregistrés ou libres vers l'usager.
    scoped.post('/admin/sos/:id/message', async (req, reply) => {
      require(req, 'alerts:write');
      const { id } = req.params as { id: string };
      const body = parse(z.object({ text: z.string().min(1).max(300) }), req.body);
      const { admin: account } = req as FastifyRequest & { admin: AdminAccount };
      const alert = container.safety.get(id);
      if (!alert) throw notFound('Alerte introuvable');
      if (alert.agent && alert.agent !== account.name) {
        reply.code(403);
        return { error: 'Crise gérée par un autre agent (prise en charge nominative).' };
      }
      if (!alert.agent) container.safety.claim(id, account.name);
      const message = container.safety.postChat(id, { from: 'agent', author: account.name, text: body.text });
      audit(req, 'sos.message', id);
      return { message };
    });

    // Clôture : note de synthèse OBLIGATOIRE → dossier SCELLÉ numériquement.
    scoped.post('/admin/sos/:id/close', async (req, reply) => {
      require(req, 'alerts:write');
      const { id } = req.params as { id: string };
      const body = parse(z.object({ note: z.string().min(10).max(2000) }), req.body);
      const { admin: account } = req as FastifyRequest & { admin: AdminAccount };
      const result = container.safety.close(id, account.name, body.note);
      if (!result) throw notFound('Alerte introuvable');
      if (result === 'not_agent') {
        reply.code(403);
        return { error: 'Seul l’agent gestionnaire peut clore cette alerte.' };
      }
      audit(req, 'sos.close', id, { sealed: true });
      return { alert: result };
    });

    // Dossier d'identification instantanée : véhicule, chauffeur, passager,
    // batteries téléphone, itinéraire théorique vs réel, vitesse estimée.
    scoped.get('/admin/sos/:id', async (req) => {
      require(req, 'alerts:read');
      const { id } = req.params as { id: string };
      const alert = container.safety.get(id);
      if (!alert) throw notFound('Alerte introuvable');
      assertSealedAccess(req, alert.sealed);
      const ride = alert.rideId ? container.rides.get(alert.rideId) : undefined;
      const driver = ride?.driverId ? container.drivers.get(ride.driverId) : undefined;
      const client = container.clients.get(ride?.clientId ?? alert.userId);
      // Niveau de batterie des téléphones (remontée app ; valeur stable simulée à défaut).
      const pseudoBatt = (s: string) => 30 + ([...s].reduce((a, c) => a + c.charCodeAt(0), 0) % 66);
      const trace = ride?.trace ?? [];
      let speedEstimateKmh: number | null = null;
      if (trace.length >= 2) {
        const { haversineMeters } = await import('../../core/geo.js');
        speedEstimateKmh = Math.round(haversineMeters(trace[trace.length - 2]!, trace[trace.length - 1]!) * 3.6);
      }
      return {
        alert,
        presets: SOS_PRESETS,
        ride: ride ? {
          id: ride.id, status: ride.status, origin: ride.origin, destination: ride.destination,
          trace, createdAt: ride.createdAt,
        } : null,
        vehicle: driver ? {
          plate: driver.vehiclePlate ?? driver.matricule, model: driver.vehicleModel ?? 'n/c',
          color: driver.vehicleColor ?? 'n/c', engine: driver.engine ?? 'electric',
        } : null,
        driver: driver ? {
          id: driver.id, name: driver.name, matricule: driver.matricule, phone: driver.phone ?? null,
          licenseNo: driver.licenseNo ?? null, birthDate: driver.birthDate ?? null,
          phoneBatteryPct: pseudoBatt(driver.id), batteryPct: driver.batteryPct ?? null,
        } : null,
        passenger: {
          id: ride?.clientId ?? alert.userId,
          name: client?.name ?? null, phone: client?.phone ?? null,
          phoneBatteryPct: pseudoBatt(ride?.clientId ?? alert.userId),
          lastRides: container.rides.listByClient(ride?.clientId ?? alert.userId).slice(0, 5)
            .map((r) => ({ id: r.id, status: r.status, createdAt: r.createdAt })),
        },
        telemetry: { speedEstimateKmh, points: trace.length, refreshSeconds: 1 },
        emergencyNumbers: { samu: '185', police: '170', pompiers: '180' },
      };
    });

    // RAPPORT DE RÉQUISITION PDF (procureur / police) — horodaté, certifié.
    scoped.get('/admin/sos/:id/report.pdf', async (req, reply) => {
      require(req, 'alerts:read');
      const { id } = req.params as { id: string };
      const alert = container.safety.get(id);
      if (!alert) throw notFound('Alerte introuvable');
      assertSealedAccess(req, alert.sealed);
      audit(req, 'sos.report', id);
      reply.header('content-type', 'application/pdf');
      reply.header('content-disposition', `attachment; filename="orion-requisition-${id.slice(0, 8)}.pdf"`);
      return admin.sosReportPdf(alert);
    });

    // Logs bruts de télémétrie (CSV) — analyse enquêteurs / assurances.
    scoped.get('/admin/sos/:id/telemetry.csv', async (req, reply) => {
      require(req, 'alerts:read');
      const { id } = req.params as { id: string };
      const alert = container.safety.get(id);
      if (!alert) throw notFound('Alerte introuvable');
      assertSealedAccess(req, alert.sealed);
      reply.header('content-type', 'text/csv; charset=utf-8');
      reply.header('content-disposition', `attachment; filename="orion-telemetrie-${id.slice(0, 8)}.csv"`);
      return admin.sosTelemetryCsv(alert);
    });

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
        // Micro-zonage résidentiel (qualité de service)
        waitMaxMin: z.number().min(1).max(60).optional(),
        driverBonus: z.number().min(0).max(5000).optional(),
        minStandard: z.enum(['bronze', 'argent', 'or', 'diamant']).optional(),
        pickupFee: z.number().min(0).max(10_000).optional(),
        dedicated: z.boolean().optional(),
        // Surge MANUEL d'urgence (stade, concert…) — plafonné par le cap vert.
        surgeManual: z.number().min(1).max(2.5).optional(),
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

    // --- Dispatch & affectation (règles pilotables + qualité) ---
    scoped.get('/admin/dispatch', async (req) => { require(req, 'rides:read'); return { ops: container.settings.getOps() }; });

    scoped.put('/admin/dispatch', async (req) => {
      require(req, 'rides:write');
      const body = parse(z.object({
        strategy: z.enum(['nearest', 'longest_idle', 'zone_queue']).optional(),
        minRating: z.number().min(1).max(5).optional(),
        autoWarn: z.boolean().optional(),
        maxEtaMinutes: z.number().min(2).max(30).optional(),
        offerTimeoutSec: z.number().min(10).max(15).optional(),
        surgeEnabled: z.boolean().optional(),
        surgeCapGreen: z.number().min(1).max(2).optional(),
        waitFeePerMin: z.number().min(0).max(1000).optional(),
        // Rayons évolutifs + mode d'offre + pondération scoring + priorisation verte.
        radiusKm: z.number().min(0.5).max(10).optional(),
        radiusMaxKm: z.number().min(1).max(20).optional(),
        offerMode: z.enum(['cascade', 'broadcast']).optional(),
        weightRating: z.number().min(0).max(10).optional(),
        weightIdle: z.number().min(0).max(10).optional(),
        greenPriority: z.boolean().optional(),
        // Surge : seuil de déclenchement + lissage du retour à la normale.
        surgeThreshold: z.number().min(1.1).max(3).optional(),
        surgeSmoothingMin: z.number().min(0).max(30).optional(),
        // Plafond de remboursement support + incitations heures creuses (verte).
        refundCap: z.number().min(0).max(100_000).optional(),
        offPeakBonus: z.number().min(0).max(5000).optional(),
        offPeakStart: z.number().int().min(0).max(23).optional(),
        offPeakEnd: z.number().int().min(0).max(23).optional(),
      }), req.body);
      const ops = container.settings.updateOps(body);
      audit(req, 'dispatch.update', undefined, body);
      return { ops };
    });

    // SHADOW MODE : simule une configuration hypothétique sur les courses passées
    // (taux de matching, ETA moyen) sans toucher au réseau réel.
    scoped.post('/admin/dispatch/simulate', async (req) => {
      require(req, 'rides:read');
      const body = parse(z.object({
        maxEtaMinutes: z.number().min(2).max(30).optional(),
        radiusMaxKm: z.number().min(1).max(20).optional(),
      }), req.body ?? {});
      return admin.simulateDispatch(body);
    });

    // Documentation technique PDF : paramètres algorithmiques actifs (audit / investisseurs).
    scoped.get('/admin/dispatch/config.pdf', async (req, reply) => {
      require(req, 'rides:read');
      reply.header('content-type', 'application/pdf');
      reply.header('content-disposition', 'attachment; filename="orion-config-dispatch.pdf"');
      return admin.dispatchConfigPdf();
    });

    // Matrice tarifaire Excel/CSV (grille complète pour le business plan).
    scoped.get('/admin/pricing/matrix.csv', async (req, reply) => {
      require(req, 'pricing:read');
      reply.header('content-type', 'text/csv; charset=utf-8');
      reply.header('content-disposition', 'attachment; filename="orion-matrice-tarifaire.csv"');
      return admin.pricingMatrixCsv();
    });

    // Zones à forte demande (cellules) : demande vs offre + surge courant.
    scoped.get('/admin/demand', async (req) => {
      require(req, 'rides:read');
      return { cells: await container.demand.hotCells() };
    });

    // Réassignation MANUELLE d'une course (bug, chauffeur injoignable, incident).
    scoped.post('/admin/rides/:id/reassign', async (req, reply) => {
      require(req, 'rides:write');
      const { id } = req.params as { id: string };
      const body = parse(z.object({ driverId: z.string().optional() }), req.body ?? {});
      const ride = container.rides.get(id);
      if (!ride) throw notFound('Course introuvable');
      const REASSIGNABLE = new Set(['searching', 'no_driver', 'accepted', 'driver_en_route', 'arrived']);
      if (!REASSIGNABLE.has(ride.status)) {
        reply.code(409);
        return { error: `Course non réassignable au statut « ${ride.status} »` };
      }
      // Libère l'ancien chauffeur.
      const previous = ride.driverId ?? null;
      if (previous) {
        container.matching.releaseLock(previous);
        container.drivers.setAvailability(previous, 'online');
      }
      // Chauffeur imposé, ou re-matching automatique (règle de dispatch courante).
      let next: string | null = null;
      if (body.driverId) {
        const d = container.drivers.get(body.driverId);
        if (!d) throw notFound('Chauffeur introuvable');
        if (d.availability !== 'online' || d.id === previous) {
          reply.code(409);
          return { error: 'Ce chauffeur n’est pas disponible' };
        }
        next = d.id;
      } else {
        const match = await container.matching.findDriver(ride.origin, ride.quote.category);
        next = match && match.driverId !== previous ? match.driverId : null;
        if (match && match.driverId === previous) container.matching.releaseLock(match.driverId);
      }
      if (!next) {
        ride.driverId = undefined;
        ride.status = 'no_driver';
        ride.events.push({ type: 'reassign_failed', at: new Date().toISOString(), payload: { previous } });
        container.rides.persist(ride);
        reply.code(409);
        return { error: 'Aucun chauffeur disponible pour la réassignation' };
      }
      ride.driverId = next;
      ride.status = 'accepted';
      ride.events.push({ type: 'reassigned', at: new Date().toISOString(), payload: { previous, next } });
      container.drivers.setAvailability(next, 'on_trip');
      container.rides.persist(ride);
      audit(req, 'ride.reassign', id, { previous, next });
      const d = container.drivers.get(next);
      return { ride: { id: ride.id, status: ride.status, driverId: next, driverName: d?.name ?? null, matricule: d?.matricule ?? null } };
    });

    // CLÔTURE FORCÉE : termine ou annule manuellement une course bloquée
    // (bug réseau app chauffeur, course figée) — sans frais, tracée à l'audit.
    scoped.post('/admin/rides/:id/force', async (req, reply) => {
      require(req, 'rides:write');
      const { id } = req.params as { id: string };
      const body = parse(z.object({ action: z.enum(['complete', 'cancel']) }), req.body);
      const ride = container.rides.get(id);
      if (!ride) throw notFound('Course introuvable');
      const TERMINAL = new Set(['completed', 'paid', 'rated', 'cancelled']);
      if (TERMINAL.has(ride.status)) {
        reply.code(409);
        return { error: `Course déjà terminée (statut « ${ride.status} »)` };
      }
      const { admin: account } = req as FastifyRequest & { admin: AdminAccount };
      ride.status = body.action === 'complete' ? 'completed' : 'cancelled';
      ride.events.push({ type: `force_${body.action}`, at: new Date().toISOString(), payload: { by: account.name } });
      if (ride.driverId) {
        container.matching.releaseLock(ride.driverId);
        container.drivers.setAvailability(ride.driverId, 'online');
      }
      container.rides.persist(ride);
      audit(req, `ride.force_${body.action}`, id);
      return { ride: { id: ride.id, status: ride.status } };
    });

    // AJUSTEMENT DE DESTINATION EN VOL : mise à jour de l'arrivée depuis la
    // console, devis recalculé proportionnellement (plancher minFare respecté).
    scoped.put('/admin/rides/:id/destination', async (req, reply) => {
      require(req, 'rides:write');
      const { id } = req.params as { id: string };
      const body = parse(z.object({
        lat: z.number().min(-90).max(90),
        lng: z.number().min(-180).max(180),
      }), req.body);
      const ride = container.rides.get(id);
      if (!ride) throw notFound('Course introuvable');
      const ACTIVE = new Set(['accepted', 'driver_en_route', 'arrived', 'in_progress']);
      if (!ACTIVE.has(ride.status)) {
        reply.code(409);
        return { error: `Destination modifiable uniquement en course (statut « ${ride.status} »)` };
      }
      const { haversineMeters } = await import('../../core/geo.js');
      const oldDist = ride.quote.distanceMeters || haversineMeters(ride.origin, ride.destination) || 1;
      const newDist = Math.max(200, Math.round(haversineMeters(ride.origin, body)));
      const oldAmount = ride.quote.amount;
      const minFare = container.settings.getPricing().minFare;
      const newAmount = Math.max(minFare, Math.round(oldAmount * newDist / oldDist));
      ride.destination = { lat: body.lat, lng: body.lng };
      ride.quote.distanceMeters = newDist;
      ride.quote.amount = newAmount;
      ride.events.push({ type: 'destination_changed', at: new Date().toISOString(), payload: { oldAmount, newAmount, newDist } });
      container.rides.persist(ride);
      audit(req, 'ride.destination', id, { oldAmount, newAmount });
      return { ride: { id: ride.id, destination: ride.destination, amount: newAmount } };
    });

    // --- Réservations à l'avance (calendrier + monitoring de ponctualité) ---
    scoped.get('/admin/reservations', async (req) => {
      require(req, 'rides:read');
      const now = Date.now();
      const reservations = container.reservations.list().map((r) => {
        const driver = r.driverId ? container.drivers.get(r.driverId) : undefined;
        const minutesToGo = Math.round((Date.parse(r.scheduledFor) - now) / 60_000);
        // Alerte préventive 30 min avant : pas de chauffeur prêt → risque de retard.
        const punctualityAlert = (r.status === 'planifiee' || r.status === 'assignee')
          && minutesToGo <= 30 && minutesToGo > -60
          && (!driver || driver.availability !== 'online');
        return { ...r, driverName: driver?.name ?? null, minutesToGo, punctualityAlert };
      });
      return { reservations };
    });

    scoped.post('/admin/reservations/:id/assign', async (req, reply) => {
      require(req, 'rides:write');
      const { id } = req.params as { id: string };
      const body = parse(z.object({ driverId: z.string().optional() }), req.body ?? {});
      const r = container.reservations.get(id);
      if (!r) throw notFound('Réservation introuvable');
      let driverId = body.driverId ?? null;
      if (driverId) {
        const d = container.drivers.get(driverId);
        if (!d) throw notFound('Chauffeur introuvable');
      } else {
        const match = await container.matching.findDriver(r.origin, r.category, undefined, r.clientId);
        if (match) { driverId = match.driverId; container.matching.releaseLock(match.driverId); }
      }
      if (!driverId) {
        reply.code(409);
        return { error: 'Aucun chauffeur disponible pour cette réservation' };
      }
      const updated = container.reservations.assign(id, driverId);
      audit(req, 'reservation.assign', id, { driverId });
      const d = container.drivers.get(driverId);
      return { reservation: { ...updated!, driverName: d?.name ?? null } };
    });

    scoped.post('/admin/reservations/:id/cancel', async (req) => {
      require(req, 'rides:write');
      const { id } = req.params as { id: string };
      const r = container.reservations.setStatus(id, 'annulee');
      if (!r) throw notFound('Réservation introuvable');
      audit(req, 'reservation.cancel', id);
      return { reservation: r };
    });

    // Fiche complète d'une course (instruction de litige : tracé GPS + tarification + événements).
    scoped.get('/admin/rides/:id', async (req) => {
      require(req, 'rides:read');
      const { id } = req.params as { id: string };
      const ride = container.rides.get(id);
      if (!ride) throw notFound('Course introuvable');
      const d = ride.driverId ? container.drivers.get(ride.driverId) : undefined;
      return { ride, driverName: d?.name ?? null, matricule: d?.matricule ?? null };
    });

    // --- Qualité & notes (modération) ---
    scoped.get('/admin/quality', async (req) => {
      require(req, 'drivers:read');
      const ops = container.settings.getOps();
      const all = container.drivers.list();
      const drivers = all
        .map((d) => ({ id: d.id, name: d.name, matricule: d.matricule, category: d.category, rating: d.ratingAvg, trips: d.ratingCount, warnings: d.warnings ?? 0, kycStatus: d.kycStatus, vip: d.vip ?? false, below: d.ratingCount >= 5 && d.ratingAvg < ops.minRating }))
        .sort((a, b) => a.rating - b.rating)
        .slice(0, 100);
      // PROGRAMME VIP / TOP DRIVER : top 5 % de la flotte (note, volume significatif).
      const eligible = all.filter((d) => d.ratingCount >= 20).sort((a, b) => b.ratingAvg - a.ratingAvg);
      const top = eligible.slice(0, Math.max(1, Math.ceil(eligible.length * 0.05)))
        .map((d) => ({ id: d.id, name: d.name, matricule: d.matricule, rating: d.ratingAvg, trips: d.ratingCount, vip: d.vip ?? false }));
      return { threshold: ops.minRating, autoWarn: ops.autoWarn, drivers, top };
    });

    // Courbe CSAT 7 jours + taux d'acceptation / d'annulation du réseau.
    scoped.get('/admin/quality/csat', async (req) => { require(req, 'drivers:read'); return admin.qualityCsat(); });

    // Statut TOP DRIVER (VIP) : priorité dispatch + commission réduite (affichage).
    scoped.post('/admin/drivers/:id/vip', async (req) => {
      require(req, 'drivers:write');
      const { id } = req.params as { id: string };
      assertManagerScope(req, id);
      const body = parse(z.object({ vip: z.boolean() }), req.body);
      const d = container.drivers.get(id);
      if (!d) throw notFound('Chauffeur introuvable');
      d.vip = body.vip;
      container.drivers.persist(id);
      audit(req, 'driver.vip', id, { vip: body.vip });
      return { driver: { id: d.id, vip: d.vip } };
    });

    // Matrice de performance (Excel) : corrélation notes ↔ chiffre d'affaires.
    scoped.get('/admin/quality.csv', async (req, reply) => {
      require(req, 'drivers:read');
      reply.header('content-type', 'text/csv; charset=utf-8');
      reply.header('content-disposition', 'attachment; filename="orion-matrice-qualite.csv"');
      return admin.qualityCsv();
    });

    // Bilan qualité individuel PDF (entretien RH / gestionnaire de flotte).
    scoped.get('/admin/drivers/:id/quality.pdf', async (req, reply) => {
      require(req, 'drivers:read');
      const { id } = req.params as { id: string };
      const pdf = admin.driverQualityPdf(id);
      if (!pdf) throw notFound('Chauffeur introuvable');
      reply.header('content-type', 'application/pdf');
      reply.header('content-disposition', `attachment; filename="orion-qualite-${id.slice(0, 8)}.pdf"`);
      return pdf;
    });

    // Cantonnement : épingle un chauffeur à une zone (null = libère). La zone
    // stratégique n'est ainsi jamais en pénurie, même si la demande est ailleurs.
    scoped.post('/admin/drivers/:id/zone', async (req) => {
      require(req, 'drivers:write');
      const { id } = req.params as { id: string };
      assertManagerScope(req, id);
      const body = parse(z.object({ zoneId: z.string().nullable() }), req.body);
      const d = container.drivers.get(id);
      if (!d) throw notFound('Chauffeur introuvable');
      if (body.zoneId && !container.settings.getZones().some((zn) => zn.id === body.zoneId)) {
        throw notFound('Zone introuvable');
      }
      d.zoneLockId = body.zoneId ?? undefined;
      container.drivers.persist(id);
      audit(req, 'driver.zone_lock', id, { zoneId: body.zoneId });
      return { driver: { id: d.id, zoneLockId: d.zoneLockId ?? null } };
    });

    scoped.post('/admin/drivers/:id/warn', async (req) => {
      require(req, 'drivers:write');
      const { id } = req.params as { id: string };
      assertManagerScope(req, id);
      const d = container.drivers.get(id);
      if (!d) throw notFound('Chauffeur introuvable');
      d.warnings = (d.warnings ?? 0) + 1;
      container.drivers.persist(id);
      audit(req, 'driver.warning', id, { warnings: d.warnings });
      return { driver: { id: d.id, warnings: d.warnings } };
    });

    // --- Litiges & réclamations ---
    scoped.get('/admin/disputes', async (req) => {
      require(req, 'support:read');
      return { disputes: container.disputes.list(), open: container.disputes.openCount() };
    });

    scoped.post('/admin/disputes/:id/status', async (req, reply) => {
      require(req, 'support:write');
      const { id } = req.params as { id: string };
      const body = parse(z.object({
        status: z.enum(['investigating', 'resolved', 'rejected']),
        resolution: z.string().max(500).optional(),
        refund: z.number().min(0).max(1_000_000).optional(),
      }), req.body);
      const { admin: account } = req as FastifyRequest & { admin: AdminAccount };
      // PLAFOND D'AUTORISATION : au-delà du plafond console, seul un superviseur
      // (direction / treasury:approve) peut valider le remboursement → escalade.
      const cap = container.settings.getOps().refundCap;
      if (body.status === 'resolved' && (body.refund ?? 0) > cap && !can(account.role, 'treasury:approve')) {
        reply.code(403);
        return { error: `Remboursement supérieur au plafond agent (${cap} F CFA) — escalade au Superviseur Support requise.` };
      }
      const dispute = container.disputes.decide(id, body.status, account.name, body.resolution, body.refund);
      if (!dispute) throw notFound('Litige introuvable');
      // Remboursement éventuel → crédité sur le portefeuille client (traçable).
      if (body.status === 'resolved' && (body.refund ?? 0) > 0) {
        container.clientWallet.credit(dispute.clientId, body.refund!, 'adjustment', `Litige ${dispute.id} — remboursement`, dispute.rideId);
      }
      audit(req, `dispute.${body.status}`, id, { refund: body.refund, kind: dispute.kind });
      return { dispute };
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

    // Portée chef d'équipe : un manager n'agit QUE sur les chauffeurs de sa flotte.
    const assertManagerScope = (req: FastifyRequest, driverId: string): void => {
      const { admin: account } = req as FastifyRequest & { admin: AdminAccount };
      if (account.role === 'manager' && !container.teams.managerOwnsDriver(account.username ?? '', driverId)) {
        throw forbidden('Chef d’équipe : action limitée aux chauffeurs de votre flotte');
      }
    };

    // --- Équipes & managers (flottes affiliées) ---
    scoped.get('/admin/teams', async (req) => {
      require(req, 'teams:read');
      const { admin: account } = req as FastifyRequest & { admin: AdminAccount };
      // Un chef d'équipe ne voit QUE ses équipes (portée serveur).
      const teams = account.role === 'manager'
        ? container.teams.listByManager(account.username ?? '')
        : container.teams.list();
      const detail = teams.map((t) => ({
        ...t,
        drivers: t.driverIds
          .map((did) => container.drivers.get(did))
          .filter((d): d is NonNullable<typeof d> => Boolean(d))
          .map((d) => ({ id: d.id, name: d.name, matricule: d.matricule, availability: d.availability, rating: d.ratingAvg })),
      }));
      return { teams: detail };
    });

    scoped.put('/admin/teams', async (req) => {
      require(req, 'teams:write');
      const body = parse(z.object({
        id: z.string().optional(),
        name: z.string().min(2).max(60),
        managerUsername: z.string().min(1).max(80),
        managerName: z.string().max(80).optional(),
        driverIds: z.array(z.string()).max(500).optional(),
      }), req.body);
      const team = container.teams.upsert(body);
      audit(req, 'team.upsert', team.id, { name: team.name, manager: team.managerUsername, fleet: team.driverIds.length });
      return { team };
    });

    scoped.post('/admin/teams/:id/drivers', async (req) => {
      require(req, 'teams:write');
      const { id } = req.params as { id: string };
      const body = parse(z.object({ driverIds: z.array(z.string()).max(500) }), req.body);
      const team = container.teams.setDrivers(id, body.driverIds);
      if (!team) throw notFound('Équipe introuvable');
      audit(req, 'team.fleet', id, { fleet: team.driverIds.length });
      return { team };
    });

    scoped.delete('/admin/teams/:id', async (req) => {
      require(req, 'teams:write');
      const { id } = req.params as { id: string };
      container.teams.remove(id);
      audit(req, 'team.delete', id);
      return { ok: true };
    });

    // --- Gestion chauffeurs (actions) ---
    scoped.post('/admin/drivers/:id/kyc', async (req) => {
      require(req, 'drivers:write');
      const { id } = req.params as { id: string };
      assertManagerScope(req, id);
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
      assertManagerScope(req, id);
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
    // Boîte de réception INTELLIGENTE : tri par priorité (objet oublié > facturation
    // > général) puis ancienneté ; indicateurs SLA/CSAT + macros en un clic.
    scoped.get('/admin/support', async (req) => {
      require(req, 'support:read');
      return { conversations: container.support.inbox(), stats: container.support.stats() };
    });

    scoped.get('/admin/support/stats', async (req) => { require(req, 'support:read'); return container.support.stats(); });

    scoped.get('/admin/support/macros', async (req) => {
      require(req, 'support:read');
      const { SUPPORT_MACROS } = await import('../support/service.js');
      return { macros: SUPPORT_MACROS };
    });

    // Code promotionnel PERSONNALISÉ de dédommagement (usage unique, expiration courte),
    // notifié directement dans l'app du passager.
    scoped.post('/admin/promos/compensation', async (req) => {
      require(req, 'promos:write');
      const body = parse(z.object({
        clientId: z.string().min(1).max(80),
        percent: z.number().min(5).max(50),
        days: z.number().int().min(1).max(30).default(7),
      }), req.body);
      const promo = container.promos.compensation(body);
      container.notifications.notify(
        { clientId: body.clientId },
        'Un geste commercial ORION 💚',
        `Nous sommes désolés pour ce désagrément. Votre code ${promo.id} (-${promo.value} %) est valable ${body.days} jours sur votre prochaine course.`,
      );
      audit(req, 'promo.compensation', promo.id, { clientId: body.clientId, percent: promo.value });
      return { promo };
    });

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
        // Studio multicanal + hyper-ciblage + planification.
        channel: z.enum(['push', 'sms', 'email']).optional(),
        segment: z.enum(['tous', 'nouveaux', 'vip', 'green', 'inactifs']).optional(),
        zoneId: z.string().max(40).optional(),
        scheduledAt: z.string().datetime().optional(),
      }), req.body);
      // Taille de l'audience ciblée (segments comportementaux) → stats de campagne.
      const clients = container.clients.list();
      const THIRTY_D = 30 * 86_400_000;
      let audienceCount = body.audience === 'drivers' ? container.drivers.list().length : clients.length;
      if (body.audience !== 'drivers') {
        if (body.segment === 'nouveaux') audienceCount = clients.filter((c) => c.rides === 0).length;
        if (body.segment === 'vip') audienceCount = clients.filter((c) => c.rides >= 10).length;
        if (body.segment === 'green') audienceCount = clients.filter((c) => (c.greenPoints ?? 0) > 0).length;
        if (body.segment === 'inactifs') audienceCount = clients.filter((c) => Date.now() - Date.parse(c.lastSeenAt) > THIRTY_D).length;
      }
      const a = container.notifications.broadcast({ ...body, author: account.name, audienceCount });
      audit(req, 'broadcast', a.id, { audience: a.audience, channel: a.channel, segment: a.segment, title: a.title });
      return { announcement: a };
    });

    // DÉCLENCHEURS AUTOMATISÉS : batterie < 15 % → borne la plus proche ;
    // win-back 30 jours ; incitation recharge heures creuses.
    scoped.get('/admin/notify/triggers', async (req) => {
      require(req, 'notify:read');
      const { CHARGING_STATIONS } = await import('./service.js');
      const { haversineMeters } = await import('../../core/geo.js');
      const ops = container.settings.getOps();
      const snap = await container.geo.snapshot();
      const posOf = (id: string) => snap.find((e) => e.id === id);
      const lowBattery = container.drivers.list()
        .filter((d) => (d.engine ?? 'electric') === 'electric' && d.batteryPct !== undefined && d.batteryPct < 15)
        .map((d) => {
          const pos = posOf(d.id);
          const station = pos
            ? [...CHARGING_STATIONS].sort((s1, s2) =>
                haversineMeters(pos, s1) - haversineMeters(pos, s2))[0]
            : CHARGING_STATIONS[0];
          return { id: d.id, name: d.name, matricule: d.matricule, batteryPct: d.batteryPct, station: station?.name ?? null };
        });
      const THIRTY_D = 30 * 86_400_000;
      const winback = container.clients.list()
        .filter((c) => c.rides >= 1 && Date.now() - Date.parse(c.lastSeenAt) > THIRTY_D)
        .slice(0, 20)
        .map((c) => ({ id: c.id, name: c.name ?? null, rides: c.rides, lastSeenAt: c.lastSeenAt }));
      return {
        lowBattery, winback,
        offPeak: { start: ops.offPeakStart, end: ops.offPeakEnd, bonus: ops.offPeakBonus },
      };
    });

    scoped.post('/admin/notify/triggers/run', async (req) => {
      require(req, 'notify:write');
      const body = parse(z.object({ trigger: z.enum(['battery', 'winback']) }), req.body);
      const { admin: account } = req as FastifyRequest & { admin: AdminAccount };
      if (body.trigger === 'battery') {
        const { CHARGING_STATIONS } = await import('./service.js');
        const low = container.drivers.list()
          .filter((d) => (d.engine ?? 'electric') === 'electric' && d.batteryPct !== undefined && d.batteryPct < 15);
        for (const d of low) {
          container.notifications.notify(
            { driverId: d.id },
            'Batterie faible — borne partenaire 🔌',
            `Votre batterie est à ${d.batteryPct} %. Borne recommandée : ${CHARGING_STATIONS[0]?.name}. Bonus heures creuses : ${container.settings.getOps().offPeakBonus} F.`,
          );
        }
        const a = container.notifications.broadcast({
          audience: 'drivers', channel: 'push', segment: 'green', author: account.name,
          title: 'Alerte flotte verte (auto)', body: 'Guidage borne envoyé aux véhicules < 15 % de batterie.',
          audienceCount: low.length,
        });
        audit(req, 'notify.trigger', a.id, { trigger: 'battery', sent: low.length });
        return { sent: low.length, announcement: a };
      }
      // Win-back : code court + notification aux clients silencieux depuis 30 jours.
      const THIRTY_D = 30 * 86_400_000;
      const silent = container.clients.list()
        .filter((c) => c.rides >= 1 && Date.now() - Date.parse(c.lastSeenAt) > THIRTY_D)
        .slice(0, 50);
      const promo = container.promos.compensation({ percent: 15, days: 7, prefix: 'RETOUR' });
      for (const c of silent) {
        container.notifications.notify(
          { clientId: c.id },
          'Vous nous manquez 💚',
          `Revenez rouler vert : code ${promo.id} (-15 %) valable 7 jours sur votre prochaine course ORION.`,
        );
      }
      const a = container.notifications.broadcast({
        audience: 'clients', channel: 'sms', segment: 'inactifs', author: account.name,
        title: 'Campagne win-back (auto)', body: `Code ${promo.id} envoyé aux clients inactifs depuis 30 jours.`,
        audienceCount: silent.length,
      });
      audit(req, 'notify.trigger', a.id, { trigger: 'winback', sent: silent.length, code: promo.id });
      return { sent: silent.length, code: promo.id, announcement: a };
    });

    // --- Journal d'audit ---
    scoped.get('/admin/audit', async (req) => { require(req, 'audit:read'); return { entries: container.audit.list(200) }; });
  });
}
