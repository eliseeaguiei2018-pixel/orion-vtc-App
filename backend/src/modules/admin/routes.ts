import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { Container } from '../../container.js';
import { parse } from '../../core/validate.js';
import { notFound, unauthorized, forbidden } from '../../core/errors.js';
import { driverRoom } from '../realtime/hub.js';
import { AdminService, paginate } from './service.js';
import { can, resolveAccount, ROLE_PERMISSIONS, ROLE_LABEL, type AdminAccount, type Permission, type Role } from './roles.js';
import {
  authenticate, issueToken, verifyToken, bearerToken,
  lockedFor, recordLoginFailure, clearLoginFailures,
  verifyTotp, registerSession, touchSession, revokeSession, listSessions, isSessionInactive,
} from './auth.js';
import { config } from '../../config/index.js';
import {
  CSRF_COOKIE, CSRF_HEADER, SESSION_COOKIE, cookiesDeConnexion, cookiesDeDeconnexion,
  estEcriture, newCsrfToken, parseCookies,
} from './cookies.js';
import { SOS_PRESETS } from '../safety/service.js';
import { COUPURES, ECART_TOLERE, ORIGINE_LABEL, SORTIE_LABEL, totalComptage, type Comptage } from '../treasury/caisse.js';
import { TYPE_LABEL as CREW_TYPE_LABEL, STATUT_LABEL as CREW_STATUT_LABEL, TYPES_FINANCIERS, PLAFOND_AVANCE, PLAFOND_PRET, MAX_ECHEANCES, type TypeRequete } from '../crew/requests.js';
import { consoleForced, consoleReassigned } from '../driver-app/offers.js';

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
    container.accounts.marquerConnexion(user.username);
    const account = { name: user.name, role: user.role, username: user.username };
    const { token, expiresAt, jti } = issueToken(account);
    registerSession({
      id: jti, username: user.username, name: user.name, role: user.role,
      ip: req.ip, userAgent: (req.headers['user-agent'] as string | undefined)?.slice(0, 120),
      createdAt: new Date().toISOString(), expiresAt,
    });
    container.audit.log({ actor: account.name, role: account.role, action: needs2fa ? 'login.success_2fa' : 'login.success' });
    // Session posée en cookie HttpOnly : la console n'a plus à stocker le jeton,
    // donc une faille XSS ne peut plus l'exfiltrer. Le second cookie, lisible,
    // porte la preuve anti-CSRF à recopier dans l'en-tête sur chaque écriture.
    const csrf = newCsrfToken();
    const dureeSecondes = Math.max(0, Math.round((Date.parse(expiresAt) - Date.now()) / 1000));
    reply.header('set-cookie', cookiesDeConnexion(token, csrf, dureeSecondes));
    return {
      // `token` reste renvoyé pour les clients non navigateur (automatisation,
      // scripts) ; la console, elle, ne le conserve plus.
      csrfToken: csrf,
      token, expiresAt,
      account: {
        name: account.name, role: account.role, roleLabel: ROLE_LABEL[account.role],
        permissions: ROLE_PERMISSIONS[account.role],
        // Mot de passe provisoire non encore remplacé : la console exigera le
        // changement avant de laisser travailler. Un mot de passe dicté au
        // téléphone et jamais changé est un mot de passe partagé.
        mustChangePassword: container.accounts.get(user.username)?.mustChangePassword ?? false,
      },
    };
  });

  /**
   * Déconnexion : efface les cookies et révoque la session côté serveur, pour que
   * le jeton reste inutilisable même s'il avait été copié. Volontairement hors du
   * groupe authentifié — se déconnecter doit marcher même si la session a expiré.
   */
  app.post('/admin/logout', async (req, reply) => {
    const cookies = parseCookies(req.headers['cookie'] as string | undefined);
    const session = verifyToken(cookies[SESSION_COOKIE])
      ?? verifyToken(bearerToken(req.headers['authorization'] as string | undefined));
    if (session?.jti) {
      revokeSession(session.jti);
      container.audit.log({ actor: session.name, role: session.role, action: 'logout' });
    }
    reply.header('set-cookie', cookiesDeDeconnexion());
    return { ok: true };
  });

  await app.register(async (scoped) => {
    const admin = new AdminService(container);

    // Résout le compte : session JWT (Authorization: Bearer) OU jeton statique
    // (x-admin-token, compatibilité/automatisation). 401 si aucun n'est valide.
    scoped.addHook('preHandler', async (req) => {
      // Ordre de résolution : cookie HttpOnly (console) → Bearer (automatisation,
      // app chauffeur) → jeton statique. Le cookie est prioritaire car il est le
      // mode normal du navigateur ; JavaScript ne peut pas le lire.
      const cookies = parseCookies(req.headers['cookie'] as string | undefined);
      const jetonCookie = cookies[SESSION_COOKIE];
      const parCookie = verifyToken(jetonCookie);
      const jwt = bearerToken(req.headers['authorization'] as string | undefined);
      const verified = parCookie ?? verifyToken(jwt);
      const account = verified ?? resolveAccount(req.headers['x-admin-token'] as string | undefined);
      if (!account) throw unauthorized('Session invalide ou expirée');

      // ANTI-CSRF — uniquement quand l'authentification vient du cookie : celui-ci
      // est envoyé automatiquement par le navigateur, y compris depuis un site
      // tiers. L'en-tête doit reprendre la valeur du cookie lisible, qu'un autre
      // site ne peut pas lire. Bearer et jeton statique n'ont pas ce risque :
      // ils ne sont jamais joints automatiquement.
      if (parCookie && estEcriture(req.method)) {
        const attendu = cookies[CSRF_COOKIE];
        const fourni = req.headers[CSRF_HEADER] as string | undefined;
        if (!attendu || !fourni || fourni !== attendu) {
          throw forbidden('Requête rejetée : preuve anti-CSRF absente ou invalide. Recharge la console.');
        }
      }
      // Verrouillage auto après inactivité (écran laissé allumé — sécurité RBAC).
      if (verified?.jti && isSessionInactive(verified.jti)) {
        throw unauthorized('Session verrouillée pour inactivité — reconnecte-toi');
      }
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
      const fiche = account.username ? container.accounts.get(account.username) : undefined;
      return {
        name: account.name,
        role: account.role,
        roleLabel: ROLE_LABEL[account.role],
        permissions: ROLE_PERMISSIONS[account.role],
        username: account.username,
        service: fiche?.service,
        teamId: fiche?.teamId,
        /** Compte chauffeur : la fiche à laquelle il donne accès. */
        driverId: fiche?.driverId,
        mustChangePassword: fiche?.mustChangePassword ?? false,
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
        contactPhone: z.string().min(8).max(20).optional(),
        creditLimit: z.number().min(0).max(1_000_000_000),
        active: z.boolean().optional(),
        // CRM B2B avancé : filiales, NIF, politique de déplacement, rétrocommission.
        nif: z.string().max(40).optional(),
        billingAddress: z.string().max(200).optional(),
        parentId: z.string().max(40).optional(),
        kickbackRate: z.number().min(0).max(0.5).optional(),
        policy: z.object({
          days: z.array(z.number().int().min(0).max(6)).optional(),
          hourStart: z.number().int().min(0).max(23).optional(),
          hourEnd: z.number().int().min(0).max(23).optional(),
          zoneIds: z.array(z.string()).optional(),
          maxTier: z.enum(['bronze', 'argent', 'or', 'diamant']).optional(),
        }).optional(),
      }), req.body);
      const account = container.corporate.upsert(body);
      audit(req, 'corporate.upsert', account.id, { name: account.name, creditLimit: account.creditLimit });
      return { account };
    });

    // Filiales / départements rattachés à une entité mère.
    scoped.get('/admin/corporate/:id/children', async (req) => {
      require(req, 'finance:read');
      const { id } = req.params as { id: string };
      return { children: container.corporate.children(id) };
    });

    // Import de masse des collaborateurs (Excel/CSV → ids clients ORION).
    scoped.post('/admin/corporate/:id/members', async (req) => {
      require(req, 'treasury:request');
      const { id } = req.params as { id: string };
      const body = parse(z.object({ memberIds: z.array(z.string().min(1)).max(5000) }), req.body);
      const result = container.corporate.importMembers(id, body.memberIds);
      if (!result) throw notFound('Compte entreprise introuvable');
      audit(req, 'corporate.import', id, { added: result.added });
      return { account: result.account, added: result.added };
    });

    // Web Booker / conciergerie : le réceptionniste commande une course pour un invité.
    scoped.post('/admin/corporate/:id/book', async (req, reply) => {
      require(req, 'rides:write');
      const { id } = req.params as { id: string };
      const body = parse(z.object({
        guestName: z.string().min(1).max(80),
        origin: z.object({ lat: z.number(), lng: z.number() }),
        destination: z.object({ lat: z.number(), lng: z.number() }),
        category: z.string().min(2).max(20).default('bronze'),
      }), req.body);
      const acc = container.corporate.get(id);
      if (!acc) throw notFound('Compte entreprise introuvable');
      // Politique de déplacement : vérifiée au moment de la commande.
      const zone = container.settings.zoneForPoint(body.origin);
      const denied = container.corporate.checkPolicy(id, { zoneId: zone?.id });
      if (denied) { reply.code(409); return { error: denied }; }
      // Devis serveur puis course imputée à la ligne de crédit société.
      const quote = await container.registry.get('ride').estimate({
        origin: body.origin, destination: body.destination, category: body.category,
      });
      const charged = container.corporate.charge(id, quote.amount);
      if (charged === 'inactive') { reply.code(409); return { error: 'Compte entreprise suspendu' }; }
      if (charged === 'over_limit') { reply.code(409); return { error: 'Ligne de crédit entreprise dépassée' }; }
      const clientId = `guest:${body.guestName}:${Math.random().toString(36).slice(2, 6)}`;
      container.clients.touch(clientId, { name: body.guestName });
      audit(req, 'corporate.book', id, { guest: body.guestName, amount: quote.amount });
      reply.code(201);
      return { booking: { clientId, guestName: body.guestName, amount: quote.amount, currency: quote.currency, shareHint: 'SMS de suivi GPS + plaque envoyé au client' } };
    });

    // Facture consolidée mensuelle (PDF).
    scoped.get('/admin/corporate/:id/invoice.pdf', async (req, reply) => {
      require(req, 'finance:read');
      const { id } = req.params as { id: string };
      const q = parse(z.object({ month: z.string().regex(/^\d{4}-\d{2}$/).optional() }), req.query);
      const month = q.month ?? new Date().toISOString().slice(0, 7);
      const pdf = admin.consolidatedInvoicePdf(id, month);
      if (!pdf) throw notFound('Compte entreprise introuvable');
      reply.header('content-type', 'application/pdf');
      reply.header('content-disposition', `attachment; filename="facture-${id}-${month}.pdf"`);
      return pdf;
    });

    /* ===================== SESSION LITIGES (S11) : N2/N3 ===================== */

    // Escalade + verrou du dossier (claim lock) à un expert.
    scoped.post('/admin/disputes/:id/escalate', async (req, reply) => {
      require(req, 'support:write');
      const { id } = req.params as { id: string };
      const body = parse(z.object({ kind: z.enum(['sinistre', 'chargeback', 'harcelement', 'degradation']) }), req.body);
      const { admin: account } = req as FastifyRequest & { admin: AdminAccount };
      const result = container.disputes.escalate(id, body.kind, account.name);
      if (!result) throw notFound('Litige introuvable');
      if (result === 'locked') { reply.code(409); return { error: 'Dossier déjà verrouillé par un autre expert (claim lock).' }; }
      audit(req, 'dispute.escalate', id, { kind: body.kind });
      return { dispute: result };
    });

    // Mise en quarantaine préventive : gel des comptes/fonds le temps de l'investigation.
    scoped.post('/admin/disputes/:id/quarantine', async (req) => {
      require(req, 'support:write');
      const { id } = req.params as { id: string };
      const body = parse(z.object({ on: z.boolean() }), req.body);
      const dispute = container.disputes.setQuarantine(id, body.on);
      if (!dispute) throw notFound('Litige introuvable');
      const ride = container.rides.get(dispute.rideId);
      // Gel/dégel du wallet chauffeur (retraits bloqués) + suspension préventive.
      if (ride?.driverId) {
        if (body.on) { container.wallet.freeze(ride.driverId); const d = container.drivers.get(ride.driverId); if (d) { d.kycStatus = 'suspended'; void container.drivers.goOffline(ride.driverId); container.drivers.persist(ride.driverId); } }
        else { container.wallet.unfreeze(ride.driverId); }
      }
      // Gel/dégel du portefeuille client (remboursements/retraits).
      if (body.on) container.clientWallet.freeze(dispute.clientId); else container.clientWallet.unfreeze(dispute.clientId);
      audit(req, 'dispute.quarantine', id, { on: body.on });
      return { dispute, frozen: body.on };
    });

    // Note d'investigation (réservée à l'expert gestionnaire).
    scoped.post('/admin/disputes/:id/note', async (req, reply) => {
      require(req, 'support:write');
      const { id } = req.params as { id: string };
      const body = parse(z.object({ text: z.string().min(2).max(1000) }), req.body);
      const { admin: account } = req as FastifyRequest & { admin: AdminAccount };
      const existing = container.disputes.get(id);
      if (!existing) throw notFound('Litige introuvable');
      if (existing.lockedBy && existing.lockedBy !== account.name) {
        reply.code(403); return { error: 'Dossier verrouillé par un autre expert.' };
      }
      const dispute = container.disputes.addNote(id, account.name, body.text);
      return { dispute };
    });

    // Garages partenaires agréés (dont habilitation électrique).
    scoped.get('/admin/garages', async (req) => { require(req, 'support:read'); const { GARAGES } = await import('./service.js'); return { garages: GARAGES }; });

    // Indemnisation perte d'exploitation d'un véhicule immobilisé.
    scoped.get('/admin/drivers/:id/loss-of-use', async (req) => {
      require(req, 'support:read');
      const { id } = req.params as { id: string };
      if (!container.drivers.get(id)) throw notFound('Chauffeur introuvable');
      return { lossOfUse: admin.lossOfUse(id) };
    });

    // Dossier de contestation bancaire (chargeback) — Evidence Package PDF.
    scoped.get('/admin/disputes/:id/chargeback.pdf', async (req, reply) => {
      require(req, 'support:read');
      const { id } = req.params as { id: string };
      const pdf = admin.chargebackPackPdf(id);
      if (!pdf) throw notFound('Litige introuvable');
      reply.header('content-type', 'application/pdf');
      reply.header('content-disposition', `attachment; filename="orion-chargeback-${id}.pdf"`);
      return pdf;
    });

    // Dossier d'instruction légal complet (PDF).
    scoped.get('/admin/disputes/:id/dossier.pdf', async (req, reply) => {
      require(req, 'support:read');
      const { id } = req.params as { id: string };
      const pdf = admin.legalDossierPdf(id);
      if (!pdf) throw notFound('Litige introuvable');
      reply.header('content-type', 'application/pdf');
      reply.header('content-disposition', `attachment; filename="orion-dossier-${id}.pdf"`);
      return pdf;
    });

    // Matrice financière des pertes (Excel/CSV) — shrinkage rate.
    scoped.get('/admin/disputes.csv', async (req, reply) => {
      require(req, 'support:read');
      reply.header('content-type', 'text/csv; charset=utf-8');
      reply.header('content-disposition', 'attachment; filename="orion-pertes.csv"');
      return admin.lossMatrixCsv();
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
    /**
     * Qui est derrière une alerte. La file de triage n'affichait que l'identifiant
     * technique tronqué — « usager client-bro » — et l'agent SAMU ne pouvait ni nommer
     * la personne, ni l'appeler sans ouvrir le dossier. Une seconde compte, ici.
     */
    const usagerDeAlerte = (userId: string) => {
      const client = container.clients.get(userId);
      if (client) return { userName: client.name ?? null, userPhone: client.phone ?? null, userKind: 'client' as const };
      const driver = container.drivers.get(userId);
      if (driver) return { userName: driver.name, userPhone: driver.phone ?? null, userKind: 'chauffeur' as const };
      return { userName: null, userPhone: null, userKind: 'inconnu' as const };
    };

    scoped.get('/admin/alerts', async (req) => {
      require(req, 'alerts:read');
      return { alerts: container.safety.list().map((a) => ({ ...a, ...usagerDeAlerte(a.userId) })) };
    });

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
        ...usagerDeAlerte(a.userId),
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
        /**
         * POSTE DE CONTACT. Le répertoire éditable, plus les numéros propres au
         * dossier (chauffeur, passager, contact de confiance) : l'opérateur joint
         * qui il veut depuis l'écran, sans recopier un numéro à la main.
         */
        contacts: [
          ...container.contacts.actifs().map((c) => ({
            id: c.id, label: c.label, numero: c.numero, categorie: c.categorie, note: c.note ?? null,
          })),
          ...(driver?.phone ? [{ id: 'chauffeur', label: `Chauffeur — ${driver.name}`, numero: driver.phone, categorie: 'course' as const, note: driver.matricule }] : []),
          ...(client?.phone ? [{ id: 'passager', label: `Passager — ${client.name ?? client.id}`, numero: client.phone, categorie: 'course' as const, note: null }] : []),
          ...(ride?.trustedContact ? [{ id: 'contact_confiance', label: `Contact de confiance — ${ride.trustedContact.name}`, numero: ride.trustedContact.phone, categorie: 'course' as const, note: 'Désigné par le passager' }] : []),
        ],
        /** Tout ce qui a déjà été tenté sur ce dossier : qui, quand, par quel canal. */
        journalContacts: container.contacts.pourAlerte(id),
      };
    });

    /**
     * MISE EN RELATION depuis le poste SAMU.
     *
     * Consigne la tentative AVANT la composition : même un appel qui échoue doit
     * laisser une trace, c'est la pièce qu'on produit à l'assureur ou au juge. Le
     * serveur renvoie le lien que le combiné de l'opérateur ouvre.
     */
    scoped.post('/admin/sos/:id/contact', async (req) => {
      require(req, 'alerts:write');
      const { id } = req.params as { id: string };
      const alert = container.safety.get(id);
      if (!alert) throw notFound('Alerte introuvable');
      assertSealedAccess(req, alert.sealed);
      const body = parse(
        z.object({
          canal: z.enum(['appel', 'sms', 'whatsapp']),
          contactId: z.string().max(60).optional(),
          numero: z.string().max(30).optional(),
          label: z.string().max(80).optional(),
          message: z.string().max(400).optional(),
        }),
        req.body,
      );
      const { admin: account } = req as FastifyRequest & { admin: AdminAccount };
      const { entry, lien } = container.contacts.consigner({ dossierType: 'sos', dossierId: id, agent: account.name, ...body });
      // Le dossier d'alerte garde la trace du service prévenu (réquisition PDF).
      if (!alert.dispatchedTo.includes(entry.label)) alert.dispatchedTo.push(entry.label);
      audit(req, 'sos.contact', id, { cible: entry.label, canal: entry.canal, numero: entry.numero });
      // La supervision voit en direct qui est en train d'être joint.
      container.realtime.publish('emergency', 'sos.contact', { alertId: id, label: entry.label, canal: entry.canal, agent: account.name });
      return { entry, lien, journal: container.contacts.pourAlerte(id) };
    });

    /** Issue de l'appel : joint, messagerie, injoignable — avec compte rendu. */
    scoped.post('/admin/sos/:id/contact/:entryId', async (req) => {
      require(req, 'alerts:write');
      const { id, entryId } = req.params as { id: string; entryId: string };
      const body = parse(
        z.object({
          issue: z.enum(['tentative', 'joint', 'non_joint', 'messagerie']),
          compteRendu: z.string().max(400).optional(),
        }),
        req.body,
      );
      const entry = container.contacts.conclure(entryId, body.issue, body.compteRendu);
      audit(req, 'sos.contact.issue', id, { entryId, issue: body.issue });
      return { entry, journal: container.contacts.pourAlerte(id) };
    });

    /* ============ MISE EN RELATION DEPUIS TOUTE LA CONSOLE ============ */

    /**
     * Joindre quelqu'un depuis n'importe quelle session — un client au support, un
     * chauffeur en litige, l'organisateur d'une location, un contact du répertoire.
     *
     * Le besoin n'était pas propre au poste SOS : partout, l'employé lisait un numéro
     * à l'écran et composait à la main, sans trace. Une seule route, un seul registre.
     */
    scoped.post('/admin/contact', async (req) => {
      // Le droit requis dépend de qui l'on appelle : on ne contacte pas un chauffeur
      // sans droit sur les chauffeurs, ni un client sans droit sur les clients.
      const body = parse(
        z.object({
          dossierType: z.enum(['sos', 'course', 'client', 'chauffeur', 'support', 'location', 'entreprise']),
          dossierId: z.string().min(1).max(80),
          canal: z.enum(['appel', 'sms', 'whatsapp']),
          contactId: z.string().max(60).optional(),
          numero: z.string().max(30).optional(),
          label: z.string().max(80).optional(),
          message: z.string().max(400).optional(),
        }),
        req.body,
      );
      const DROIT: Record<string, Permission> = {
        sos: 'alerts:write', course: 'rides:read', client: 'clients:read',
        chauffeur: 'drivers:read', support: 'support:write', location: 'rental:read',
        entreprise: 'finance:read',
      };
      require(req, DROIT[body.dossierType]!);
      const { admin: account } = req as FastifyRequest & { admin: AdminAccount };
      const { entry, lien } = container.contacts.consigner({ agent: account.name, ...body });
      audit(req, 'contact', body.dossierId, { type: body.dossierType, cible: entry.label, canal: entry.canal });
      return { entry, lien, journal: container.contacts.pourDossier(body.dossierType, body.dossierId) };
    });

    /** Issue de l'appel (joint, messagerie, injoignable) + compte rendu. */
    scoped.post('/admin/contact/:entryId/issue', async (req) => {
      require(req, 'overview:read');
      const { entryId } = req.params as { entryId: string };
      const body = parse(
        z.object({
          issue: z.enum(['tentative', 'joint', 'non_joint', 'messagerie']),
          compteRendu: z.string().max(400).optional(),
        }),
        req.body,
      );
      const entry = container.contacts.conclure(entryId, body.issue, body.compteRendu);
      audit(req, 'contact.issue', entry.dossierId, { issue: body.issue });
      return { entry };
    });

    /** Registre d'un dossier : ce qui a déjà été tenté, par qui, avec quelle issue. */
    scoped.get('/admin/contact/journal', async (req) => {
      require(req, 'overview:read');
      const q = parse(
        z.object({
          dossierType: z.enum(['sos', 'course', 'client', 'chauffeur', 'support', 'location', 'entreprise']),
          dossierId: z.string().min(1).max(80),
        }),
        req.query,
      );
      return { journal: container.contacts.pourDossier(q.dossierType, q.dossierId), contacts: container.contacts.actifs() };
    });

    /* --------------------- Répertoire d'urgence (éditable) --------------------- */

    scoped.get('/admin/contacts', async (req) => {
      require(req, 'alerts:read');
      return { contacts: container.contacts.list(), journal: container.contacts.tout(100) };
    });

    scoped.put('/admin/contacts', async (req) => {
      require(req, 'alerts:write');
      const body = parse(
        z.object({
          id: z.string().max(60).optional(),
          label: z.string().min(2).max(80),
          numero: z.string().min(3).max(30),
          categorie: z.enum(['secours', 'interne', 'partenaire']).optional(),
          ordre: z.number().int().min(0).max(999).optional(),
          actif: z.boolean().optional(),
          note: z.string().max(120).optional(),
        }),
        req.body,
      );
      const contact = container.contacts.upsert(body);
      audit(req, 'contacts.upsert', contact.id, { label: contact.label, numero: contact.numero });
      return { contact, contacts: container.contacts.list() };
    });

    scoped.delete('/admin/contacts/:id', async (req) => {
      require(req, 'alerts:write');
      const { id } = req.params as { id: string };
      container.contacts.remove(id);
      audit(req, 'contacts.delete', id);
      return { contacts: container.contacts.list() };
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
          // Frais annexes & pénalités (session Tarification).
          freeWaitMinutes: z.number().min(0).max(30).optional(),
          cancelGraceMinutes: z.number().min(0).max(30).optional(),
          cancelFee: z.number().min(0).max(50_000).optional(),
          cleaningLight: z.number().min(0).max(100_000).optional(),
          cleaningMajor: z.number().min(0).max(500_000).optional(),
          longPickupPerKm: z.number().min(0).max(2000).optional(),
          longPickupThresholdKm: z.number().min(0).max(50).optional(),
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
        // Zones & tarifs (session 17) : forfaits A→B, retour à vide, plancher premium.
        flatRates: z.array(z.object({ toZoneId: z.string().min(1).max(40), price: z.number().min(0).max(1_000_000) })).max(50).optional(),
        emptyReturnFee: z.number().min(0).max(100_000).optional(),
        premiumFloor: z.number().min(0).max(100_000).optional(),
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
        // Finances : plafond dette espèces + commissions par gamme + fidélité.
        cashDebtLimit: z.number().min(0).max(1_000_000).optional(),
        commissionStandard: z.number().min(0).max(0.5).optional(),
        commissionGreen: z.number().min(0).max(0.5).optional(),
        loyaltyRideThreshold: z.number().int().min(0).max(100_000).optional(),
        commissionLoyalty: z.number().min(0).max(0.5).optional(),
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

    // Shadow pricing : simule une nouvelle grille sur les courses passées (sans impact).
    scoped.post('/admin/pricing/shadow', async (req) => {
      require(req, 'pricing:read');
      const body = parse(z.object({
        baseFactor: z.number().min(0.1).max(5).optional(),
        perKmFactor: z.number().min(0.1).max(5).optional(),
      }), req.body ?? {});
      return admin.shadowPricing(body);
    });

    // Matrice tarifaire PAR ZONE (forfaits A→B + règles géographiques) CSV.
    scoped.get('/admin/zones/matrix.csv', async (req, reply) => {
      require(req, 'pricing:read');
      reply.header('content-type', 'text/csv; charset=utf-8');
      reply.header('content-disposition', 'attachment; filename="orion-matrice-zones.csv"');
      return admin.zoneMatrixCsv();
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
      // App chauffeur synchronisée : retrait chez l'ancien, offre chez le nouveau.
      consoleReassigned(container, ride, previous);
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
      // Client et chauffeur prévenus en direct (course débloquée).
      consoleForced(container, ride);
      audit(req, `ride.force_${body.action}`, id);
      return { ride: { id: ride.id, status: ride.status } };
    });

    // Barème de nettoyage / dégradation appliqué à une course (crédité au chauffeur).
    scoped.post('/admin/rides/:id/cleaning', async (req) => {
      require(req, 'support:write');
      const { id } = req.params as { id: string };
      const body = parse(z.object({ level: z.enum(['light', 'major']) }), req.body);
      const ride = container.rides.get(id);
      if (!ride) throw notFound('Course introuvable');
      const pr = container.settings.getPricing();
      const amount = body.level === 'major' ? pr.cleaningMajor : pr.cleaningLight;
      if (ride.driverId) container.wallet.credit(ride.driverId, amount, 'adjustment', `Frais de nettoyage (${body.level})`, ride.id);
      ride.events.push({ type: 'cleaning_fee', at: new Date().toISOString(), payload: { level: body.level, amount } });
      container.rides.persist(ride);
      audit(req, 'ride.cleaning', id, { level: body.level, amount });
      return { amount, level: body.level };
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
        /** Mission de l'équipe : ce dont elle répond (maintenance, zone, grands comptes…). */
        mission: z.string().max(200).optional(),
        driverIds: z.array(z.string()).max(500).optional(),
      }), req.body);
      const { admin: account } = req as FastifyRequest & { admin: AdminAccount };
      // Le chef d'équipe monte SON équipe — c'est lui qui la crée, comme demandé —
      // mais il ne crée ni ne reprend celle d'un autre : une équipe qu'on peut
      // s'attribuer n'est plus une ligne hiérarchique.
      if (account.role === 'manager') {
        if (body.managerUsername !== account.username) {
          throw forbidden('Un chef d’équipe ne crée que ses propres équipes.');
        }
        if (body.id) {
          const existante = container.teams.get(body.id);
          if (existante && existante.managerUsername !== account.username) {
            throw forbidden('Cette équipe est dirigée par un autre chef d’équipe.');
          }
        }
      }
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

    /* ===================== SESSION ÉQUIPES (S8) : RH & squads ===================== */

    // Productivité interne (KPIs employés dérivés du journal d'audit).
    scoped.get('/admin/staff/productivity', async (req) => { require(req, 'teams:read'); return { staff: admin.staffProductivity() }; });

    // Anomalies de comportement du personnel → signalées à la direction (fraude interne).
    scoped.get('/admin/staff/anomalies', async (req) => {
      require(req, 'security:read');
      const anomalies = admin.staffAnomalies();
      for (const a of anomalies) {
        container.security.record({ name: a.actor, role: 'viewer', section: 'comportement anormal', path: a.reason });
      }
      return { anomalies };
    });

    // Planning des astreintes 24/7 + affectation territoriale.
    scoped.get('/admin/shifts', async (req) => {
      require(req, 'teams:read');
      const q = parse(z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional() }), req.query);
      return { shifts: container.staff.listShifts(q.date) };
    });

    scoped.put('/admin/shifts', async (req) => {
      require(req, 'teams:write');
      const body = parse(z.object({
        username: z.string().min(1).max(80), name: z.string().min(1).max(80),
        date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), slot: z.enum(['matin', 'soir', 'nuit']),
        zoneId: z.string().max(40).optional(),
      }), req.body);
      const shift = container.staff.assignShift(body);
      audit(req, 'shift.assign', shift.id, { username: body.username, slot: body.slot });
      return { shift };
    });

    scoped.delete('/admin/shifts/:id', async (req) => {
      require(req, 'teams:write');
      const { id } = req.params as { id: string };
      container.staff.removeShift(id);
      audit(req, 'shift.remove', id);
      return { ok: true };
    });

    // Matrice des heures (Excel/CSV) — OPEX salarial.
    scoped.get('/admin/staff/hours.csv', async (req, reply) => {
      require(req, 'teams:read');
      reply.header('content-type', 'text/csv; charset=utf-8');
      reply.header('content-disposition', 'attachment; filename="orion-heures.csv"');
      return admin.staffHoursCsv(container.staff.listShifts());
    });

    // Fiche d'évaluation employé (PDF).
    scoped.get('/admin/staff/:username/eval.pdf', async (req, reply) => {
      require(req, 'teams:read');
      const { username } = req.params as { username: string };
      reply.header('content-type', 'application/pdf');
      reply.header('content-disposition', `attachment; filename="orion-eval-${username}.pdf"`);
      return admin.staffEvalPdf(username);
    });

    // Tickets de maintenance des véhicules (cycle de vie du matériel).
    scoped.get('/admin/maintenance', async (req) => {
      require(req, 'teams:read');
      const q = parse(z.object({ teamId: z.string().optional() }), req.query);
      return { tickets: container.staff.listTickets(q.teamId) };
    });

    scoped.post('/admin/maintenance', async (req) => {
      require(req, 'teams:write');
      const body = parse(z.object({
        driverId: z.string().min(1), teamId: z.string().optional(),
        kind: z.enum(['controle_technique', 'batterie_soh', 'reparation', 'nettoyage', 'assurance']),
        title: z.string().min(3).max(160), dueDate: z.string().optional(),
      }), req.body);
      const ticket = container.staff.openTicket(body);
      audit(req, 'maintenance.open', ticket.id, { driverId: body.driverId, kind: body.kind });
      return { ticket };
    });

    scoped.post('/admin/maintenance/:id/assign', async (req) => {
      require(req, 'teams:write');
      const { id } = req.params as { id: string };
      const body = parse(z.object({ assignee: z.string().min(1).max(80) }), req.body);
      const ticket = container.staff.assignTicket(id, body.assignee);
      if (!ticket) throw notFound('Ticket introuvable');
      audit(req, 'maintenance.assign', id, { assignee: body.assignee });
      return { ticket };
    });

    scoped.post('/admin/maintenance/:id/resolve', async (req) => {
      require(req, 'teams:write');
      const { id } = req.params as { id: string };
      const ticket = container.staff.resolveTicket(id);
      if (!ticket) throw notFound('Ticket introuvable');
      audit(req, 'maintenance.resolve', id);
      return { ticket };
    });

    // Micro P&L d'une squad (rentabilité de la sous-flotte confiée au manager).
    scoped.get('/admin/teams/:id/pnl', async (req) => {
      require(req, 'teams:read');
      const { id } = req.params as { id: string };
      const team = container.teams.get(id);
      if (!team) throw notFound('Équipe introuvable');
      const { admin: account } = req as FastifyRequest & { admin: AdminAccount };
      if (account.role === 'manager' && team.managerUsername !== account.username) {
        throw forbidden('Chef d’équipe : accès limité à votre squad');
      }
      return { pnl: admin.squadPnl(team.driverIds), team: { id: team.id, name: team.name } };
    });

    // Chat interne d'équipe (manager ↔ agents).
    scoped.get('/admin/teams/:id/chat', async (req) => {
      require(req, 'teams:read');
      const { id } = req.params as { id: string };
      return { messages: container.staff.listChat(id) };
    });

    scoped.post('/admin/teams/:id/chat', async (req) => {
      require(req, 'teams:read');
      const { id } = req.params as { id: string };
      const body = parse(z.object({ text: z.string().min(1).max(1000) }), req.body);
      const { admin: account } = req as FastifyRequest & { admin: AdminAccount };
      const message = container.staff.postChat(id, account.name, body.text);
      return { message };
    });

    // Micro-broadcast : notification CIBLÉE à la seule flotte du manager.
    scoped.post('/admin/teams/:id/broadcast', async (req) => {
      require(req, 'teams:write');
      const { id } = req.params as { id: string };
      const body = parse(z.object({ title: z.string().min(1).max(120), body: z.string().min(1).max(500) }), req.body);
      const team = container.teams.get(id);
      if (!team) throw notFound('Équipe introuvable');
      const { admin: account } = req as FastifyRequest & { admin: AdminAccount };
      if (account.role === 'manager' && team.managerUsername !== account.username) {
        throw forbidden('Chef d’équipe : diffusion limitée à votre flotte');
      }
      for (const driverId of team.driverIds) {
        container.notifications.notify({ driverId }, body.title, body.body);
      }
      audit(req, 'team.broadcast', id, { fleet: team.driverIds.length });
      return { sent: team.driverIds.length };
    });

    /* ===================== SESSION IA (S9) ===================== */

    // Moteur anti-fraude : ghost rides, spoofing GPS, risque transactionnel.
    scoped.get('/admin/fraud', async (req) => { require(req, 'rides:read'); return admin.fraudSignals(); });

    // Élasticité-prix : multiplicateur recommandé par cellule (surge neural).
    scoped.get('/admin/elasticity', async (req) => { require(req, 'rides:read'); return { cells: admin.elasticity() }; });

    // Assistant ORION : synthèse de litige + questions sur les données réelles.
    scoped.get('/admin/disputes/:id/summary', async (req) => {
      require(req, 'support:read');
      const { id } = req.params as { id: string };
      const summary = admin.copilotSummary(id);
      if (summary === null) throw notFound('Litige introuvable');
      return { summary };
    });

    // L'assistant lit les modules réels et répond en français. Aucun modèle de langage
    // n'intervient : brancher un vrai assistant conversationnel demanderait une clé d'API
    // externe, et se ferait derrière cette même route sans rien changer à la console.
    scoped.post('/admin/copilot', async (req) => {
      require(req, 'overview:read');
      const body = parse(z.object({ q: z.string().min(2).max(200) }), req.body);
      const r = await container.assistant.repondre(body.q);
      // `query`/`answer` conservés : l'app console et les tests existants s'y appuient.
      return { query: r.question, answer: r.reponse, data: r.data, sources: r.sources, incompris: r.incompris === true };
    });

    /** Ce que l'assistant sait répondre — affiché dans la console comme aide de saisie. */
    scoped.get('/admin/copilot/sujets', async (req) => {
      require(req, 'overview:read');
      return { sujets: container.assistant.sujets() };
    });

    // --- Gestion chauffeurs (actions) ---
    scoped.post('/admin/drivers/:id/kyc', async (req, reply) => {
      require(req, 'drivers:write');
      const { id } = req.params as { id: string };
      assertManagerScope(req, id);
      const body = parse(z.object({
        status: z.enum(['draft', 'docs_submitted', 'manual_review', 'approved', 'active', 'suspended']),
        reason: z.string().max(200).optional(),
      }), req.body);
      const d = container.drivers.get(id);
      if (!d) throw notFound('Chauffeur introuvable');
      // Motif OBLIGATOIRE à la suspension (trace légale).
      if (body.status === 'suspended' && !body.reason?.trim()) {
        reply.code(400);
        return { error: 'Motif de suspension obligatoire (trace légale).' };
      }
      d.kycStatus = body.status;
      if (body.status === 'suspended') { d.suspensionReason = body.reason!.trim(); void container.drivers.goOffline(id); }
      else if (body.status === 'active') d.suspensionReason = undefined;
      container.drivers.persist(id);
      audit(req, 'driver.kyc', id, { status: body.status, reason: body.reason });
      return { driver: { id: d.id, kycStatus: d.kycStatus, availability: d.availability, suspensionReason: d.suspensionReason ?? null } };
    });

    // Documents expirant sous 30 jours (assurance / contrôle technique).
    scoped.get('/admin/drivers/expiring', async (req) => {
      require(req, 'drivers:read');
      return { drivers: admin.driverExpiring() };
    });

    // Fidélité : commission réduite (rétention des meilleurs chauffeurs électriques).
    scoped.post('/admin/drivers/:id/loyalty', async (req) => {
      require(req, 'drivers:write');
      const { id } = req.params as { id: string };
      const body = parse(z.object({
        loyaltyTier: z.enum(['bronze', 'silver', 'gold']).optional(),
        commissionOverride: z.number().min(0).max(0.5).nullable().optional(),
      }), req.body);
      const d = container.drivers.get(id);
      if (!d) throw notFound('Chauffeur introuvable');
      if (body.loyaltyTier) d.loyaltyTier = body.loyaltyTier;
      if (body.commissionOverride !== undefined) d.commissionOverride = body.commissionOverride ?? undefined;
      container.drivers.persist(id);
      audit(req, 'driver.loyalty', id, { tier: body.loyaltyTier, commission: body.commissionOverride });
      return { driver: { id: d.id, loyaltyTier: d.loyaltyTier ?? null, commissionOverride: d.commissionOverride ?? null } };
    });

    // Contrat de partenariat PDF.
    scoped.get('/admin/drivers/:id/contract.pdf', async (req, reply) => {
      require(req, 'drivers:read');
      const { id } = req.params as { id: string };
      const pdf = admin.driverContractPdf(id);
      if (!pdf) throw notFound('Chauffeur introuvable');
      reply.header('content-type', 'application/pdf');
      reply.header('content-disposition', `attachment; filename="orion-contrat-${id.slice(0, 8)}.pdf"`);
      return pdf;
    });

    // Matrice de la flotte (Excel/CSV).
    scoped.get('/admin/fleet.csv', async (req, reply) => {
      require(req, 'drivers:read');
      reply.header('content-type', 'text/csv; charset=utf-8');
      reply.header('content-disposition', 'attachment; filename="orion-flotte.csv"');
      return admin.fleetMatrixCsv();
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

    // Statut VIP + verrou no-surge (jamais de majoration + priorité dispatch).
    scoped.post('/admin/clients/:id/vip', async (req) => {
      require(req, 'clients:write');
      const { id } = req.params as { id: string };
      const body = parse(z.object({ vipTier: z.enum(['standard', 'gold', 'platinum']).optional(), noSurgeLock: z.boolean().optional() }), req.body);
      const c = container.clients.touch(id);
      if (body.vipTier) c.vipTier = body.vipTier;
      if (body.noSurgeLock !== undefined) c.noSurgeLock = body.noSurgeLock;
      container.clients.persist(id);
      audit(req, 'client.vip', id, { vipTier: c.vipTier, noSurgeLock: c.noSurgeLock });
      return { client: { id, vipTier: c.vipTier ?? 'standard', noSurgeLock: c.noSurgeLock ?? false } };
    });

    // Liste noire : bloque le compte + IMEI/e-mail/téléphone (anti-réinscription).
    scoped.post('/admin/clients/:id/blacklist', async (req) => {
      require(req, 'clients:write');
      const { id } = req.params as { id: string };
      const body = parse(z.object({ imei: z.string().max(40).optional(), reason: z.string().max(200).optional() }), req.body);
      const c = container.clients.touch(id);
      c.status = 'blocked';
      if (body.imei) c.blacklistedImei = body.imei;
      container.clients.persist(id);
      audit(req, 'client.blacklist', id, { imei: body.imei, reason: body.reason });
      return { client: { id, status: c.status, blacklistedImei: c.blacklistedImei ?? null } };
    });

    // Frais de no-show : annulation après arrivée du chauffeur (vérifiable GPS).
    scoped.post('/admin/clients/:id/noshow', async (req) => {
      require(req, 'clients:write');
      const { id } = req.params as { id: string };
      const body = parse(z.object({ fee: z.number().min(0).max(50_000), cancel: z.boolean().optional() }), req.body);
      const c = container.clients.touch(id);
      c.noShowFees = body.cancel ? 0 : (c.noShowFees ?? 0) + Math.round(body.fee);
      container.clients.persist(id);
      audit(req, body.cancel ? 'client.noshow_cancel' : 'client.noshow_charge', id, { fee: body.fee });
      return { client: { id, noShowFees: c.noShowFees } };
    });

    // Matrice d'acquisition (LTV/CAC) CSV + rapport comportement PDF.
    scoped.get('/admin/clients.csv', async (req, reply) => {
      require(req, 'clients:read');
      reply.header('content-type', 'text/csv; charset=utf-8');
      reply.header('content-disposition', 'attachment; filename="orion-clients-ltv.csv"');
      return admin.clientLtvCsv();
    });

    scoped.get('/admin/clients/behavior.pdf', async (req, reply) => {
      require(req, 'clients:read');
      reply.header('content-type', 'application/pdf');
      reply.header('content-disposition', 'attachment; filename="orion-comportement-clients.pdf"');
      return admin.clientBehaviorPdf();
    });

    /* ===================== SESSION FINANCES (S14) ===================== */

    // Recouvrement : chauffeurs dont la dette espèces dépasse le plafond.
    scoped.get('/admin/finance/cash-debt', async (req) => { require(req, 'finance:read'); return { debtors: admin.cashDebt() }; });

    // Monitoring des passerelles de paiement.
    scoped.get('/admin/finance/gateways', async (req) => { require(req, 'finance:read'); return { gateways: admin.gatewaysStatus() }; });

    scoped.post('/admin/finance/gateways', async (req) => {
      require(req, 'services:write');
      const body = parse(z.object({ method: z.string().min(2).max(20), enabled: z.boolean() }), req.body);
      const config = container.settings.updateServices({ gateways: { [body.method]: body.enabled } });
      audit(req, 'gateway.toggle', body.method, { enabled: body.enabled });
      return { gateways: config.gateways };
    });

    // Fichier de virement de masse (payouts chauffeurs).
    scoped.get('/admin/payouts.csv', async (req, reply) => {
      require(req, 'finance:read');
      reply.header('content-type', 'text/csv; charset=utf-8');
      reply.header('content-disposition', 'attachment; filename="orion-payouts.csv"');
      return admin.payoutsCsv();
    });

    /* ---- Notes de frais & avances (self-service + validation CFO) ---- */
    // File d'attente (CFO) ou mes tickets (self-service, filtré par requesterId).
    scoped.get('/admin/expenses', async (req) => {
      require(req, 'finance:read');
      const q = parse(z.object({ requesterId: z.string().optional() }), req.query);
      container.expenses.enforceDeadlines(); // gèle les tickets en retard de justificatif
      return { tickets: container.expenses.list(q.requesterId ? { requesterId: q.requesterId } : undefined), pending: container.expenses.pendingCount() };
    });

    // Ouvrir un ticket de financement (accès employé/chauffeur — perm de base).
    scoped.post('/admin/expenses', async (req, reply) => {
      require(req, 'overview:read');
      const { admin: account } = req as FastifyRequest & { admin: AdminAccount };
      const body = parse(z.object({
        requesterType: z.enum(['employee', 'driver']).default('employee'),
        requesterId: z.string().min(1).max(80).optional(),
        amount: z.number().positive().max(10_000_000),
        category: z.enum(['marketing', 'recharge', 'deplacement', 'materiel', 'autre']),
        neededDate: z.string(),
        description: z.string().min(3).max(500),
      }), req.body);
      const requesterId = body.requesterId ?? account.username ?? account.name;
      const ticket = container.expenses.request({ ...body, requesterId, requesterName: account.name });
      if (ticket === 'blocked') { reply.code(403); return { error: 'Compte gelé : justificatif(s) en retard. Régularisez avant toute nouvelle demande.' }; }
      audit(req, 'expense.request', ticket.id, { amount: ticket.amount, category: ticket.category });
      reply.code(201);
      return { ticket };
    });

    // Décision du CFO : approuver (crédit instantané) / rejeter / demander un complément.
    scoped.post('/admin/expenses/:id/decide', async (req) => {
      require(req, 'treasury:request'); // niveau finance dirigeante (CFO)
      const { id } = req.params as { id: string };
      const body = parse(z.object({ decision: z.enum(['approve', 'reject', 'info']), note: z.string().max(300).optional() }), req.body);
      const { admin: account } = req as FastifyRequest & { admin: AdminAccount };
      const ticket = container.expenses.decide(id, body.decision, account.name, body.note);
      if (!ticket) throw notFound('Ticket introuvable');
      audit(req, `expense.${body.decision}`, id, { amount: ticket.amount });
      return { ticket };
    });

    // Cash-out : le demandeur transfère l'avance vers le monde réel.
    scoped.post('/admin/expenses/:id/cashout', async (req, reply) => {
      require(req, 'overview:read');
      const { id } = req.params as { id: string };
      const body = parse(z.object({ channel: z.enum(['wave', 'orange_money', 'mtn_momo', 'moov_money', 'bank', 'card']) }), req.body);
      const result = container.expenses.cashOut(id, body.channel);
      if (!result) throw notFound('Ticket introuvable');
      if (result === 'not_approved') { reply.code(409); return { error: 'Ticket non approuvé' }; }
      if (result === 'no_funds') { reply.code(409); return { error: 'Fonds insuffisants sur le portefeuille' }; }
      audit(req, 'expense.cashout', id, { channel: body.channel });
      return { ticket: result };
    });

    // Soumission du justificatif (OCR) → concordance + restitution du reliquat.
    scoped.post('/admin/expenses/:id/receipt', async (req) => {
      require(req, 'overview:read');
      const { id } = req.params as { id: string };
      const body = parse(z.object({ spentAmount: z.number().min(0).max(10_000_000) }), req.body);
      const ticket = container.expenses.submitReceipt(id, body.spentAmount);
      if (!ticket) throw notFound('Ticket introuvable');
      audit(req, 'expense.receipt', id, { spent: body.spentAmount, refunded: ticket.refunded });
      return { ticket };
    });

    /* ===================== SESSION TRÉSORERIE (S15) ===================== */

    // Tour de contrôle liquidité : ratio de couverture séquestre, burn rate, runway.
    scoped.get('/admin/liquidity', async (req) => { require(req, 'treasury:read'); return admin.liquidity(); });

    // Amortissement de la flotte électrique en propre (CAPEX).
    scoped.get('/admin/treasury/amortization', async (req) => { require(req, 'treasury:read'); return admin.fleetAmortization(); });

    // Reporting exécutif de trésorerie (PDF investisseurs / conseil).
    scoped.get('/admin/treasury/report.pdf', async (req, reply) => {
      require(req, 'treasury:read');
      reply.header('content-type', 'application/pdf');
      reply.header('content-disposition', 'attachment; filename="orion-tresorerie-executif.pdf"');
      return admin.treasuryReportPdf();
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

    /* ============================ MON POSTE ============================ */

    /**
     * La journée de travail de l'employé connecté. La console est organisée par
     * sujet — logique pour la plateforme, inutilisable pour la personne : il fallait
     * ouvrir dix sessions pour découvrir ce qui vous attendait. Cette vue est
     * organisée par personne et n'exige aucun droit particulier : chacun y voit ce
     * qui porte SON nom, et uniquement ce que ses droits lui permettent de traiter.
     */
    scoped.get('/admin/mon-poste', async (req) => {
      require(req, 'overview:read');
      const { admin: account } = req as FastifyRequest & { admin: AdminAccount };
      const poste = await container.workspace.monPoste(account);
      return { ...poste, identite: { ...poste.identite, roleLabel: ROLE_LABEL[account.role] } };
    });

    /* ========================= MOTEUR DE VIGILANCE ========================= */

    /**
     * Contrôle permanent de la plateforme. Chaque constat porte son chiffre, sa
     * conséquence, l'action à mener et la session où la mener — pas une liste de
     * voyants qu'il faudrait interpréter.
     */
    scoped.get('/admin/vigilance', async (req) => {
      require(req, 'vigilance:read');
      const q = parse(
        z.object({
          severite: z.enum(['critique', 'eleve', 'moyen', 'info']).optional(),
          domaine: z.string().max(30).optional(),
        }),
        req.query,
      );
      const sante = await container.vigilance.sante();
      const constats = sante.constats.filter(
        (c) => (!q.severite || c.severite === q.severite) && (!q.domaine || c.domaine === q.domaine),
      );
      return { ...sante, constats };
    });

    /** Rapport de contrôle PDF — pièce de revue interne ou d'audit. */
    scoped.get('/admin/vigilance/rapport.pdf', async (req, reply) => {
      require(req, 'vigilance:read');
      const sante = await container.vigilance.sante();
      const { simplePdf } = await import('../../core/pdf.js');
      const lignes = [
        'ORION — RAPPORT DE CONTRÔLE (MOTEUR DE VIGILANCE)',
        `Émis le ${new Date().toLocaleString('fr-FR')}`,
        `État de la plateforme : ${sante.etat.toUpperCase()} · score ${sante.score}/100`,
        `Constats : ${sante.parSeverite.critique} critique(s), ${sante.parSeverite.eleve} élevé(s), ${sante.parSeverite.moyen} moyen(s)`,
        '',
        ...sante.constats.flatMap((c) => [
          `[${c.severite.toUpperCase()} · ${c.domaine}] ${c.titre}`,
          `  Constat : ${c.constat}`,
          `  Conséquence : ${c.consequence}`,
          `  Action : ${c.action} (session « ${c.section} »)`,
          '',
        ]),
        sante.constats.length === 0 ? 'Aucun constat : la plateforme est saine.' : '',
      ].filter(Boolean);
      audit(req, 'vigilance.rapport', undefined, { score: sante.score, constats: sante.constats.length });
      reply.header('content-type', 'application/pdf');
      reply.header('content-disposition', 'attachment; filename="orion-rapport-controle.pdf"');
      return simplePdf(lignes);
    });

    /* ======================= DIRECTION GÉNÉRALE (PDG) ======================= */

    /**
     * Cellule CSV sûre : on neutralise les séparateurs ET les débuts de formule.
     * Un libellé commençant par « = » exécuterait du code à l'ouverture du tableur.
     */
    const csvCell = (v: unknown): string => {
      let t = String(v ?? '').replace(/[";\n\r]/g, ' ');
      if (/^[=+\-@]/.test(t)) t = `'${t}`;
      return t;
    };

    /**
     * Tableau de bord du PDG : consolidation financière, pouls quotidien de la
     * trésorerie, décisions qui l'attendent, alertes et décisions récentes des
     * directeurs. Un seul appel — on ouvre sa session et on voit tout.
     */
    scoped.get('/admin/executive', async (req) => {
      require(req, 'executive:read');
      const q = parse(z.object({ days: z.coerce.number().int().min(1).max(365).optional() }), req.query);
      return container.executive.tableauDeBord(q.days ?? 30);
    });

    /** GRAND LIVRE : chaque entrée et chaque sortie d'argent, filtrable. */
    scoped.get('/admin/executive/livre', async (req) => {
      require(req, 'executive:read');
      const q = parse(
        z.object({
          days: z.coerce.number().int().min(1).max(365).optional(),
          sens: z.enum(['entree', 'sortie']).optional(),
          categorie: z.string().max(40).optional(),
          page: z.coerce.number().int().min(1).optional(),
          limit: z.coerce.number().int().min(1).max(200).optional(),
        }),
        req.query,
      );
      const tout = container.executive.grandLivre({
        depuisJours: q.days ?? 30,
        sens: q.sens,
        categorie: q.categorie as never,
      });
      const limit = q.limit ?? 50;
      const page = Math.max(1, q.page ?? 1);
      return {
        mouvements: tout.slice((page - 1) * limit, page * limit),
        total: tout.length,
        page,
        pages: Math.max(1, Math.ceil(tout.length / limit)),
        // Totaux sur l'ENSEMBLE du filtre, pas sur la page affichée : une page de
        // tableau ne doit jamais donner une fausse idée du total.
        entrees: tout.filter((x) => x.sens === 'entree' && x.enCaisse).reduce((n, x) => n + x.montant, 0),
        sorties: tout.filter((x) => x.sens === 'sortie').reduce((n, x) => n + x.montant, 0),
      };
    });

    /** Export comptable du grand livre (tableur / expert-comptable). */
    scoped.get('/admin/executive/livre.csv', async (req, reply) => {
      require(req, 'executive:read');
      const q = parse(z.object({ days: z.coerce.number().int().min(1).max(365).optional() }), req.query);
      const lignes = container.executive.grandLivre({ depuisJours: q.days ?? 90 });
      const entete = 'date;sens;categorie;libelle;montant_fcfa;en_caisse;contrepartie;reference;statut';
      const corps = lignes.map((m) => [
        m.at, m.sens, m.categorie, csvCell(m.libelle), String(m.montant),
        m.enCaisse ? 'oui' : 'non', csvCell(m.contrepartie ?? ''), csvCell(m.reference ?? ''), csvCell(m.statut ?? ''),
      ].join(';'));
      audit(req, 'executive.export', undefined, { lignes: lignes.length });
      reply.header('content-type', 'text/csv; charset=utf-8');
      reply.header('content-disposition', 'attachment; filename="orion-grand-livre.csv"');
      return [entete, ...corps].join('\n');
    });

    /** Rapport exécutif PDF — ce que le PDG emporte en conseil d'administration. */
    scoped.get('/admin/executive/rapport.pdf', async (req, reply) => {
      require(req, 'executive:read');
      const q = parse(z.object({ days: z.coerce.number().int().min(1).max(365).optional() }), req.query);
      const jours = q.days ?? 30;
      const t = await container.executive.tableauDeBord(jours);
      const c = t.consolidation;
      const { simplePdf } = await import('../../core/pdf.js');
      const f = (n: number) => `${Math.round(n).toLocaleString('fr-FR')} F`;
      const lignes = [
        'ORION — RAPPORT EXÉCUTIF (DIRECTION GÉNÉRALE)',
        `Période : ${jours} derniers jours · émis le ${new Date().toLocaleString('fr-FR')}`,
        '',
        '— FLUX FINANCIERS —',
        `Volume d'affaires (GMV) : ${f(c.gmv)}`,
        `Revenu ORION : ${f(c.revenu)}`,
        `Entrées en caisse : ${f(c.entrees)}`,
        `Sorties de caisse : ${f(c.sorties)}`,
        `Solde de la période : ${f(c.solde)}`,
        '',
        '— HORS CAISSE —',
        `Espèces encaissées par les chauffeurs : ${f(c.especesChauffeurs)}`,
        `Commissions dues sur ces espèces : ${f(c.dettesEspeces)}`,
        `Sommes dues aux chauffeurs : ${f(c.dusChauffeurs)}`,
        `Encours comptes entreprise : ${f(c.encoursEntreprises)}`,
        `TVA collectée (à reverser) : ${f(c.tvaCollectee)}`,
        '',
        '— ABONNEMENTS —',
        `Revenu récurrent mensuel : ${f(c.mrr)}`,
        `Cotisations impayées : ${f(c.impayesAbonnements)}`,
        '',
        `— DÉCISIONS EN ATTENTE (${t.decisions.length}) —`,
        ...t.decisions.slice(0, 12).map((d) => `• ${d.libelle}${d.montant ? ` — ${f(d.montant)}` : ''}`),
        '',
        `— ALERTES (${t.alertes.length}) —`,
        ...t.alertes.map((a) => `• [${a.gravite.toUpperCase()}] ${a.titre} — ${a.detail}`),
        '',
        '— EFFECTIF —',
        `Employés console : ${t.effectif.employes} · Chauffeurs : ${t.effectif.chauffeurs} (${t.effectif.chauffeursEnLigne} en ligne)`,
        `Clients : ${t.effectif.clients} · Abonnés actifs : ${t.effectif.abonnes}`,
      ];
      audit(req, 'executive.rapport', undefined, { jours });
      reply.header('content-type', 'application/pdf');
      reply.header('content-disposition', 'attachment; filename="orion-rapport-executif.pdf"');
      return simplePdf(lignes);
    });

    /* ------------------- LOCATION SIGNATURE (événements, entreprises) ------------------- */

    /** Tableau de bord Location : demandes, flotte Signature et indicateurs. */
    scoped.get('/admin/rental', async (req) => {
      require(req, 'rental:read');
      const q = parse(
        z.object({
          status: z.enum(['devis', 'reservee', 'confirmee', 'en_cours', 'terminee', 'annulee']).optional(),
          formula: z.enum(['evenement', 'entreprise', 'mise_a_disposition']).optional(),
        }),
        req.query,
      );
      const { PRESTIGE } = await import('../fleet/prestige.js');
      return {
        reservations: container.rental.list(q),
        fleet: PRESTIGE,
        stats: container.rental.stats(),
        // Disponibilité du jour : ce que la console peut promettre MAINTENANT.
        disponibilites: container.rental.disponibilites(new Date(), new Date(Date.now() + 86_400_000)),
      };
    });

    /** Affectation d'un chauffeur à une location (le client doit savoir qui vient). */
    scoped.post('/admin/rental/:id/assign', async (req) => {
      require(req, 'rental:write');
      const { id } = req.params as { id: string };
      const body = parse(z.object({ driverId: z.string().min(1) }), req.body);
      const reservation = container.rental.assign(id, body.driverId);
      // Le chauffeur est prévenu en direct sur son canal : une affectation qu'il
      // découvrirait le jour J n'en serait pas une.
      container.realtime.publish(driverRoom(body.driverId), 'rental.assigned', {
        id: reservation.id,
        vehicle: reservation.vehicle.name,
        debut: reservation.debut,
        fin: reservation.fin,
        lieu: reservation.lieu ?? null,
        formula: reservation.formula,
      });
      container.notifications.notify(
        { driverId: body.driverId },
        'Nouvelle location Signature 💎',
        `${reservation.vehicle.name} — ${new Date(reservation.debut).toLocaleString('fr-FR')}${reservation.lieu ? ` · ${reservation.lieu}` : ''}`,
      );
      audit(req, 'rental.assign', id, { driverId: body.driverId });
      return { reservation };
    });

    /** Avancement du dossier (confirmée → en cours → terminée). */
    scoped.post('/admin/rental/:id/status', async (req) => {
      require(req, 'rental:write');
      const { id } = req.params as { id: string };
      const body = parse(
        z.object({
          status: z.enum(['devis', 'reservee', 'confirmee', 'en_cours', 'terminee', 'annulee']),
          note: z.string().max(200).optional(),
        }),
        req.body,
      );
      const reservation = container.rental.setStatus(id, body.status, body.note);
      audit(req, 'rental.status', id, { status: body.status });
      return { reservation };
    });

    /** Annulation côté ORION (indisponibilité, incident) — frais calculés et journalisés. */
    scoped.post('/admin/rental/:id/annuler', async (req) => {
      require(req, 'rental:write');
      const { id } = req.params as { id: string };
      const body = parse(z.object({ raison: z.string().max(200).optional() }), req.body ?? {});
      const r = container.rental.annuler(id, body.raison);
      audit(req, 'rental.cancel', id, { frais: r.frais, raison: body.raison });
      return r;
    });

    /** Bon de location (PDF) : ce que le chauffeur et le client signent au départ. */
    scoped.get('/admin/rental/:id/bon.pdf', async (req, reply) => {
      require(req, 'rental:read');
      const { id } = req.params as { id: string };
      const r = container.rental.get(id);
      if (!r) throw notFound('Location introuvable');
      const { simplePdf } = await import('../../core/pdf.js');
      const lignes = [
        'ORION — BON DE LOCATION',
        `Dossier : ${r.id}`,
        `Formule : ${r.formula}`,
        `Véhicule : ${r.vehicle.name} (${r.vehicle.places} places)`,
        `Période : du ${r.debut} au ${r.fin}`,
        `Durée : ${r.duree}${r.heures ? ` (${r.heures} h)` : ''}`,
        r.lieu ? `Lieu de prise en charge : ${r.lieu}` : 'Lieu de prise en charge : à préciser',
        r.societe ? `Société : ${r.societe.nom}${r.societe.bonCommande ? ` — BC ${r.societe.bonCommande}` : ''}` : '',
        r.contact ? `Contact : ${r.contact.nom} — ${r.contact.telephone}` : '',
        r.driverId ? `Chauffeur affecté : ${container.drivers.get(r.driverId)?.name ?? r.driverId}` : 'Chauffeur : à affecter',
        '',
        `Véhicule : ${r.breakdown.vehicule} F`,
        r.breakdown.cortege ? `Cortège : ${r.breakdown.cortege} F` : '',
        r.breakdown.options ? `Options : ${r.breakdown.options} F` : '',
        r.breakdown.majorationJourJ ? `Mobilisation express (jour J) : ${r.breakdown.majorationJourJ} F` : '',
        r.breakdown.remiseAbonnement ? `Remise abonné ORION : -${r.breakdown.remiseAbonnement} F` : '',
        `Total HT : ${r.breakdown.ht} F`,
        `TVA : ${r.breakdown.tva} F`,
        `TOTAL : ${r.total} F CFA`,
        `Caution (restituée) : ${r.caution} F`,
      ].filter(Boolean);
      reply.header('content-type', 'application/pdf');
      reply.header('content-disposition', `attachment; filename="orion-location-${r.id}.pdf"`);
      return simplePdf(lignes);
    });

    /** Barème de location EN VIGUEUR : prix journée, stocks, options, majorations. */
    scoped.get('/admin/rental/tarifs', async (req) => {
      require(req, 'rental:read');
      return container.rentalSettings.etat();
    });

    /**
     * Ajustement des tarifs de location. C'est une décision COMMERCIALE : elle
     * appartient à l'équipe, pas au code source. Chaque changement est journalisé avec
     * son auteur, et comparé à l'ancien barème pour que la direction voie l'écart.
     */
    scoped.put('/admin/rental/tarifs', async (req) => {
      require(req, 'rental:write');
      const nombre = z.number().finite();
      const body = parse(
        z.object({
          tarif: z.object({
            coefs: z.object({
              journee: nombre.optional(), weekend: nombre.optional(),
              semaine: nombre.optional(), mois: nombre.optional(),
            }).optional(),
            ratioHeure: nombre.optional(), minHeures: nombre.optional(), maxHeures: nombre.optional(),
            decoration: nombre.optional(), tapisRouge: nombre.optional(), hotesse: nombre.optional(),
            escorte: nombre.optional(), plaque: nombre.optional(), secondChauffeur: nombre.optional(),
            rafraichissements: nombre.optional(), remiseCortege: nombre.optional(),
            kmInclusParJour: nombre.optional(), prixKmSupp: nombre.optional(),
            majorationKmIllimite: nombre.optional(), majorationJourJ: nombre.optional(),
            tauxCaution: nombre.optional(),
            delaiExpressMin: nombre.optional(), delaiExpressMax: nombre.optional(),
          }).optional(),
          vehicules: z.record(
            z.string(),
            z.object({ prixJour: nombre.optional(), exemplaires: nombre.optional(), actif: z.boolean().optional() }),
          ).optional(),
        }),
        req.body,
      );
      const { admin: account } = req as FastifyRequest & { admin: AdminAccount };
      const avant = container.rentalSettings.etat();
      const apres = container.rentalSettings.update({ ...body, acteur: account.name });
      // Journal : on enregistre les ÉCARTS, pas l'objet entier — c'est ce qu'un
      // directeur veut lire six mois plus tard.
      const ecarts: Record<string, { avant: number | boolean; apres: number | boolean }> = {};
      for (const [cle, val] of Object.entries(body.tarif ?? {})) {
        if (cle === 'coefs' || val === undefined) continue;
        const ancien = (avant.tarif as unknown as Record<string, number>)[cle];
        if (ancien !== val) ecarts[cle] = { avant: ancien!, apres: val as number };
      }
      for (const [cle, val] of Object.entries(body.tarif?.coefs ?? {})) {
        const ancien = avant.tarif.coefs[cle as 'journee'];
        if (val !== undefined && ancien !== val) ecarts[`coef.${cle}`] = { avant: ancien, apres: val };
      }
      for (const [id, v] of Object.entries(body.vehicules ?? {})) {
        const ancien = avant.vehicules.find((x) => x.id === id);
        if (!ancien) continue;
        if (v.prixJour !== undefined && v.prixJour !== ancien.prixJour) ecarts[`${id}.prixJour`] = { avant: ancien.prixJour, apres: v.prixJour };
        if (v.exemplaires !== undefined && v.exemplaires !== ancien.exemplaires) ecarts[`${id}.exemplaires`] = { avant: ancien.exemplaires, apres: v.exemplaires };
        if (v.actif !== undefined && v.actif !== ancien.actif) ecarts[`${id}.actif`] = { avant: ancien.actif, apres: v.actif };
      }
      audit(req, 'rental.tarifs', undefined, { ecarts });
      return { tarif: apres.tarif, vehicules: container.rentalSettings.etat().vehicules, ecarts };
    });

    /** Retour au barème d'origine (catalogue de référence). */
    scoped.post('/admin/rental/tarifs/reset', async (req) => {
      require(req, 'rental:write');
      const { admin: account } = req as FastifyRequest & { admin: AdminAccount };
      container.rentalSettings.reset(account.name);
      audit(req, 'rental.tarifs.reset');
      return container.rentalSettings.etat();
    });

    /* ------------------------------ ABONNEMENTS ORION ------------------------------ */

    /** Parc d'abonnés, revenu récurrent, valeur réellement rendue, impayés. */
    scoped.get('/admin/subscriptions', async (req) => {
      require(req, 'rental:read');
      const { PLANS, PLAN_IDS } = await import('../subscriptions/service.js');
      return {
        plans: PLAN_IDS.map((p) => PLANS[p]),
        subscriptions: container.subscriptions.list(),
        invoices: container.subscriptions.factures(),
        stats: container.subscriptions.stats(),
      };
    });

    /** Encaissement manuel d'une facture d'abonnement (support, agence, espèces). */
    scoped.post('/admin/subscriptions/invoices/:id/payer', async (req) => {
      require(req, 'rental:write');
      const { id } = req.params as { id: string };
      const body = parse(z.object({ method: z.string().max(40).optional(), reference: z.string().max(80).optional() }), req.body ?? {});
      const facture = container.subscriptions.payerFacture(id, body);
      audit(req, 'subscription.invoice.paid', id, { amount: facture.amount, method: body.method });
      return { facture };
    });

    /**
     * Traitement des échéances : renouvellements automatiques et suspensions pour
     * impayé. Déclenchable à la main depuis la console, ou par une tâche planifiée.
     */
    scoped.post('/admin/subscriptions/echeances', async (req) => {
      require(req, 'rental:write');
      const bilan = container.subscriptions.traiterEcheances();
      audit(req, 'subscription.echeances', undefined, bilan);
      return bilan;
    });

    /** Résiliation par le support (demande client, fraude). */
    scoped.post('/admin/subscriptions/:userId/resilier', async (req) => {
      require(req, 'rental:write');
      const { userId } = req.params as { userId: string };
      const body = parse(z.object({ raison: z.string().max(200).optional() }), req.body ?? {});
      const subscription = container.subscriptions.cancel(userId, body.raison);
      audit(req, 'subscription.cancel', userId, { raison: body.raison });
      return { subscription };
    });

    /* ======================= CAISSE NOMINATIVE (Trésorerie) =======================
     *
     * Une partie de l'argent d'ORION arrive en espèces, passe par les mains d'une
     * personne, et se compte à la main en fin de journée. Tant que cette étape
     * n'est pas outillée, elle se fait sur un cahier et le rapport financier ignore
     * une part réelle des encaissements.
     *
     * La caisse est NOMINATIVE : personne ne touche celle d'une autre. La direction
     * financière lit tout, mais n'encaisse ni n'arrête à la place de la titulaire.
     */

    const coupureSchema = z.object(
      Object.fromEntries(COUPURES.map((c) => [String(c), z.number().int().min(0).max(100_000).optional()])),
    );

    /** Seule la titulaire manipule sa caisse. Lecture possible pour l'encadrement. */
    const assertMaCaisse = (req: FastifyRequest, caisseId: string): void => {
      const { admin: account } = req as FastifyRequest & { admin: AdminAccount };
      const caisse = container.caisses.get(caisseId);
      if (!caisse) throw notFound('Caisse introuvable');
      if (caisse.titulaire !== account.username) {
        throw forbidden('Cette caisse est tenue par une autre personne — on ne compte pas l’argent d’autrui.');
      }
    };

    scoped.get('/admin/caisses', async (req) => {
      require(req, 'caisse:read');
      const { admin: account } = req as FastifyRequest & { admin: AdminAccount };
      const q = parse(z.object({
        titulaire: z.string().max(60).optional(),
        statut: z.enum(['ouverte', 'arretee']).optional(),
        jours: z.coerce.number().int().min(1).max(365).optional(),
      }), req.query ?? {});

      // Une trésorière voit SES caisses ; la direction financière voit tout le monde.
      const toutVoir = can(account.role, 'finance:read') && account.role !== 'tresorier';
      const caisses = container.caisses.list({
        titulaire: toutVoir ? q.titulaire : account.username,
        statut: q.statut,
      });
      const maCaisse = account.username ? container.caisses.caisseOuverteDe(account.username) : undefined;
      return {
        caisses,
        /** La caisse ouverte du compte connecté, avec son journal : son poste de travail. */
        maCaisse: maCaisse ? container.caisses.etat(maCaisse.id) : null,
        consolidation: can(account.role, 'finance:read') ? container.caisses.consolidation(q.jours ?? 30) : null,
        referentiel: {
          coupures: COUPURES,
          ecartTolere: ECART_TOLERE,
          origines: ORIGINE_LABEL,
          sorties: SORTIE_LABEL,
        },
      };
    });

    scoped.get('/admin/caisses/:id', async (req) => {
      require(req, 'caisse:read');
      const { id } = req.params as { id: string };
      const { admin: account } = req as FastifyRequest & { admin: AdminAccount };
      const etat = container.caisses.etat(id);
      if (!etat) throw notFound('Caisse introuvable');
      // La titulaire, ou quelqu'un qui a le droit de lire les comptes de l'entreprise.
      if (etat.titulaire !== account.username && !can(account.role, 'finance:read')) {
        throw forbidden('Caisse tenue par une autre personne.');
      }
      return { caisse: etat };
    });

    scoped.post('/admin/caisses', async (req, reply) => {
      require(req, 'caisse:write');
      const { admin: account } = req as FastifyRequest & { admin: AdminAccount };
      if (!account.username) throw forbidden('Une caisse est nominative : connectez-vous avec votre compte.');
      const body = parse(z.object({
        fondDeCaisse: z.number().min(0).max(50_000_000),
        emplacement: z.string().max(80).optional(),
      }), req.body);
      const res = container.caisses.ouvrir({
        titulaire: account.username, titulaireNom: account.name,
        fondDeCaisse: body.fondDeCaisse, emplacement: body.emplacement,
      });
      if (res === 'deja_ouverte') {
        reply.code(409);
        return { error: 'Vous avez déjà une caisse ouverte — arrêtez-la avant d’en ouvrir une autre.' };
      }
      audit(req, 'caisse.ouvrir', res.id, { fondDeCaisse: body.fondDeCaisse });
      return { caisse: container.caisses.etat(res.id) };
    });

    scoped.post('/admin/caisses/:id/encaisser', async (req, reply) => {
      require(req, 'caisse:write');
      const { id } = req.params as { id: string };
      assertMaCaisse(req, id);
      const body = parse(z.object({
        montant: z.number().positive().max(50_000_000),
        origine: z.enum(['commission_chauffeur', 'location', 'abonnement', 'reliquat_note_frais', 'remboursement_pret', 'autre']),
        tiers: z.string().max(100).optional(),
        reference: z.string().max(80).optional(),
        note: z.string().max(300).optional(),
      }), req.body);
      const { admin: account } = req as FastifyRequest & { admin: AdminAccount };
      const res = container.caisses.encaisser(id, { ...body, par: account.name });
      if (res === 'caisse_fermee') { reply.code(409); return { error: 'Caisse déjà arrêtée.' }; }
      if (!res) throw notFound('Caisse introuvable');
      audit(req, 'caisse.encaisser', id, { montant: body.montant, origine: body.origine });
      return { mouvement: res, caisse: container.caisses.etat(id) };
    });

    scoped.post('/admin/caisses/:id/decaisser', async (req, reply) => {
      require(req, 'caisse:write');
      const { id } = req.params as { id: string };
      assertMaCaisse(req, id);
      const body = parse(z.object({
        montant: z.number().positive().max(50_000_000),
        sortie: z.enum(['versement_banque', 'avance_chauffeur', 'depense', 'transfert_caisse']),
        tiers: z.string().max(100).optional(),
        reference: z.string().max(80).optional(),
        note: z.string().max(300).optional(),
      }), req.body);
      const { admin: account } = req as FastifyRequest & { admin: AdminAccount };
      const res = container.caisses.decaisser(id, { ...body, par: account.name });
      if (res === 'caisse_fermee') { reply.code(409); return { error: 'Caisse déjà arrêtée.' }; }
      if (res === 'solde_insuffisant') {
        reply.code(409);
        return { error: 'Montant supérieur à ce que contient la caisse — vérifiez la saisie.' };
      }
      if (!res) throw notFound('Caisse introuvable');
      audit(req, 'caisse.decaisser', id, { montant: body.montant, sortie: body.sortie });
      return { mouvement: res, caisse: container.caisses.etat(id) };
    });

    /** Comptage à blanc : ce que donnerait l'arrêté, sans rien figer. */
    scoped.post('/admin/caisses/:id/comptage', async (req) => {
      require(req, 'caisse:write');
      const { id } = req.params as { id: string };
      assertMaCaisse(req, id);
      const body = parse(z.object({ comptage: coupureSchema }), req.body);
      const comptage = Object.fromEntries(
        Object.entries(body.comptage).filter(([, v]) => v !== undefined).map(([k, v]) => [Number(k), v]),
      ) as Comptage;
      const compte = totalComptage(comptage);
      const attendu = container.caisses.soldeTheorique(id);
      return { montantCompte: compte, montantAttendu: attendu, ecart: compte - attendu, ecartTolere: ECART_TOLERE };
    });

    /** ARRÊTÉ : la trésorière déclare ce qu'elle a réellement compté. */
    scoped.post('/admin/caisses/:id/arreter', async (req, reply) => {
      require(req, 'caisse:write');
      const { id } = req.params as { id: string };
      assertMaCaisse(req, id);
      const body = parse(z.object({
        comptage: coupureSchema.optional(),
        montantCompte: z.number().min(0).max(50_000_000).optional(),
        motifEcart: z.string().max(400).optional(),
        verseEnBanque: z.number().min(0).max(50_000_000).optional(),
      }), req.body);
      const comptage = body.comptage
        ? Object.fromEntries(
          Object.entries(body.comptage).filter(([, v]) => v !== undefined).map(([k, v]) => [Number(k), v]),
        ) as Comptage
        : undefined;
      const { admin: account } = req as FastifyRequest & { admin: AdminAccount };
      const res = container.caisses.arreter(id, { ...body, comptage, par: account.name });
      if (typeof res === 'string') {
        reply.code(res === 'deja_arretee' ? 409 : 400);
        const messages: Record<string, string> = {
          deja_arretee: 'Cette caisse est déjà arrêtée.',
          motif_requis: `Écart supérieur à ${ECART_TOLERE} F : un motif écrit est obligatoire. Un manquant sans explication n’est pas un arrêté.`,
          rien_a_compter: 'Indiquez le comptage par coupures ou le montant compté.',
        };
        return { error: messages[res] };
      }
      if (res === null) throw notFound('Caisse introuvable');
      audit(req, 'caisse.arreter', id, { ecart: res.ecart, verseEnBanque: res.verseEnBanque });
      return { caisse: container.caisses.etat(id) };
    });

    /** Validation par un supérieur — un arrêté ne se valide pas tout seul. */
    scoped.post('/admin/caisses/:id/valider', async (req, reply) => {
      require(req, 'finance:write');
      const { id } = req.params as { id: string };
      const { admin: account } = req as FastifyRequest & { admin: AdminAccount };
      const res = container.caisses.valider(id, account.username ?? account.name);
      if (res === 'non_arretee') { reply.code(409); return { error: 'Caisse encore ouverte : rien à valider.' }; }
      if (res === 'auto_validation') {
        throw forbidden('On ne valide pas son propre arrêté de caisse.');
      }
      if (res === null) throw notFound('Caisse introuvable');
      audit(req, 'caisse.valider', id, { ecart: res.ecart });
      return { caisse: container.caisses.etat(id) };
    });

    /* ============================= SESSION ÉQUIPAGES =============================
     *
     * Le dossier des chauffeurs ORION, et l'endroit où ils déposent leurs requêtes.
     *
     * Deux publics dans la même session, et une frontière nette entre les deux :
     *  - l'encadrement (crew:read / crew:write) travaille sur tous les dossiers,
     *    ou sur sa flotte accréditée s'il s'agit d'un chef d'équipe ou d'un agent ;
     *  - le chauffeur (crew:self) ne voit QUE son dossier et ne dépose QUE ses
     *    propres requêtes. Il n'a aucun moyen de regarder le dossier d'un collègue.
     */

    /** Le chauffeur rattaché au compte connecté, s'il s'agit d'un compte chauffeur. */
    const monDriverId = (req: FastifyRequest): string | undefined => {
      const { admin: account } = req as FastifyRequest & { admin: AdminAccount };
      return account.username ? container.accounts.get(account.username)?.driverId : undefined;
    };

    /**
     * Portée de lecture d'un dossier chauffeur. Le chauffeur n'accède qu'au sien ;
     * le chef d'équipe et l'agent, qu'à leur flotte accréditée ; l'encadrement, à tout.
     */
    const assertPorteeChauffeur = (req: FastifyRequest, driverId: string): void => {
      const { admin: account } = req as FastifyRequest & { admin: AdminAccount };
      if (account.role === 'chauffeur') {
        if (monDriverId(req) !== driverId) {
          throw forbidden('Vous ne pouvez consulter que votre propre dossier.');
        }
        return;
      }
      if (account.role === 'manager' || account.role === 'agent') {
        const fiche = account.username ? container.accounts.get(account.username) : undefined;
        const equipes = account.role === 'manager'
          ? container.teams.listByManager(account.username ?? '')
          : container.teams.list().filter((t) => t.id === fiche?.teamId);
        if (!equipes.some((t) => t.driverIds.includes(driverId))) {
          throw forbidden('Ce chauffeur n’est pas dans la flotte qui vous est accréditée.');
        }
      }
    };

    /** Lecture : l'encadrement a crew:read, le chauffeur n'a que crew:self. */
    const requireCrewRead = (req: FastifyRequest): void => {
      const { admin: account } = req as FastifyRequest & { admin: AdminAccount };
      if (can(account.role, 'crew:read') || can(account.role, 'crew:self')) return;
      require(req, 'crew:read');
    };

    scoped.get('/admin/crew', async (req) => {
      requireCrewRead(req);
      const { admin: account } = req as FastifyRequest & { admin: AdminAccount };
      const q = parse(z.object({
        q: z.string().max(80).optional(),
        teamId: z.string().max(64).optional(),
        kycStatus: z.string().max(40).optional(),
        jours: z.coerce.number().int().min(1).max(365).optional(),
      }), req.query ?? {});

      // Un chauffeur n'obtient jamais la liste de ses collègues : seulement lui.
      if (account.role === 'chauffeur') {
        const moi = monDriverId(req);
        const lignes = moi ? container.crew.liste({ jours: q.jours }).filter((l) => l.driverId === moi) : [];
        return { equipages: lignes, tableau: null, moi };
      }

      let equipages = container.crew.liste(q);
      // Chef d'équipe et agent : strictement leur flotte accréditée.
      if (account.role === 'manager' || account.role === 'agent') {
        const fiche = account.username ? container.accounts.get(account.username) : undefined;
        const equipes = account.role === 'manager'
          ? container.teams.listByManager(account.username ?? '')
          : container.teams.list().filter((t) => t.id === fiche?.teamId);
        const flotte = new Set(equipes.flatMap((t) => t.driverIds));
        equipages = equipages.filter((l) => flotte.has(l.driverId));
      }
      return {
        equipages,
        tableau: container.crew.tableau(q.jours),
        types: Object.entries(CREW_TYPE_LABEL).map(([id, label]) => ({ id, label, financier: TYPES_FINANCIERS.includes(id as TypeRequete) })),
        statuts: CREW_STATUT_LABEL,
        plafonds: { avance: PLAFOND_AVANCE, pret: PLAFOND_PRET, maxEcheances: MAX_ECHEANCES },
      };
    });

    scoped.get('/admin/crew/:driverId', async (req) => {
      requireCrewRead(req);
      const { driverId } = req.params as { driverId: string };
      assertPorteeChauffeur(req, driverId);
      const q = parse(z.object({ jours: z.coerce.number().int().min(1).max(365).optional() }), req.query ?? {});
      const dossier = container.crew.dossier(driverId, q.jours);
      if (!dossier) throw notFound('Chauffeur introuvable');
      return { dossier };
    });

    /** Dépôt d'une requête : par le chauffeur lui-même, ou en son nom au guichet. */
    scoped.post('/admin/crew/:driverId/requetes', async (req, reply) => {
      requireCrewRead(req);
      const { driverId } = req.params as { driverId: string };
      assertPorteeChauffeur(req, driverId);
      const body = parse(z.object({
        type: z.enum(['pret', 'avance', 'conge', 'materiel', 'reparation', 'reclamation', 'document']),
        montant: z.number().positive().max(10_000_000).optional(),
        echeances: z.number().int().min(1).max(MAX_ECHEANCES).optional(),
        du: z.string().max(20).optional(),
        au: z.string().max(20).optional(),
        motif: z.string().min(3).max(600),
      }), req.body);

      const d = container.drivers.get(driverId);
      if (!d) throw notFound('Chauffeur introuvable');
      const equipe = container.teams.list().find((t) => t.driverIds.includes(driverId));
      const res = container.crewRequests.deposer({
        driverId, driverName: d.name, matricule: d.matricule, teamId: equipe?.id, ...body,
      });
      if (typeof res === 'string') {
        reply.code(res === 'doublon' ? 409 : 400);
        const messages: Record<string, string> = {
          montant_requis: 'Ce type de requête demande un montant.',
          plafond_depasse: `Montant au-dessus du plafond (avance ${PLAFOND_AVANCE.toLocaleString('fr-FR')} F, prêt ${PLAFOND_PRET.toLocaleString('fr-FR')} F).`,
          doublon: 'Un prêt est déjà en cours pour ce chauffeur — on ne prête pas pour rembourser un prêt.',
        };
        return { error: messages[res] };
      }
      audit(req, 'crew.request', res.id, { driverId, type: body.type, montant: body.montant });
      return { requete: res };
    });

    /** Avis motivé du chef d'équipe : il connaît l'homme, pas seulement le dossier. */
    scoped.post('/admin/crew/requetes/:id/instruire', async (req, reply) => {
      require(req, 'crew:write');
      const { id } = req.params as { id: string };
      const existante = container.crewRequests.get(id);
      if (!existante) throw notFound('Requête introuvable');
      assertPorteeChauffeur(req, existante.driverId);
      const body = parse(z.object({
        avis: z.enum(['favorable', 'defavorable']),
        note: z.string().max(500).optional(),
      }), req.body);
      const { admin: account } = req as FastifyRequest & { admin: AdminAccount };
      const res = container.crewRequests.instruire(id, body.avis, account.name, body.note);
      if (res === 'deja_decidee') { reply.code(409); return { error: 'Requête déjà tranchée.' }; }
      if (!res) throw notFound('Requête introuvable');
      audit(req, 'crew.instruire', id, { avis: body.avis });
      return { requete: res };
    });

    /** Décision financière — jamais sur sa propre requête. */
    scoped.post('/admin/crew/requetes/:id/decider', async (req, reply) => {
      require(req, 'finance:write');
      const { id } = req.params as { id: string };
      const body = parse(z.object({
        decision: z.enum(['accord', 'refus']),
        note: z.string().max(500).optional(),
        montantAccorde: z.number().min(0).max(10_000_000).optional(),
      }), req.body);
      const { admin: account } = req as FastifyRequest & { admin: AdminAccount };
      const existante = container.crewRequests.get(id);
      if (!existante) throw notFound('Requête introuvable');
      // Séparation des tâches : on ne statue pas sur ce qu'on a soi-même déposé.
      if (account.username && container.accounts.get(account.username)?.driverId === existante.driverId) {
        throw forbidden('On ne statue pas sur sa propre requête.');
      }
      const res = container.crewRequests.decider(id, body.decision, account.name, body);
      if (res === 'deja_versee') { reply.code(409); return { error: 'Requête déjà versée ou clôturée.' }; }
      if (!res) throw notFound('Requête introuvable');
      audit(req, `crew.${body.decision}`, id, { montant: res.montantAccorde });
      return { requete: res };
    });

    /** Versement effectif : c'est la trésorerie qui sort l'argent. */
    scoped.post('/admin/crew/requetes/:id/verser', async (req, reply) => {
      require(req, 'caisse:write');
      const { id } = req.params as { id: string };
      const body = parse(z.object({ canal: z.string().min(2).max(40) }), req.body);
      const { admin: account } = req as FastifyRequest & { admin: AdminAccount };
      const res = container.crewRequests.verser(id, account.name, body.canal);
      if (res === 'non_accordee') { reply.code(409); return { error: 'Requête non accordée : rien à verser.' }; }
      if (!res) throw notFound('Requête introuvable');
      audit(req, 'crew.verser', id, { montant: res.montantAccorde, canal: body.canal });
      return { requete: res };
    });

    /** Remboursement d'une échéance de prêt. */
    scoped.post('/admin/crew/requetes/:id/rembourser', async (req) => {
      require(req, 'caisse:write');
      const { id } = req.params as { id: string };
      const body = parse(z.object({ montant: z.number().positive().max(10_000_000) }), req.body);
      const res = container.crewRequests.rembourser(id, body.montant);
      if (!res) throw notFound('Requête ou échéancier introuvable');
      audit(req, 'crew.rembourser', id, { montant: body.montant });
      return { requete: res };
    });

    /* ================= ANNUAIRE DU PERSONNEL (identifiants de connexion) =================
     *
     * Les comptes ne venaient que de la configuration du serveur : ouvrir un accès à une
     * nouvelle trésorière ou à un chauffeur imposait d'éditer une variable d'environnement
     * et de redémarrer. Autant dire que personne n'aurait eu de compte. Cela se gère ici.
     *
     * Portée du chef d'équipe : il crée des comptes pour SON équipe, et seulement des
     * agents ou des chauffeurs. Nul ne se fabrique un supérieur hiérarchique.
     */
    const ROLES_DELEGUES: Role[] = ['agent', 'chauffeur'];

    /** Vérifie qu'un chef d'équipe reste dans son périmètre ; la direction passe partout. */
    const assertPorteeComptes = (req: FastifyRequest, cible: { role?: Role; teamId?: string | null }): void => {
      const { admin: account } = req as FastifyRequest & { admin: AdminAccount };
      if (account.role !== 'manager') return;
      if (cible.role && !ROLES_DELEGUES.includes(cible.role)) {
        throw forbidden('Un chef d’équipe ne crée que des comptes agent ou chauffeur.');
      }
      const siennes = new Set(container.teams.listByManager(account.username ?? '').map((t) => t.id));
      if (!cible.teamId || !siennes.has(cible.teamId)) {
        throw forbidden('Un chef d’équipe ne gère que les comptes de ses propres équipes.');
      }
    };

    scoped.get('/admin/accounts', async (req) => {
      require(req, 'accounts:read');
      const { admin: account } = req as FastifyRequest & { admin: AdminAccount };
      const q = parse(z.object({
        role: z.string().max(40).optional(),
        teamId: z.string().max(64).optional(),
        actif: z.enum(['true', 'false']).optional(),
        q: z.string().max(80).optional(),
      }), req.query ?? {});
      const filtre = {
        role: q.role as Role | undefined,
        teamId: q.teamId,
        actif: q.actif === undefined ? undefined : q.actif === 'true',
        q: q.q,
      };
      // Le chef d'équipe ne voit que les siens : l'annuaire complet n'est pas son affaire.
      let comptes = container.accounts.liste(filtre);
      if (account.role === 'manager') {
        const siennes = new Set(container.teams.listByManager(account.username ?? '').map((t) => t.id));
        comptes = comptes.filter((c) => c.teamId && siennes.has(c.teamId));
      }
      return {
        accounts: comptes,
        stats: container.accounts.stats(),
        roles: Object.entries(ROLE_LABEL).map(([id, label]) => ({ id, label, permissions: ROLE_PERMISSIONS[id as Role].length })),
        delegables: ROLES_DELEGUES,
      };
    });

    scoped.post('/admin/accounts', async (req, reply) => {
      require(req, 'accounts:write');
      const body = parse(z.object({
        name: z.string().min(2).max(80),
        role: z.string().min(2).max(40),
        username: z.string().min(3).max(60).regex(/^[a-z0-9._-]+$/, 'lettres minuscules, chiffres, point, tiret').optional(),
        service: z.string().max(60).optional(),
        phone: z.string().min(8).max(20).optional(),
        email: z.string().email().optional(),
        matricule: z.string().max(40).optional(),
        teamId: z.string().max(64).optional(),
        driverId: z.string().max(64).optional(),
      }), req.body);
      if (!(body.role in ROLE_PERMISSIONS)) throw notFound('Rôle inconnu');
      const role = body.role as Role;
      assertPorteeComptes(req, { role, teamId: body.teamId });

      // Un compte chauffeur doit pointer sur une fiche chauffeur qui existe : sans cela
      // la personne se connecte sur un dossier vide et ne comprend pas pourquoi.
      if (role === 'chauffeur') {
        if (!body.driverId) throw forbidden('Un compte chauffeur doit être rattaché à une fiche chauffeur.');
        if (!container.drivers.get(body.driverId)) throw notFound('Fiche chauffeur introuvable');
      }

      const { admin: account } = req as FastifyRequest & { admin: AdminAccount };
      const res = container.accounts.creer({ ...body, role, createdBy: account.name });
      if (!res.ok) {
        reply.code(409);
        return {
          error: res.raison === 'identifiant_pris'
            ? 'Cet identifiant est déjà utilisé.'
            : 'Ce chauffeur a déjà un compte de connexion.',
        };
      }
      audit(req, 'account.create', res.account.username, { role, teamId: body.teamId });
      // Le mot de passe provisoire n'est montré QU'ICI, une seule fois : il n'est stocké
      // nulle part en clair et ne pourra plus être relu, seulement réinitialisé.
      return { account: res.account, motDePasseProvisoire: res.motDePasseProvisoire };
    });

    scoped.put('/admin/accounts/:username', async (req) => {
      require(req, 'accounts:write');
      const { username } = req.params as { username: string };
      if (container.accounts.estProtege(username)) {
        throw forbidden('Compte défini dans la configuration du serveur — non modifiable depuis la console.');
      }
      const existant = container.accounts.get(username);
      if (!existant) throw notFound('Compte introuvable');
      const body = parse(z.object({
        name: z.string().min(2).max(80).optional(),
        role: z.string().min(2).max(40).optional(),
        service: z.string().max(60).optional(),
        phone: z.string().min(8).max(20).optional(),
        email: z.string().email().optional(),
        matricule: z.string().max(40).optional(),
        teamId: z.string().max(64).nullable().optional(),
      }), req.body);
      if (body.role && !(body.role in ROLE_PERMISSIONS)) throw notFound('Rôle inconnu');
      assertPorteeComptes(req, { role: (body.role as Role) ?? existant.role, teamId: body.teamId ?? existant.teamId });
      const account = container.accounts.modifier(username, { ...body, role: body.role as Role | undefined });
      audit(req, 'account.update', username, { role: body.role });
      return { account };
    });

    scoped.post('/admin/accounts/:username/reset', async (req) => {
      require(req, 'accounts:write');
      const { username } = req.params as { username: string };
      if (container.accounts.estProtege(username)) {
        throw forbidden('Compte défini dans la configuration du serveur — non modifiable depuis la console.');
      }
      const existant = container.accounts.get(username);
      if (!existant) throw notFound('Compte introuvable');
      assertPorteeComptes(req, { role: existant.role, teamId: existant.teamId });
      const res = container.accounts.reinitialiser(username);
      if (!res) throw notFound('Compte introuvable');
      audit(req, 'account.reset', username);
      return res;
    });

    scoped.post('/admin/accounts/:username/active', async (req) => {
      require(req, 'accounts:write');
      const { username } = req.params as { username: string };
      if (container.accounts.estProtege(username)) {
        throw forbidden('Compte défini dans la configuration du serveur — non modifiable depuis la console.');
      }
      const existant = container.accounts.get(username);
      if (!existant) throw notFound('Compte introuvable');
      assertPorteeComptes(req, { role: existant.role, teamId: existant.teamId });
      const body = parse(z.object({ active: z.boolean(), reason: z.string().max(200).optional() }), req.body);
      const { admin: account } = req as FastifyRequest & { admin: AdminAccount };
      if (!body.active && username === account.username) {
        throw forbidden('On ne désactive pas son propre compte — personne ne doit pouvoir se verrouiller dehors.');
      }
      const maj = body.active
        ? container.accounts.reactiver(username)
        : container.accounts.desactiver(username, body.reason ?? 'Non précisé');
      audit(req, body.active ? 'account.enable' : 'account.disable', username, { reason: body.reason });
      return { account: maj };
    });

    /**
     * Changement de son PROPRE mot de passe. Aucune permission particulière : tout
     * compte connecté doit pouvoir le faire, et c'est obligatoire après une création
     * ou une réinitialisation.
     */
    scoped.post('/admin/password', async (req, reply) => {
      const { admin: account } = req as FastifyRequest & { admin: AdminAccount };
      if (!account.username) {
        throw forbidden('Jeton statique : aucun mot de passe à changer.');
      }
      const body = parse(z.object({
        ancien: z.string().min(1).max(200),
        nouveau: z.string().min(10, 'Au moins 10 caractères').max(200),
      }), req.body);
      const res = container.accounts.changerMotDePasse(account.username, body.ancien, body.nouveau);
      if (res === 'ok') {
        audit(req, 'account.password_changed', account.username);
        return { ok: true };
      }
      reply.code(res === 'inconnu' ? 404 : 400);
      const messages: Record<string, string> = {
        ancien_invalide: 'Mot de passe actuel incorrect.',
        trop_court: 'Le nouveau mot de passe doit faire au moins 10 caractères.',
        identique: 'Le nouveau mot de passe doit être différent de l’ancien.',
        inconnu: 'Compte de configuration : le mot de passe se change côté serveur.',
      };
      return { error: messages[res] };
    });

    // --- Journal d'audit ---
    scoped.get('/admin/audit', async (req) => { require(req, 'audit:read'); return { entries: container.audit.list(200) }; });
  });
}
