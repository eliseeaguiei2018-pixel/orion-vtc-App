import { AJUSTEMENT_MAX, AJUSTEMENT_MIN, estimatePrice } from '../services/ride/pricing.js';
import { DeliveryServiceModule } from '../services/delivery/deliveryModule.js';
import { gammesServies } from '../drivers/store.js';
import { mediasSchema } from '../rental/medias.js';
import { exigerHumain } from '../gcp/securite.js';
import { Readable } from 'node:stream';
import { lotRoutes } from './lot.js';
import { misesAJourAdminRoutes } from '../mises-a-jour/admin.js';
import { simulateurAdminRoutes } from '../simulateur/admin.js';
import { basesOrionAdminRoutes } from '../driver-app/carte.js';
import { voixBordAdminRoutes } from '../rides/bienvenue.js';
import { voixHumaineAdminRoutes } from '../voix/routes.js';
import { servicesGoogleAdminRoutes } from '../google/routes.js';
import { nearestZone } from '../geo-ci/zones.js';
import { timingSafeEqual } from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { Container } from '../../container.js';
import { exigerAppareil } from '../appareils/routes.js';
import { parse } from '../../core/validate.js';
import { AppError, badRequest, notFound, unauthorized, forbidden } from '../../core/errors.js';
import { normalizePhone } from '../driver-app/auth.js';
import { JOURS_MAX, JOURS_PAR_DEFAUT } from './testeurs.js';
import { driverRoom, CONFIG_ROOM, DASHBOARD_ROOM } from '../realtime/hub.js';
import { AdminService, paginate } from './service.js';
import { can, resolveAccount, ROLE_PERMISSIONS, ROLE_LABEL, type AdminAccount, type Permission, type Role } from './roles.js';
import {
  authenticate, issueToken, verifyToken, bearerToken,
  lockedFor, recordLoginFailure, clearLoginFailures,
  verifyTotp, registerSession, touchSession, revokeSession, listSessions, isSessionInactive, adminUsers,
} from './auth.js';
import { config } from '../../config/index.js';
import { mesuresPlateforme, preparerCharge } from '../charge/service.js';
import {
  CSRF_COOKIE, CSRF_HEADER, SESSION_COOKIE, cookiesDeConnexion, cookiesDeDeconnexion,
  estEcriture, newCsrfToken, parseCookies,
} from './cookies.js';
import { SOS_PRESETS } from '../safety/service.js';
import type { CleDemande } from '../safety/agent-sos.js';
import { MOTIF_LABEL as IMMO_MOTIF_LABEL, VITESSE_COUPURE_MAX } from '../rental/telematique.js';
import { COUPURES, ECART_TOLERE, ORIGINE_LABEL, SORTIE_LABEL, totalComptage, type Comptage } from '../treasury/caisse.js';
import { TYPE_LABEL as CREW_TYPE_LABEL, STATUT_LABEL as CREW_STATUT_LABEL, TYPES_FINANCIERS, PLAFOND_AVANCE, PLAFOND_PRET, MAX_ECHEANCES, type TypeRequete } from '../crew/requests.js';
import { consoleForced, consoleReassigned } from '../driver-app/offers.js';
import { photoUrl } from '../driver-app/photo-url.js';
import { categorieDeFlotte } from '../rides/matching.js';
import { ROLES_HABILITABLES, STATUT_HABILITATION_LABEL, type ErreurHabilitation, type Habilitation } from '../dashboard/habilitations.js';
import { lieuDe } from '../maps/lieux.js';
import { moisValide, primeDuMois } from '../driver-app/activite.js';
import { emettreBillet } from './billets-ws.js';

/**
 * VOLUME : un export s'écrit par tranches de 2 000 lignes, en rendant la main au serveur
 * entre deux tranches. Un export d'un an ne bloque ni la console ni les applications, et
 * le fichier n'est jamais tenu en entier en mémoire.
 */
async function* parTranches(lignes: Iterable<string>, taille = 2000): AsyncGenerator<string> {
  let tampon: string[] = [];
  let premiere = true;
  for (const l of lignes) {
    tampon.push(l);
    if (tampon.length >= taille) {
      yield `${premiere ? '' : '\n'}${tampon.join('\n')}`;
      premiere = false;
      tampon = [];
      await new Promise((ok) => setImmediate(ok));
    }
  }
  if (tampon.length) yield `${premiere ? '' : '\n'}${tampon.join('\n')}`;
}


/** Rôles de direction : accès complet, 2FA exigible via ADMIN_REQUIRE_2FA. */
const EXEC_ROLES = new Set(['ceo', 'dg', 'daa', 'coo', 'super_admin']);

/**
 * Console Admin — centre de contrôle ORION (boîte noire).
 * Accès par RÔLE (RBAC) : chaque route exige une permission ; le rôle du compte
 * (résolu depuis x-admin-token) détermine ce qui est autorisé. Couches d'accès selon le poste.
 */
/**
 * Boîtier télématique : il présente le jeton partagé TELEMATIQUE_TOKEN (Bearer).
 * Sans jeton configuré, les remontées ne sont acceptées qu'en développement et en test.
 */
function authentifierBoitier(req: FastifyRequest): void {
  const attendu = config.TELEMATIQUE_TOKEN;
  if (!attendu) {
    if (config.NODE_ENV === 'production') {
      throw new AppError(503, 'TELEMATIQUE_NON_CONFIGUREE', 'Remontées des boîtiers indisponibles : TELEMATIQUE_TOKEN non configuré.');
    }
    return;
  }
  const m = /^Bearer\s+(.+)$/i.exec((req.headers.authorization ?? '').trim());
  const a = Buffer.from(m?.[1] ?? '');
  const b = Buffer.from(attendu);
  if (a.length !== b.length || !timingSafeEqual(a, b)) throw unauthorized('Boîtier télématique non reconnu');
}

export async function adminRoutes(app: FastifyInstance, container: Container): Promise<void> {
  // Connexion (public) : login + mot de passe [+ code 2FA] → session JWT signée.
  // Anti-brute-force : 5 échecs → compte verrouillé 15 minutes (journalisé).
  app.post('/admin/login', async (req, reply) => {
    const body = parse(z.object({
      username: z.string().min(1).max(80),
      password: z.string().min(1).max(200),
      code: z.string().max(12).optional(), // code TOTP (2FA)
    }), req.body);
    // Appareil enrôlé avec le code de synchronisation ORION (si la politique l'exige) :
    // vérifié AVANT le mot de passe, pour qu'un appareil inconnu ne puisse même pas
    // tester des identifiants.
    const appareil = exigerAppareil(container, req, body.username);
    // reCAPTCHA Enterprise (si configuré) : pas d'essais de mots de passe en série par un robot.
    await exigerHumain(container.securiteGoogle, req, 'connexion_console');
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
    container.audit.log({
      actor: account.name, role: account.role, action: needs2fa ? 'login.success_2fa' : 'login.success',
      details: appareil ? { appareil: appareil.nom, appareilId: appareil.id } : undefined,
    });
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
      // Session d'une personne (cookie ou Bearer) : l'appareil doit être enrôlé et non
      // révoqué si la politique l'exige. Un appareil révoqué perd l'accès à la requête
      // suivante, même avec une session encore valide. Le jeton statique d'automatisation
      // (secret serveur) n'est pas concerné.
      if (verified) exigerAppareil(container, req, account.username ?? account.name);
      (req as FastifyRequest & { admin: AdminAccount }).admin = account;
    });

    // Lectures groupées de la console : une requête au lieu d'une soixantaine.
    lotRoutes(scoped, app);

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

    // Mises à jour à chaud des apps : versions publiées, publication (direction).
    misesAJourAdminRoutes(scoped, container, require, audit);
    // Simulateur du marché (PDG seul) : chauffeurs et clients simulés vus par l'app cliente.
    simulateurAdminRoutes(scoped, container, require, audit);
    // Sièges et agences ORION : ORION Pro y guide les chauffeurs et livreurs de chaque zone.
    basesOrionAdminRoutes(scoped, container, require, audit);
    // Voix de bord : textes de l'accueil vocal du client (ORION Pro), retouchables par la direction.
    voixBordAdminRoutes(scoped, container, require, audit);
    voixHumaineAdminRoutes(scoped, container, require, audit);
    servicesGoogleAdminRoutes(scoped, container, require, audit);

    // Identité + permissions du compte connecté (le front adapte l'affichage).
    scoped.get('/admin/me', async (req) => {
      const { admin: account } = req as FastifyRequest & { admin: AdminAccount };
      const fiche = account.username ? container.accounts.get(account.username) : undefined;
      return {
        name: account.name,
        role: account.role,
        roleLabel: ROLE_LABEL[account.role],
        // Permissions EFFECTIVES : un manager habilité par la direction voit le tableau de bord.
        permissions: !can(account.role, 'dashboard:read') && container.habilitations.peutVoirTableau(account)
          ? [...ROLE_PERMISSIONS[account.role], 'dashboard:read']
          : ROLE_PERMISSIONS[account.role],
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

    scoped.get('/admin/overview', async (req) => {
      require(req, 'overview:read');
      const ov = admin.overview();
      // « En ligne » ne suffit pas : ce qui compte pour le dispatch, c'est d'avoir une
      // position récente. On distingue les joignables des muets, sinon le compteur
      // affiche 44 chauffeurs pendant que chaque commande part en « aucun chauffeur ».
      const presents = new Set((await container.geo.snapshot()).map((e) => e.id));
      const enService = container.drivers.list().filter((d) => d.availability === 'online' || d.availability === 'on_trip');
      const joignables = enService.filter((d) => presents.has(d.id)).length;
      return { ...ov, drivers: { ...ov.drivers, joignables, muets: enService.length - joignables } };
    });

    // TABLEAU DE BORD (interface à part, dashboard.html) : l'état de tout l'écosystème.
    // Le direct passe par /ws/dashboard ; cet appel donne l'état complet à l'instant.
    // TABLEAU DE BORD : de droit pour la direction, la trésorerie, la comptabilité et le
    // service informatique ; pour un manager, seulement sur habilitation accordée par la
    // direction. Tout autre accès est refusé, journalisé et signalé à la direction.
    const accesTableau = (req: FastifyRequest): void => {
      const { admin: account } = req as FastifyRequest & { admin: AdminAccount };
      if (container.habilitations.peutVoirTableau(account)) return;
      require(req, 'dashboard:read');
    };

    scoped.get('/admin/dashboard', async (req, reply) => {
      accesTableau(req);
      reply.header('cache-control', 'no-store');
      return container.tableau.etat();
    });

    // Objectifs financiers et niveau des commandes : les courbes du tableau de bord.
    scoped.get('/admin/dashboard/analyse', async (req, reply) => {
      accesTableau(req);
      reply.header('cache-control', 'no-store');
      return container.tableau.analyse();
    });

    // OBJECTIFS FINANCIERS : lus par toute la supervision, fixés par la direction
    // financière (finance:write). Chaque changement est journalisé avec l'ancienne valeur.
    scoped.get('/admin/objectifs', async (req) => {
      accesTableau(req);
      return { objectifs: container.objectifs.get() };
    });
    scoped.put('/admin/objectifs', async (req) => {
      require(req, 'finance:write');
      const montant = z.number().int().positive().max(100_000_000_000);
      const body = parse(z.object({ jour: montant, semaine: montant, mois: montant, annee: montant }).partial()
        .refine((o) => Object.keys(o).length > 0, 'Aucun objectif à modifier'), req.body);
      const avant = container.objectifs.get();
      const { admin: account } = req as FastifyRequest & { admin: AdminAccount };
      const objectifs = container.objectifs.mettreAJour(body, account.name);
      audit(req, 'objectifs.mise_a_jour', 'objectifs-financiers', {
        avant: { jour: avant.jour, semaine: avant.semaine, mois: avant.mois, annee: avant.annee }, apres: body,
      });
      // Les écrans du tableau de bord recalculent leurs courbes à l'instant.
      container.realtime.publish(DASHBOARD_ROOM, 'objectifs', { jour: objectifs.jour, semaine: objectifs.semaine, mois: objectifs.mois, annee: objectifs.annee });
      return { objectifs };
    });

    /* ============ HABILITATIONS AU TABLEAU DE BORD (managers) ============ */

    const ERREUR_HABILITATION: Record<ErreurHabilitation, [number, string]> = {
      role_non_habilitable: [400, 'Seul un manager peut recevoir une habilitation au tableau de bord.'],
      deja_en_cours: [409, 'Une demande est déjà en cours ou une habilitation déjà active pour ce compte.'],
      introuvable: [404, 'Habilitation introuvable.'],
      mauvais_statut: [409, 'Cette étape n’est pas possible au statut actuel de la demande.'],
      separation_des_taches: [403, 'Séparation des tâches : celui qui a transmis la demande ne peut pas l’accorder.'],
      sur_soi_meme: [403, 'Personne ne traite sa propre habilitation.'],
      date_passee: [400, 'La date de fin doit être dans le futur.'],
    };
    const resultatHabilitation = (reply: FastifyReply, r: Habilitation | ErreurHabilitation) => {
      if (typeof r === 'string') {
        const [code, message] = ERREUR_HABILITATION[r];
        reply.code(code);
        return { error: message, code: r };
      }
      return { habilitation: publierHabilitation(r) };
    };
    const publierHabilitation = (h: Habilitation) => ({
      ...h, roleLabel: ROLE_LABEL[h.role], statutLabel: STATUT_HABILITATION_LABEL[h.statut],
      expiree: h.statut === 'accordee' && container.habilitations.estExpiree(h),
    });
    /** Prévenir par la messagerie interne les comptes qui ont la permission donnée. */
    const prevenir = (req: FastifyRequest, permission: Permission, sujet: string, texte: string, sauf?: string) => {
      const { admin: account } = req as FastifyRequest & { admin: AdminAccount };
      // Comptes de configuration et de l'annuaire (actifs) : la direction peut venir des deux.
      for (const c of adminUsers()) {
        if (c.username === sauf || !can(c.role, permission) || c.role === 'super_admin') continue;
        container.staffComms.ecrire({ de: account.username ?? 'orion', deNom: account.name, a: c.username, aNom: c.name, sujet, texte, reponseAttendue: false });
      }
    };
    const prevenirManager = (req: FastifyRequest, h: Habilitation, sujet: string, texte: string) => {
      const { admin: account } = req as FastifyRequest & { admin: AdminAccount };
      container.staffComms.ecrire({ de: account.username ?? 'orion', deNom: account.name, a: h.username, aNom: h.nom, sujet, texte });
    };
    const dateFin = z.string().datetime({ offset: true }).or(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)).optional()
      .transform((v) => (v && v.length === 10 ? new Date(`${v}T23:59:59`).toISOString() : v));

    // Le manager connaît l'état de SA demande (sans aucun droit particulier).
    scoped.get('/admin/habilitations/moi', async (req) => {
      const { admin: account } = req as FastifyRequest & { admin: AdminAccount };
      const derniere = account.username ? container.habilitations.derniere(account.username) : undefined;
      return {
        acces: container.habilitations.peutVoirTableau(account),
        deDroit: can(account.role, 'dashboard:read'),
        habilitable: ROLES_HABILITABLES.includes(account.role) && Boolean(account.username),
        roleLabel: ROLE_LABEL[account.role],
        habilitation: derniere ? publierHabilitation(derniere) : null,
      };
    });

    // Étape 1 : le manager demande l'accès ; le service informatique est prévenu.
    scoped.post('/admin/habilitations/demande', async (req, reply) => {
      const { admin: account } = req as FastifyRequest & { admin: AdminAccount };
      const body = parse(z.object({ motif: z.string().trim().min(10, 'Expliquez en quelques mots pourquoi vous en avez besoin.').max(500) }), req.body);
      const r = container.habilitations.demander(account, body.motif);
      if (typeof r !== 'string') {
        audit(req, 'habilitation.demande', r.id, { username: r.username });
        prevenir(req, 'habilitations:write', 'Demande d’accès au tableau de bord',
          `${r.nom} (${ROLE_LABEL[r.role]}) demande l’accès au tableau de bord. Motif : ${r.motif}. À vérifier puis transmettre à la direction (console, section Habilitations).`);
      }
      return resultatHabilitation(reply, r);
    });

    // Liste des demandes, des managers habilitables et des rôles qui ont l'accès de droit.
    scoped.get('/admin/habilitations', async (req) => {
      require(req, 'habilitations:read');
      return {
        habilitations: container.habilitations.liste().map(publierHabilitation),
        managers: adminUsers()
          .filter((c) => ROLES_HABILITABLES.includes(c.role))
          .map((c) => ({ username: c.username, nom: c.name, role: c.role, roleLabel: ROLE_LABEL[c.role], service: container.accounts.get(c.username)?.service })),
        deDroit: (Object.keys(ROLE_PERMISSIONS) as Role[]).filter((r) => can(r, 'dashboard:read')).map((r) => ROLE_LABEL[r]),
      };
    });

    // Étape 1 bis : le service informatique inscrit un manager ; la demande part à la direction.
    scoped.post('/admin/habilitations', async (req, reply) => {
      require(req, 'habilitations:write');
      const body = parse(z.object({ username: z.string().min(2).max(60), motif: z.string().trim().min(10).max(500), expireLe: dateFin }), req.body);
      // Comptes actifs uniquement (configuration ou annuaire) : un compte désactivé n'y figure pas.
      const fiche = adminUsers().find((u) => u.username === body.username);
      if (!fiche) throw notFound('Compte introuvable ou désactivé');
      const { admin: account } = req as FastifyRequest & { admin: AdminAccount };
      const r = container.habilitations.inscrire({ username: fiche.username, nom: fiche.name, role: fiche.role }, body.motif, body.expireLe, account);
      if (typeof r !== 'string') {
        audit(req, 'habilitation.transmise', r.id, { username: r.username, expireLe: r.expireLe });
        prevenir(req, 'habilitations:approve', 'Habilitation au tableau de bord à décider',
          `Le service informatique transmet la demande de ${r.nom} (${ROLE_LABEL[r.role]}). Motif : ${r.motif}. À accorder ou refuser (console, section Habilitations).`, account.username);
      }
      return resultatHabilitation(reply, r);
    });

    // Étape 2 : le service informatique transmet une demande de manager à la direction.
    scoped.post('/admin/habilitations/:id/transmettre', async (req, reply) => {
      require(req, 'habilitations:write');
      const { id } = req.params as { id: string };
      const body = parse(z.object({ expireLe: dateFin, note: z.string().max(300).optional() }), req.body ?? {});
      const { admin: account } = req as FastifyRequest & { admin: AdminAccount };
      const r = container.habilitations.transmettre(id, account, body.expireLe, body.note);
      if (typeof r !== 'string') {
        audit(req, 'habilitation.transmise', r.id, { username: r.username, expireLe: r.expireLe });
        prevenir(req, 'habilitations:approve', 'Habilitation au tableau de bord à décider',
          `Le service informatique transmet la demande de ${r.nom} (${ROLE_LABEL[r.role]}). Motif : ${r.motif}. À accorder ou refuser (console, section Habilitations).`, account.username);
      }
      return resultatHabilitation(reply, r);
    });

    // Étape 3 : la direction accorde ou refuse (jamais celui qui a transmis).
    scoped.post('/admin/habilitations/:id/decision', async (req, reply) => {
      require(req, 'habilitations:approve');
      const { id } = req.params as { id: string };
      const body = parse(z.object({ accorder: z.boolean(), raison: z.string().trim().max(300).optional() })
        .refine((b) => b.accorder || (b.raison && b.raison.length >= 5), 'Un refus doit être motivé.'), req.body);
      const { admin: account } = req as FastifyRequest & { admin: AdminAccount };
      const r = container.habilitations.statuer(id, body.accorder, account, body.raison);
      if (typeof r !== 'string') {
        audit(req, body.accorder ? 'habilitation.accordee' : 'habilitation.refusee', r.id, { username: r.username, raison: body.raison });
        prevenirManager(req, r, body.accorder ? 'Accès au tableau de bord accordé' : 'Accès au tableau de bord refusé',
          body.accorder
            ? `La direction vous a accordé l’accès au tableau de bord${r.expireLe ? ` jusqu’au ${new Date(r.expireLe).toLocaleDateString('fr-FR')}` : ''}.`
            : `La direction a refusé votre accès au tableau de bord. Motif : ${body.raison}.`);
      }
      return resultatHabilitation(reply, r);
    });

    // Révocation (service informatique ou direction), toujours motivée.
    scoped.post('/admin/habilitations/:id/revoquer', async (req, reply) => {
      const { admin: account } = req as FastifyRequest & { admin: AdminAccount };
      if (!can(account.role, 'habilitations:approve')) require(req, 'habilitations:write');
      const { id } = req.params as { id: string };
      const body = parse(z.object({ raison: z.string().trim().min(5, 'Une révocation doit être motivée.').max(300) }), req.body);
      const r = container.habilitations.revoquer(id, account, body.raison);
      if (typeof r !== 'string') {
        audit(req, 'habilitation.revoquee', r.id, { username: r.username, raison: body.raison });
        prevenirManager(req, r, 'Accès au tableau de bord retiré', `Votre accès au tableau de bord a été retiré. Motif : ${body.raison}.`);
      }
      return resultatHabilitation(reply, r);
    });

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
          maxTier: z.enum(['argent', 'or', 'diamant']).optional(),
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
        category: z.string().min(2).max(20).default('argent'),
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
      const rides = container.rides.listByCorporate(id).filter((r) => r.createdAt.startsWith(month));
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
      // Toutes les alertes ouvertes + les 300 dernières closes : l'historique se lit dossier par dossier.
      return { alerts: container.safety.list(300).map((a) => ({ ...a, ...usagerDeAlerte(a.userId) })) };
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
      // Déviations et immobilisations ne concernent que les courses en cours.
      for (const r of container.rides.listActives()) {
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
      const alerts = container.safety.triage(300).map((a) => ({
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

    /**
     * Demande de l'agent automatique TRAITÉE par l'opérateur : chauffeur joint, course
     * arrêtée, client rappelé, véhicule de remplacement envoyé. La personne en détresse le
     * voit aussitôt. Les services de secours, eux, se suivent par le journal des appels.
     */
    scoped.post('/admin/sos/:id/demandes/:cle/traiter', async (req) => {
      require(req, 'alerts:write');
      const { id, cle } = req.params as { id: string; cle: string };
      const { admin: account } = req as FastifyRequest & { admin: AdminAccount };
      const alert = container.safety.traiterDemande(id, cle as CleDemande, account.name);
      if (!alert) throw notFound('Demande introuvable ou déjà traitée');
      audit(req, 'sos.demande.traitee', id, { cle });
      return { alert };
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
      // Vitesse sur le VRAI intervalle entre les deux derniers points. Avant, l'écart
      // était supposé d'une seconde : avec un point toutes les 2 s, l'agent lisait le
      // double de la vitesse réelle. Sans horodatage ou sans point récent : pas de chiffre.
      let speedEstimateKmh: number | null = null;
      const [avant, dernier] = trace.slice(-2);
      if (avant?.t && dernier?.t && dernier.t > avant.t && Date.now() - dernier.t < 30_000) {
        const { haversineMeters } = await import('../../core/geo.js');
        const v = Math.round((haversineMeters(avant, dernier) / ((dernier.t - avant.t) / 1000)) * 3.6);
        // Au-delà de 250 km/h, c'est un saut de position GPS, pas une vitesse : l'agent
        // ne doit pas lire « 700 km/h ». Pas de chiffre plutôt qu'un chiffre faux.
        speedEstimateKmh = v <= 250 ? v : null;
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
          // Photo du chauffeur (adresse signée) : l'agent SAMU la décrit aux secours.
          photoUrl: photoUrl(driver),
          licenseNo: driver.licenseNo ?? null, birthDate: driver.birthDate ?? null,
          phoneBatteryPct: pseudoBatt(driver.id), batteryPct: driver.batteryPct ?? null,
        } : null,
        passenger: {
          id: ride?.clientId ?? alert.userId,
          name: client?.name ?? null, phone: client?.phone ?? null,
          // Photo du passager : reconnaître la personne à retrouver, la décrire à la police.
          photo: client?.photo ?? null,
          phoneBatteryPct: pseudoBatt(ride?.clientId ?? alert.userId),
          lastRides: container.rides.listByClient(ride?.clientId ?? alert.userId).slice(0, 5)
            .map((r) => ({ id: r.id, status: r.status, createdAt: r.createdAt })),
        },
        /** ORION Assurance : le dossier existe-t-il ? (son contenu passe par une route dédiée, journalisée) */
        assurance: { inscrit: container.dossiers.estInscrit(ride?.clientId ?? alert.userId) },
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
     * ORION ASSURANCE : DOSSIER DE PREMIERS SECOURS, en urgence seulement.
     *
     * Conditions imposées ici : permission médicale, alerte EN COURS (ni close ni
     * annulée), et c'est l'agent qui a PRIS EN CHARGE l'alerte qui la consulte. La
     * consultation est inscrite dans le dossier du client (il voit qui l'a ouvert) et
     * au journal d'audit ; une tentative hors de ces conditions est refusée.
     */
    scoped.get('/admin/sos/:id/dossier-medical', async (req, reply) => {
      require(req, 'medical:read');
      const { id } = req.params as { id: string };
      const { admin: account } = req as FastifyRequest & { admin: AdminAccount };
      const alert = container.safety.get(id);
      if (!alert) throw notFound('Alerte introuvable');
      if (alert.status === 'resolved' || alert.status === 'cancelled' || alert.sealed) {
        audit(req, 'assurance.consultation_refusee', id, { raison: 'alerte_close' });
        throw forbidden('Alerte close : le dossier médical n’est plus accessible.');
      }
      if (alert.agent !== account.name) {
        audit(req, 'assurance.consultation_refusee', id, { raison: 'non_gestionnaire' });
        throw forbidden('Prenez d’abord l’alerte en charge : seul l’agent gestionnaire consulte le dossier médical.');
      }
      const ride = alert.rideId ? container.rides.get(alert.rideId) : undefined;
      const clientId = ride?.clientId ?? alert.userId;
      if (!container.dossiers.disponible) throw new AppError(503, 'ASSURANCE_INDISPONIBLE', 'Dossiers médicaux indisponibles (clé de chiffrement absente).');
      const fiche = container.dossiers.lirePourUrgence(clientId, account.name, id);
      reply.header('cache-control', 'no-store, max-age=0');
      if (!fiche) return { inscrit: false, fiche: null };
      audit(req, 'assurance.consultation_urgence', clientId, { alerte: id });
      container.messages?.envoyerSysteme(clientId, {
        titre: 'Votre dossier ORION Assurance a été consulté',
        texte: `${account.name}, de la supervision ORION, a ouvert votre dossier de premiers secours pendant votre alerte, pour vous porter secours plus vite.`,
        type: 'info',
      });
      return { inscrit: true, fiche };
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
      // Un service de SECOURS (SAMU, police, pompiers) est en plus annoncé à
      // l'usager en direct : c'est la seule information qui le rassure vraiment.
      const fiche = body.contactId ? container.contacts.actifs().find((c) => c.id === body.contactId) : undefined;
      if (fiche?.categorie === 'secours') {
        container.safety.secoursSollicite(id, { entryId: entry.id, contactId: fiche.id, service: fiche.label, numero: entry.numero, canal: entry.canal });
      } else {
        if (!alert.dispatchedTo.includes(entry.label)) alert.dispatchedTo.push(entry.label);
        // Dépanneur ou garage joint : la demande de l'agent automatique est satisfaite.
        if (fiche) container.safety.contactPartenaire(id, fiche.id, account.name);
      }
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
      // Sans effet si l'appel ne visait pas un service de secours.
      container.safety.issueSecours(id, entryId, body.issue);
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
            argent: num.optional(), or: num.optional(), diamant: num.optional(),
          }).partial().optional(),
          // Majoration de l'Or et du Diamant par rapport à l'Argent, en pour cent du prix.
          majorationsPct: z.object({ or: z.number().min(0).max(300), diamant: z.number().min(0).max(300) }).partial().optional(),
          // Même majoration quand la course sort d'Abidjan (10 % / 20 % par défaut).
          majorationsPctHorsAbidjan: z.object({ or: z.number().min(0).max(300), diamant: z.number().min(0).max(300) }).partial().optional(),
          // Montant de chaque péage (pont HKB, 4ᵉ pont, Grand-Bassam…).
          peages: z.array(z.object({ id: z.string().max(24), montant: z.number().min(0).max(20_000) })).max(20).optional(),
          // Mise à disposition à l'heure (Abidjan).
          miseADisposition: z.object({
            tarifHeure: z.number().min(500).max(200_000), minHeures: z.number().min(0.5).max(12), maxHeures: z.number().min(1).max(24),
          }).partial().optional(),
          // Frais annexes & pénalités (session Tarification).
          freeWaitMinutes: z.number().min(0).max(30).optional(),
          cancelGraceMinutes: z.number().min(0).max(30).optional(),
          cancelFee: z.number().min(0).max(50_000).optional(),
          cleaningLight: z.number().min(0).max(100_000).optional(),
          cleaningMajor: z.number().min(0).max(500_000).optional(),
          longPickupPerKm: z.number().min(0).max(2000).optional(),
          longPickupThresholdKm: z.number().min(0).max(50).optional(),
          ajustementPct: z.number().min(-50).max(100).optional(),
          // Arrêt en course : F CFA par minute (arrêt prévu ou demandé par le client).
          arretParMin: z.number().min(0).max(1000).optional(),
          // Approche du chauffeur comprise dans le prix (offerte jusqu'au seuil).
          approche: z.object({
            actif: z.boolean(), offerteKm: z.number().min(0).max(30), offerteMin: z.number().min(0).max(60),
            parKm: z.number().min(0).max(2000), parMin: z.number().min(0).max(500),
            // Montant maximal (F hors taxes) que l'approche peut ajouter au prix d'une course.
            plafond: z.number().min(0).max(20_000),
            // Vitesse moyenne d'approche (km/h, trafic fluide) : temps annoncé au client.
            vitesseKmh: z.number().min(10).max(90),
          }).partial().optional(),
          // Trafic sur l'itinéraire : heures de pointe d'Abidjan, tronçons denses et embouteillés,
          // points de blocage traversés, plafond.
          trafic: z.object({
            actif: z.boolean(),
            densePct: z.number().min(0).max(50), embouteillagePct: z.number().min(0).max(80),
            parBouchonPct: z.number().min(0).max(20), maxBouchons: z.number().int().min(0).max(10),
            plafondPct: z.number().min(0).max(100),
            pointeMatin: z.tuple([z.string().regex(/^\d{2}:\d{2}$/), z.string().regex(/^\d{2}:\d{2}$/)]),
            pointeSoir: z.tuple([z.string().regex(/^\d{2}:\d{2}$/), z.string().regex(/^\d{2}:\d{2}$/)]),
            nuit: z.tuple([z.string().regex(/^\d{2}:\d{2}$/), z.string().regex(/^\d{2}:\d{2}$/)]),
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
        minStandard: z.enum(['argent', 'or', 'diamant']).optional(),
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
        maxEtaMinutes: z.number().min(2).max(120).optional(),
        offerTimeoutSec: z.number().min(10).max(15).optional(),
        surgeEnabled: z.boolean().optional(),
        surgeCapGreen: z.number().min(1).max(2).optional(),
        waitFeePerMin: z.number().min(0).max(1000).optional(),
        // Rayons évolutifs + mode d'offre + pondération scoring + priorisation verte.
        radiusKm: z.number().min(0.5).max(10).optional(),
        radiusMaxKm: z.number().min(1).max(50).optional(),
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
        maxEtaMinutes: z.number().min(2).max(120).optional(),
        radiusMaxKm: z.number().min(1).max(50).optional(),
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
        const match = await container.matching.findDriver(ride.origin, categorieDeFlotte(ride.serviceType, ride.quote.category));
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

    // --- Appareils enrôlés avec le code de synchronisation ORION ---
    scoped.get('/admin/appareils', async (req) => {
      require(req, 'sessions:read');
      return { appareils: container.appareils.liste(), exige: config.APPAREILS_EXIGES, configure: container.appareils.configure };
    });

    /** Appareil perdu, volé, ou employé parti : l'accès est coupé dès la requête suivante. */
    scoped.post('/admin/appareils/:id/revoquer', async (req) => {
      require(req, 'sessions:write');
      const { id } = req.params as { id: string };
      const { admin: account } = req as FastifyRequest & { admin: AdminAccount };
      const appareil = container.appareils.revoquer(id, account.name);
      if (!appareil) throw notFound('Appareil introuvable');
      audit(req, 'appareil.revoque', id, { nom: appareil.nom, plateforme: appareil.plateforme });
      return { appareil };
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

    // Application console (téléphone) : billet à usage unique pour ouvrir un canal temps réel.
    scoped.post('/admin/ws-billet', async (req) => {
      const { admin: account } = req as FastifyRequest & { admin: AdminAccount & { jti?: string } };
      const jwt = bearerToken(req.headers['authorization'] as string | undefined);
      const session = verifyToken(parseCookies(req.headers['cookie'] as string | undefined)[SESSION_COOKIE]) ?? verifyToken(jwt);
      return emettreBillet({ ...account, jti: session?.jti });
    });

    /**
     * ATTRIBUTION PAR ORION (chauffeurs salariés) : le chauffeur ne saisit que ses
     * informations personnelles ; ORION lui attribue sa gamme, son véhicule (modèle,
     * plaque, couleur, motorisation) et, au besoin, un matricule. Avec `valider`, le
     * dossier passe « actif » en même temps : le chauffeur peut se mettre en ligne. L'app
     * du chauffeur reçoit la fiche à jour en direct.
     */
    scoped.post('/admin/drivers/:id/attribution', async (req, reply) => {
      require(req, 'drivers:write');
      const { id } = req.params as { id: string };
      assertManagerScope(req, id);
      const body = parse(z.object({
        category: z.enum(['argent', 'or', 'diamant', 'moto', 'cargo']).optional(),
        // Gammes servies en plus de celle du véhicule (le PDG ouvre au chauffeur d'autres gammes).
        categories: z.array(z.enum(['argent', 'or', 'diamant'])).max(3).optional(),
        vehicleModel: z.string().trim().min(2).max(60).optional(),
        vehiclePlate: z.string().trim().min(3).max(15).optional(),
        vehicleColor: z.string().trim().min(3).max(20).optional(),
        engine: z.enum(['electric', 'hybrid']).optional(),
        batteryKwh: z.number().min(0).max(300).optional(),
        matricule: z.string().trim().regex(/^[A-Za-z0-9-]{4,24}$/).optional(),
        valider: z.boolean().optional(),
      }), req.body ?? {});
      const d = container.drivers.get(id);
      if (!d) throw notFound('Chauffeur introuvable');
      if (body.matricule && body.matricule !== d.matricule
        && container.drivers.list().some((x) => x.id !== id && x.matricule.toLowerCase() === body.matricule!.toLowerCase())) {
        reply.code(409);
        return { error: `Le matricule ${body.matricule} est déjà attribué à un autre chauffeur.` };
      }
      if (body.valider && d.kycStatus === 'suspended') {
        reply.code(409);
        return { error: 'Chauffeur suspendu : réactivez-le avant de valider son dossier.' };
      }
      const avant = { category: d.category, categories: d.categories ?? [], vehicleModel: d.vehicleModel, vehiclePlate: d.vehiclePlate, matricule: d.matricule, kycStatus: d.kycStatus };
      if (body.category) d.category = body.category;
      if (body.categories) d.categories = d.category === 'moto' || d.category === 'cargo' ? [] : [...new Set(body.categories)].filter((g) => g !== d.category);
      if (body.vehicleModel) d.vehicleModel = body.vehicleModel;
      if (body.vehiclePlate) d.vehiclePlate = body.vehiclePlate.toUpperCase();
      if (body.vehicleColor) d.vehicleColor = body.vehicleColor;
      if (body.engine) d.engine = body.engine;
      if (body.batteryKwh !== undefined) d.batteryKwh = body.batteryKwh;
      if (body.matricule) d.matricule = body.matricule.toUpperCase();
      if (body.valider) { d.kycStatus = 'active'; d.suspensionReason = undefined; }
      container.drivers.persist(id);
      // En ligne : l'index géo prend tout de suite les nouvelles gammes (offres dès maintenant).
      if (body.categories && d.availability !== 'offline') {
        const pos = await container.geo.position?.(id);
        if (pos) await container.geo.upsert({ id, lat: pos.lat, lng: pos.lng, meta: { category: d.category, categories: gammesServies(d) } });
      }
      audit(req, 'driver.attribution', id, { avant, apres: { category: d.category, categories: d.categories ?? [], vehicleModel: d.vehicleModel, vehiclePlate: d.vehiclePlate, matricule: d.matricule, kycStatus: d.kycStatus } });
      if (body.valider && avant.kycStatus !== 'active') {
        container.notifications.notify({ driverId: id }, 'Dossier validé',
          `Bienvenue chez ORION. Matricule ${d.matricule}${d.vehiclePlate ? ` · véhicule ${d.vehiclePlate}` : ''}. Vous pouvez vous mettre en ligne.`);
      }
      return {
        driver: {
          id: d.id, name: d.name, matricule: d.matricule, category: d.category, categories: gammesServies(d), kycStatus: d.kycStatus,
          vehicleModel: d.vehicleModel ?? null, vehiclePlate: d.vehiclePlate ?? null, vehicleColor: d.vehicleColor ?? null,
          engine: d.engine ?? null, batteryKwh: d.batteryKwh ?? null,
        },
      };
    });

    /* ------------------- Prime de performance (chauffeurs salariés) ------------------- */
    scoped.get('/admin/primes', async (req) => {
      require(req, 'drivers:read');
      const q = parse(z.object({ mois: z.string().max(7).optional() }), req.query ?? {});
      const lignes = container.drivers.list()
        .filter((d) => d.appLinkedAt || d.kycStatus === 'active' || d.kycStatus === 'approved')
        .map((d) => {
          const p = primeDuMois(container, d.id, q.mois);
          return {
            id: d.id, name: d.name, matricule: d.matricule, category: d.category,
            courses: p.courses, heures: p.activite.heuresService, note: p.activite.note.moyenne,
            tauxAcceptation: p.activite.offres.tauxAcceptation, annulations: p.activite.annulations,
            palier: p.palier, conditionsTenues: p.conditions.every((c) => c.ok), montant: p.montantEstime,
          };
        })
        .sort((a, b) => b.montant - a.montant || b.courses - a.courses)
        .slice(0, 500);
      return { mois: moisValide(q.mois), grille: container.settings.getOps().prime, chauffeurs: lignes, total: lignes.reduce((s, l) => s + l.montant, 0) };
    });

    scoped.get('/admin/drivers/:id/prime', async (req) => {
      require(req, 'drivers:read');
      const { id } = req.params as { id: string };
      if (!container.drivers.get(id)) throw notFound('Chauffeur introuvable');
      const q = parse(z.object({ mois: z.string().max(7).optional() }), req.query ?? {});
      return { prime: primeDuMois(container, id, q.mois) };
    });

    scoped.put('/admin/primes/grille', async (req) => {
      require(req, 'pricing:write');
      const palier = z.object({ courses: z.number().int().min(1).max(2000), montant: z.number().int().min(0).max(5_000_000) });
      const body = parse(z.object({
        actif: z.boolean().optional(),
        paliers: z.array(palier).min(1).max(8).optional(),
        noteMin: z.number().min(0).max(5).optional(),
        tauxAcceptationMin: z.number().int().min(0).max(100).optional(),
        annulationsMax: z.number().int().min(0).max(100).optional(),
        bonusExcellence: z.object({ note: z.number().min(0).max(5), minNotes: z.number().int().min(0).max(1000), montant: z.number().int().min(0).max(5_000_000) }).partial().optional(),
        bonusAssiduite: z.object({ heures: z.number().int().min(0).max(744), montant: z.number().int().min(0).max(5_000_000) }).partial().optional(),
      }), req.body ?? {});
      const actuelle = container.settings.getOps().prime;
      const ops = container.settings.updateOps({
        prime: {
          ...actuelle, ...body,
          bonusExcellence: { ...actuelle.bonusExcellence, ...(body.bonusExcellence ?? {}) },
          bonusAssiduite: { ...actuelle.bonusAssiduite, ...(body.bonusAssiduite ?? {}) },
        },
      });
      audit(req, 'primes.grille', 'prime', { grille: ops.prime });
      return { grille: ops.prime };
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
      // Les photos ne voyagent pas dans les listes (des dizaines de Ko chacune) :
      // elles s'affichent dans la fiche du client.
      return { clients: items.map(({ photo, ...c }) => ({ ...c, hasPhoto: Boolean(photo) })), ...meta };
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
      // Statuer sur une demande financière est un droit à part : la direction
      // financière (DAF, CFO) et la direction générale l'ont, pas la trésorerie.
      // Compter l'argent et décider de le sortir sont deux métiers.
      require(req, 'finance:write');
      const { id } = req.params as { id: string };
      const body = parse(z.object({ decision: z.enum(['approve', 'reject', 'info']), note: z.string().max(300).optional() }), req.body);
      const { admin: account } = req as FastifyRequest & { admin: AdminAccount };
      // SÉPARATION DES TÂCHES : le DAF dépose des demandes comme tout le monde,
      // mais il ne signe pas les siennes. Sans cette garde, le contrôle interne
      // repose sur la seule honnêteté d'une personne.
      const existant = container.expenses.get(id);
      if (existant && (existant.requesterId === account.username || existant.requesterName === account.name)) {
        throw forbidden('On ne statue pas sur sa propre demande — faites-la valider par un autre dirigeant.');
      }
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

    // --- Vitrine des véhicules : photos et vidéos réelles (Mariage, Location Signature) ---
    scoped.get('/admin/medias/vehicules', async (req) => { require(req, 'services:read'); return container.mediasVehicules.etatComplet(); });

    scoped.put('/admin/medias/vehicules', async (req) => {
      require(req, 'services:write');
      const body = parse(z.object({ medias: mediasSchema }), req.body);
      const medias = container.mediasVehicules.remplacer(body.medias);
      audit(req, 'medias.vehicules.update', undefined, { entrees: medias.length });
      return { medias };
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
      // Période exportée (31 jours par défaut, 366 au plus) : un export illimité bloquerait le serveur.
      const q = parse(z.object({ jours: z.coerce.number().int().min(1).max(366).optional() }), req.query ?? {});
      return reply.send(Readable.from(parTranches(admin.ridesCsvLignes(q.jours))));
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
    /**
     * MESSAGERIE ORION → CLIENTS. Un client précis (identifiant ou téléphone), tous
     * les clients en course, ou tous les clients. Type « controle » = « votre course
     * se passe-t-elle bien ? » avec réponses rapides ; une réponse « pas en sécurité »
     * lève une alerte SOS dans la file SAMU.
     */
    scoped.get('/admin/messages', async (req) => {
      require(req, 'notify:read');
      const messages = container.messages.recents(150).map((m) => {
        const c = container.clients.get(m.clientId);
        return { ...m, client: c ? { name: c.name ?? null, phone: c.phone ?? null } : null };
      });
      const reponses = messages.filter((m) => m.reponse);
      return {
        messages,
        stats: {
          envoyes: messages.length,
          lus: messages.filter((m) => m.luLe).length,
          reponses: reponses.length,
          alertes: reponses.filter((m) => m.reponses.find((r) => r.code === m.reponse?.code)?.alerte).length,
        },
      };
    });

    scoped.post('/admin/messages', async (req) => {
      require(req, 'notify:write');
      const body = parse(z.object({
        cible: z.enum(['client', 'en_course', 'tous']),
        clientId: z.string().max(64).optional(),
        telephone: z.string().max(20).optional(),
        type: z.enum(['info', 'consigne', 'controle']),
        titre: z.string().trim().min(3).max(80),
        texte: z.string().trim().min(3).max(500),
      }), req.body);
      const { admin: account } = req as FastifyRequest & { admin: AdminAccount };
      const enCours = container.rides.listActives().filter((r) => ['accepted', 'driver_en_route', 'arrived', 'in_progress'].includes(r.status));
      let destinataires: Array<{ clientId: string; rideId?: string }> = [];
      if (body.cible === 'client') {
        const tel = body.telephone?.replace(/\s/g, '');
        const client = body.clientId ? container.clients.get(body.clientId)
          : tel ? container.clients.findByVerifiedPhone(tel.startsWith('+') ? tel : `+225${tel}`) : undefined;
        if (!client) throw notFound('Client introuvable (identifiant ou numéro vérifié)');
        const course = enCours.find((r) => r.clientId === client.id);
        destinataires = [{ clientId: client.id, rideId: course?.id }];
      } else if (body.cible === 'en_course') {
        destinataires = enCours.map((r) => ({ clientId: r.clientId, rideId: r.id }));
      } else {
        destinataires = container.clients.list().map((c) => ({ clientId: c.id, rideId: enCours.find((r) => r.clientId === c.id)?.id }));
      }
      if (body.type === 'controle') destinataires = destinataires.filter((d) => d.rideId);
      const envoyes = destinataires.map((d) => container.messages.envoyer(d.clientId, {
        type: body.type, titre: body.titre, texte: body.texte, auteur: account.name, rideId: d.rideId,
      }));
      audit(req, 'messages.envoi', body.cible, { type: body.type, destinataires: envoyes.length });
      return { envoyes: envoyes.length, messages: envoyes };
    });

    // Contrôle de sécurité d'UNE course, à la demande (supervision, dispatch).
    scoped.post('/admin/rides/:id/controle', async (req) => {
      require(req, 'alerts:write');
      const { id } = req.params as { id: string };
      const ride = container.rides.get(id);
      if (!ride) throw notFound('Course introuvable');
      const { admin: account } = req as FastifyRequest & { admin: AdminAccount };
      const message = container.messages.controleSecurite(ride.clientId, ride.id, account.name);
      audit(req, 'messages.controle', id);
      return { message };
    });

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
      // Tout compte connecté a un poste de travail, y compris un chauffeur qui n'a
      // que `crew:self` : c'est sa seule vue de la plateforme, lui en interdire
      // l'accès reviendrait à lui donner un compte qui n'ouvre sur rien.
      const { admin: a } = req as FastifyRequest & { admin: AdminAccount };
      if (!can(a.role, 'overview:read') && !can(a.role, 'crew:self')) require(req, 'overview:read');
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
      // VOLUME : seule la page demandée est fabriquée ; les totaux couvrent tout le
      // filtre (une page de tableau ne doit jamais donner une fausse idée du total).
      return container.executive.pageLivre({
        depuisJours: q.days ?? 30,
        sens: q.sens,
        categorie: q.categorie as never,
        page: Math.max(1, q.page ?? 1),
        limit: q.limit ?? 50,
      });
    });

    /** Export comptable du grand livre (tableur / expert-comptable). */
    scoped.get('/admin/executive/livre.csv', async (req, reply) => {
      require(req, 'executive:read');
      const q = parse(z.object({ days: z.coerce.number().int().min(1).max(365).optional() }), req.query);
      const flux = container.executive.fluxLivre(q.days ?? 90);
      const entete = 'date;sens;categorie;libelle;montant_fcfa;en_caisse;contrepartie;reference;statut';
      let lignes = 0;
      function* texte() {
        yield entete;
        for (const m of flux) {
          lignes += 1;
          yield [
            m.at, m.sens, m.categorie, csvCell(m.libelle), String(m.montant),
            m.enCaisse ? 'oui' : 'non', csvCell(m.contrepartie ?? ''), csvCell(m.reference ?? ''), csvCell(m.statut ?? ''),
          ].join(';');
        }
        audit(req, 'executive.export', undefined, { lignes });
      }
      reply.header('content-type', 'text/csv; charset=utf-8');
      reply.header('content-disposition', 'attachment; filename="orion-grand-livre.csv"');
      return reply.send(Readable.from(parTranches(texte())));
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
        `Durée : ${r.duree}${r.heures ? ` (${r.heures} h)` : ''}${r.mois ? ` — ${r.mois} mois${r.renouvelable ? ', renouvelable' : ', non renouvelable'}` : ''}`,
        r.mensualite ? `Mensualité : ${r.mensualite} F CFA TTC` : '',
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
            remiseMois3: nombre.optional(), remiseMois6: nombre.optional(), remiseMois12: nombre.optional(),
            moisMinEntreprise: nombre.optional(),
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

    /* =================== TÉLÉMATIQUE DES VÉHICULES DE LOCATION ===================
     *
     * Confier une limousine présidentielle à quelqu'un qu'on a vu une fois,
     * sans savoir où elle est, est un risque qu'aucun loueur sérieux ne prend.
     *
     * Mais on ne suit pas un client, on suit un VÉHICULE : la position n'est
     * consultable que pendant une location active ou un vol déclaré, et chaque
     * consultation est journalisée au nom de l'agent.
     */

    /** Locations en cours : hors de là, personne n'a à regarder où est la voiture. */
    const locationActive = (vehiculeId: string) => container.rental.list()
      .find((r) => r.vehicle.id === vehiculeId
        && (r.status === 'en_cours' || r.status === 'confirmee')
        && Date.parse(r.fin) > Date.now() - 86_400_000);

    scoped.get('/admin/rental/flotte/positions', async (req) => {
      require(req, 'rental:read');
      const { admin: account } = req as FastifyRequest & { admin: AdminAccount };
      const enCours = container.rental.list().filter((r) => r.status === 'en_cours' || r.status === 'confirmee');
      const vehicules = enCours.map((r) => {
        const position = container.telematique.position(r.vehicle.id, {
          par: account.name, motif: 'Supervision de la flotte en location', reservationId: r.id,
        });
        const immo = container.telematique.immobilisationActive(r.vehicle.id);
        const vol = container.telematique.volActif(r.vehicle.id);
        return {
          reservationId: r.id,
          vehiculeId: r.vehicle.id,
          vehiculeNom: r.vehicle.name,
          statut: r.status,
          debut: r.debut, fin: r.fin,
          locataire: {
            nom: r.contact?.nom ?? r.societe?.nom ?? r.userId,
            telephone: r.contact?.telephone ?? null,
            societe: r.societe?.nom ?? null,
          },
          chauffeurId: r.driverId ?? null,
          position,
          immobilisation: immo ? { id: immo.id, etat: immo.etat, motif: immo.motif, motifLabel: IMMO_MOTIF_LABEL[immo.motif] } : null,
          vol: vol ? { id: vol.id, statut: vol.statut, declareLe: vol.declareLe } : null,
          /** Vrai si le véhicule n'a rien remonté depuis plus d'une heure. */
          silencieux: !position || Date.now() - Date.parse(position.at) > 3_600_000,
        };
      });
      // Le nom commercial, pas l'identifiant de flotte : « Huawei AITO M9 » se dicte
      // au téléphone à un commissariat, « aito-m9 » non.
      const nommer = (v: { vehiculeId: string }) => ({
        ...v,
        vehiculeNom: container.rentalSettings.vehicule(v.vehiculeId)?.name ?? v.vehiculeId,
      });
      return {
        vehicules,
        vols: container.telematique.vols_({ actifs: true }).map(nommer),
        immobilisations: container.telematique.immobilisations_({ actives: true }).map(nommer),
        vitesseCoupureMax: VITESSE_COUPURE_MAX,
        motifs: IMMO_MOTIF_LABEL,
      };
    });

    /** Remontée du boîtier embarqué (ou de l'adaptateur constructeur). */
    app.post('/rental/telematique/:vehiculeId', async (req) => {
      // Seul un boîtier reconnu remonte une position : une position falsifiée masquerait
      // un vol, ou ferait appliquer une coupure moteur armée sur un véhicule qui roule.
      authentifierBoitier(req);
      const { vehiculeId } = req.params as { vehiculeId: string };
      const body = parse(z.object({
        lat: z.number().min(-90).max(90),
        lng: z.number().min(-180).max(180),
        vitesseKmh: z.number().min(0).max(400),
        cap: z.number().min(0).max(360).optional(),
        contact: z.boolean(),
        batteriePct: z.number().min(0).max(100).optional(),
        autonomieKm: z.number().min(0).max(2000).optional(),
      }), req.body);
      // Le lieu, comme pour une alerte SOS : quartier réel et commune (limites OSM) —
      // « Riviéra 2, Cocody », jamais « zone inconnue » au commissariat.
      const zone = lieuDe({ lat: body.lat, lng: body.lng }).libelle;
      const position = container.telematique.majPosition(vehiculeId, { ...body, zone });
      container.realtime.publish(CONFIG_ROOM, 'rental.position', { vehiculeId, position });
      return { position };
    });

    scoped.get('/admin/rental/vehicules/:vehiculeId/position', async (req) => {
      require(req, 'rental:read');
      const { vehiculeId } = req.params as { vehiculeId: string };
      const { admin: account } = req as FastifyRequest & { admin: AdminAccount };
      const location = locationActive(vehiculeId);
      const vol = container.telematique.volActif(vehiculeId);
      // Hors location et hors vol, suivre un véhicule n'a aucun motif légitime.
      if (!location && !vol) {
        throw forbidden('Aucune location en cours ni vol déclaré sur ce véhicule : la position n’est pas consultable.');
      }
      const q = parse(z.object({ motif: z.string().max(140).optional() }), req.query ?? {});
      const position = container.telematique.position(vehiculeId, {
        par: account.name,
        motif: q.motif ?? (vol ? 'Suivi d’un véhicule déclaré volé' : 'Suivi d’une location en cours'),
        reservationId: location?.id,
      });
      audit(req, 'rental.position', vehiculeId, { motif: q.motif });
      return { position, journal: container.telematique.journalAcces(vehiculeId).slice(0, 20) };
    });

    /* ------------------------------ Vol ------------------------------ */

    scoped.post('/admin/rental/:id/vol', async (req, reply) => {
      require(req, 'rental:write');
      const { id } = req.params as { id: string };
      const r = container.rental.get(id);
      if (!r) throw notFound('Location introuvable');
      const body = parse(z.object({ circonstances: z.string().min(10).max(1500) }), req.body);
      const { admin: account } = req as FastifyRequest & { admin: AdminAccount };
      const vol = container.telematique.declarerVol({
        vehiculeId: r.vehicle.id, reservationId: r.id,
        circonstances: body.circonstances, par: account.name,
      });
      // Un vol concerne tout le monde : direction, sécurité, SAMU.
      container.security.record({
        username: account.username, name: account.name, role: account.role,
        section: 'rental', path: `vol:${vol.id}`,
      });
      audit(req, 'rental.vol', vol.id, { vehiculeId: r.vehicle.id, reservationId: r.id });
      reply.code(201);
      return { vol, contactsPolice: container.contacts.list().filter((c) => c.categorie === 'secours') };
    });

    /**
     * FICHE DE SIGNALEMENT pour les forces de l'ordre : tout ce dont un
     * commissariat a besoin pour ouvrir une procédure, sur une seule page.
     * Sans ce document, l'agent dicte au téléphone et se trompe d'immatriculation.
     */
    scoped.get('/admin/rental/vol/:volId/signalement.pdf', async (req, reply) => {
      require(req, 'rental:read');
      const { volId } = req.params as { volId: string };
      const vol = container.telematique.getVol(volId);
      if (!vol) throw notFound('Déclaration introuvable');
      const r = container.rental.get(vol.reservationId);
      const vehicule = container.rentalSettings.vehicule(vol.vehiculeId);
      const position = container.telematique.positionBrute(vol.vehiculeId) ?? vol.dernierePosition;
      const { simplePdf } = await import('../../core/pdf.js');

      const lignes = [
        'ORION COTE D IVOIRE — FICHE DE SIGNALEMENT DE VEHICULE',
        'Document destine aux forces de l ordre (Police / Gendarmerie)',
        '',
        `Reference ORION : ${vol.id}`,
        `Declare le : ${new Date(vol.declareLe).toLocaleString('fr-FR')}`,
        `Declare par : ${vol.declarePar}`,
        '',
        '--- VEHICULE ---',
        `Modele : ${vehicule?.name ?? vol.vehiculeId}`,
        `Identifiant flotte : ${vol.vehiculeId}`,
        `Energie : 100% electrique`,
        '',
        '--- DERNIERE POSITION CONNUE ---',
        position
          ? `Coordonnees : ${position.lat.toFixed(6)}, ${position.lng.toFixed(6)}`
          : 'Aucune position remontee par le boitier.',
        position ? `Zone : ${position.zone ?? 'non identifiee'}` : '',
        position ? `Releve le : ${new Date(position.at).toLocaleString('fr-FR')}` : '',
        position ? `Vitesse au releve : ${position.vitesseKmh} km/h — contact ${position.contact ? 'mis' : 'coupe'}` : '',
        position ? `Lien cartographique : https://maps.google.com/?q=${position.lat},${position.lng}` : '',
        '',
        '--- LOCATAIRE ---',
        `Nom : ${r?.contact?.nom ?? r?.societe?.nom ?? 'non renseigne'}`,
        `Telephone : ${r?.contact?.telephone ?? 'non renseigne'}`,
        `Societe : ${r?.societe?.nom ?? '—'}`,
        `Numero contribuable : ${r?.societe?.contribuable ?? '—'}`,
        `Identifiant client ORION : ${r?.userId ?? '—'}`,
        '',
        '--- CONTRAT DE LOCATION ---',
        `Dossier : ${vol.reservationId}`,
        r ? `Periode : du ${new Date(r.debut).toLocaleString('fr-FR')} au ${new Date(r.fin).toLocaleString('fr-FR')}` : '',
        r ? `Lieu de prise en charge : ${r.lieu ?? 'non renseigne'}` : '',
        r ? `Montant du contrat : ${r.total.toLocaleString('fr-FR')} F CFA` : '',
        '',
        '--- CIRCONSTANCES DECLAREES ---',
        ...vol.circonstances.match(/.{1,78}/g) ?? [],
        '',
        '--- IMMOBILISATION A DISTANCE ---',
        container.telematique.immobilisationActive(vol.vehiculeId)
          ? 'Une immobilisation moteur est ARMEE sur ce vehicule. Elle s applique a l arret.'
          : 'Aucune immobilisation armee a ce jour.',
        '',
        `Reference de plainte : ${vol.referencePlainte ?? '............................'}`,
        '',
        'ORION Cote d Ivoire — Abidjan. Document genere automatiquement.',
      ].filter((l) => l !== '');

      audit(req, 'rental.signalement', volId);
      reply.header('content-type', 'application/pdf');
      reply.header('content-disposition', `attachment; filename="signalement-${vol.id}.pdf"`);
      return simplePdf(lignes);
    });

    scoped.post('/admin/rental/vol/:volId/transmis', async (req) => {
      require(req, 'rental:write');
      const { volId } = req.params as { volId: string };
      const body = parse(z.object({
        a: z.string().min(2).max(120),
        referencePlainte: z.string().max(80).optional(),
      }), req.body);
      const { admin: account } = req as FastifyRequest & { admin: AdminAccount };
      const vol = container.telematique.marquerTransmis(volId, account.name, body.a, body.referencePlainte);
      if (!vol) throw notFound('Déclaration introuvable');
      audit(req, 'rental.vol.transmis', volId, { a: body.a, plainte: body.referencePlainte });
      return { vol };
    });

    scoped.post('/admin/rental/vol/:volId/clore', async (req) => {
      require(req, 'rental:write');
      const { volId } = req.params as { volId: string };
      const body = parse(z.object({ statut: z.enum(['retrouve', 'clos']), note: z.string().max(500).optional() }), req.body);
      const vol = container.telematique.cloreVol(volId, body.statut, body.note);
      if (!vol) throw notFound('Déclaration introuvable');
      audit(req, 'rental.vol.clore', volId, { statut: body.statut });
      return { vol };
    });

    /* ------------------------- Immobilisation moteur ------------------------- */

    scoped.post('/admin/rental/vehicules/:vehiculeId/immobiliser', async (req, reply) => {
      require(req, 'rental:write');
      const { vehiculeId } = req.params as { vehiculeId: string };
      const body = parse(z.object({
        motif: z.enum(['vol', 'impaye', 'sortie_zone', 'fin_location', 'securite']),
        commentaire: z.string().min(10).max(600),
        reservationId: z.string().max(64).optional(),
      }), req.body);
      const { admin: account } = req as FastifyRequest & { admin: AdminAccount };
      const res = container.telematique.armer({ vehiculeId, ...body, par: account.name });
      if (res === 'deja_armee') {
        reply.code(409);
        return { error: 'Une immobilisation est déjà en cours sur ce véhicule.' };
      }
      audit(req, 'rental.immobiliser.armer', res.id, { vehiculeId, motif: body.motif });
      reply.code(201);
      return {
        immobilisation: res,
        // On dit clairement ce qui va se passer : l'agent ne doit pas croire que
        // le moteur vient de s'arrêter.
        avertissement: `Ordre ARMÉ. Il doit être confirmé par une seconde personne, puis le boîtier l’appliquera lorsque le véhicule sera à l’arrêt (moins de ${VITESSE_COUPURE_MAX} km/h).`,
      };
    });

    scoped.post('/admin/rental/immobilisations/:id/confirmer', async (req, reply) => {
      require(req, 'rental:write');
      const { id } = req.params as { id: string };
      const { admin: account } = req as FastifyRequest & { admin: AdminAccount };
      const res = container.telematique.confirmer(id, account.name);
      if (res === 'auto_confirmation') {
        throw forbidden('Une immobilisation exige deux personnes : celui qui l’arme ne la confirme pas. Le client se retrouve à pied, parfois la nuit.');
      }
      if (res === 'deja_confirmee') { reply.code(409); return { error: 'Immobilisation déjà confirmée.' }; }
      if (!res) throw notFound('Immobilisation introuvable');
      audit(req, 'rental.immobiliser.confirmer', id, { etat: res.etat });
      return {
        immobilisation: res,
        avertissement: res.etat === 'appliquee'
          ? 'Véhicule à l’arrêt : la coupure est APPLIQUÉE.'
          : `Confirmée. Le boîtier appliquera la coupure dès que le véhicule roulera à moins de ${VITESSE_COUPURE_MAX} km/h.`,
      };
    });

    scoped.post('/admin/rental/immobilisations/:id/lever', async (req, reply) => {
      require(req, 'rental:write');
      const { id } = req.params as { id: string };
      const body = parse(z.object({ motif: z.string().min(3).max(300) }), req.body);
      const { admin: account } = req as FastifyRequest & { admin: AdminAccount };
      const res = container.telematique.lever(id, account.name, body.motif);
      if (res === 'non_active') { reply.code(409); return { error: 'Cette immobilisation n’est plus active.' }; }
      if (!res) throw notFound('Immobilisation introuvable');
      audit(req, 'rental.immobiliser.lever', id, { motif: body.motif });
      return { immobilisation: res };
    });

    /* ==================== POSTE DE TRAVAIL DU CHEF D'ÉQUIPE ====================
     *
     * La session Équipes montrait des équipes : un nom, un manager, des chauffeurs.
     * On pouvait la regarder, pas y travailler. Diriger une équipe, c'est savoir ce
     * que chacun a fait aujourd'hui, pouvoir l'appeler, lui écrire, lui demander un
     * bilan — et voir ce qui n'a pas été rendu.
     */

    /** Le manager n'ouvre que ses équipes ; l'agent, que la sienne. */
    const assertMonEquipe = (req: FastifyRequest, teamId: string): void => {
      const { admin: account } = req as FastifyRequest & { admin: AdminAccount };
      if (!container.teamWorkspace.peutOuvrir(account, teamId)) {
        throw forbidden('Cette équipe n’est pas la vôtre.');
      }
    };

    scoped.get('/admin/teams/:id/poste', async (req) => {
      require(req, 'teams:read');
      const { id } = req.params as { id: string };
      assertMonEquipe(req, id);
      const q = parse(z.object({ jours: z.coerce.number().int().min(1).max(90).optional() }), req.query ?? {});
      const poste = container.teamWorkspace.poste(id, q.jours ?? 7);
      if (!poste) throw notFound('Équipe introuvable');
      return { poste };
    });

    /** Écrire à un membre de son équipe, dans la console — pas sur son téléphone perso. */
    scoped.post('/admin/teams/:id/messages', async (req, reply) => {
      require(req, 'teams:read');
      const { id } = req.params as { id: string };
      assertMonEquipe(req, id);
      const body = parse(z.object({
        a: z.string().min(1).max(60),
        sujet: z.string().max(120).optional(),
        texte: z.string().min(1).max(2000),
        urgent: z.boolean().optional(),
        reponseAttendue: z.boolean().optional(),
      }), req.body);
      const destinataire = container.accounts.get(body.a);
      if (!destinataire) throw notFound('Destinataire introuvable');
      // On écrit aux gens de son équipe, pas à toute l'entreprise.
      // Un chauffeur de la flotte de l'équipe est un destinataire légitime (son identifiant
      // console est créé et rattaché automatiquement).
      const chauffeurDeLEquipe = Boolean(destinataire.driverId && container.teams.get(id)?.driverIds.includes(destinataire.driverId));
      if (destinataire.teamId !== id && !chauffeurDeLEquipe && container.teams.get(id)?.managerUsername !== destinataire.username) {
        throw forbidden('Ce destinataire n’appartient pas à cette équipe.');
      }
      const { admin: account } = req as FastifyRequest & { admin: AdminAccount };
      if (!account.username) throw forbidden('Jeton statique : impossible d’écrire en votre nom.');
      const message = container.staffComms.ecrire({
        de: account.username, deNom: account.name,
        a: destinataire.username, aNom: destinataire.name,
        teamId: id,
        sujet: body.sujet, texte: body.texte,
        urgent: body.urgent, reponseAttendue: body.reponseAttendue,
      });
      audit(req, 'team.message', id, { a: destinataire.username, urgent: body.urgent === true });
      reply.code(201);
      return { message };
    });

    /** Demander un rapport : un livrable daté, pas un message de plus. */
    scoped.post('/admin/teams/:id/rapports', async (req, reply) => {
      require(req, 'teams:write');
      const { id } = req.params as { id: string };
      assertMonEquipe(req, id);
      const body = parse(z.object({
        destinataire: z.string().min(1).max(60),
        titre: z.string().min(3).max(140),
        consigne: z.string().min(3).max(1200),
        echeance: z.string().min(8).max(30),
      }), req.body);
      const membre = container.accounts.get(body.destinataire);
      if (!membre) throw notFound('Membre introuvable');
      const chauffeurDeLEquipe = Boolean(membre.driverId && container.teams.get(id)?.driverIds.includes(membre.driverId));
      if (membre.teamId !== id && !chauffeurDeLEquipe) throw forbidden('Ce membre n’appartient pas à cette équipe.');
      const { admin: account } = req as FastifyRequest & { admin: AdminAccount };
      if (!account.username) throw forbidden('Jeton statique : impossible de demander en votre nom.');
      const rapport = container.staffComms.demanderRapport({
        teamId: id,
        demandePar: account.username, demandeParNom: account.name,
        destinataire: membre.username, destinataireNom: membre.name,
        titre: body.titre, consigne: body.consigne, echeance: body.echeance,
      });
      audit(req, 'team.rapport.demande', rapport.id, { destinataire: membre.username, echeance: body.echeance });
      reply.code(201);
      return { rapport };
    });

    /* --- Côté membre : lire, répondre, rendre son rapport --- */

    scoped.post('/admin/messages/:id/lu', async (req, reply) => {
      const { id } = req.params as { id: string };
      const { admin: account } = req as FastifyRequest & { admin: AdminAccount };
      const res = container.staffComms.marquerLu(id, account.username ?? '');
      if (res === 'pas_destinataire') { reply.code(403); return { error: 'Ce message ne vous est pas adressé.' }; }
      if (!res) throw notFound('Message introuvable');
      return { message: res };
    });

    scoped.post('/admin/messages/:id/repondre', async (req, reply) => {
      const { id } = req.params as { id: string };
      const body = parse(z.object({ texte: z.string().min(1).max(2000) }), req.body);
      const { admin: account } = req as FastifyRequest & { admin: AdminAccount };
      const res = container.staffComms.repondre(id, account.username ?? '', account.name, body.texte);
      if (res === 'hors_conversation') { reply.code(403); return { error: 'Vous ne participez pas à cet échange.' }; }
      if (!res) throw notFound('Message introuvable');
      audit(req, 'message.repondre', id);
      return { message: res };
    });

    scoped.post('/admin/rapports/:id/rendre', async (req, reply) => {
      const { id } = req.params as { id: string };
      const body = parse(z.object({ texte: z.string().min(3).max(8000) }), req.body);
      const { admin: account } = req as FastifyRequest & { admin: AdminAccount };
      const res = container.staffComms.rendre(id, account.username ?? '', body.texte);
      if (res === 'pas_destinataire') { reply.code(403); return { error: 'Ce rapport n’est pas demandé à vous.' }; }
      if (res === 'deja_accepte') { reply.code(409); return { error: 'Ce rapport a déjà été accepté.' }; }
      if (!res) throw notFound('Rapport introuvable');
      audit(req, 'rapport.rendre', id);
      return { rapport: res };
    });

    scoped.post('/admin/rapports/:id/statuer', async (req, reply) => {
      require(req, 'teams:write');
      const { id } = req.params as { id: string };
      const body = parse(z.object({
        decision: z.enum(['accepte', 'a_revoir']),
        texte: z.string().max(1000).optional(),
      }), req.body);
      const { admin: account } = req as FastifyRequest & { admin: AdminAccount };
      const res = container.staffComms.statuer(id, account.username ?? '', body.decision, body.texte);
      if (res === 'pas_demandeur') { reply.code(403); return { error: 'Seul le demandeur statue sur ce rapport.' }; }
      if (res === 'rien_rendu') { reply.code(409); return { error: 'Rien n’a encore été rendu.' }; }
      if (!res) throw notFound('Rapport introuvable');
      audit(req, `rapport.${body.decision}`, id);
      return { rapport: res };
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

    const LIMITE_EQUIPAGES = 300;
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
        const lignes = moi ? container.crew.page({ jours: q.jours, perimetre: new Set([moi]) }).lignes : [];
        return { equipages: lignes, tableau: null, moi };
      }

      // Chef d'équipe et agent : strictement leur flotte accréditée.
      let perimetre: Set<string> | undefined;
      if (account.role === 'manager' || account.role === 'agent') {
        const fiche = account.username ? container.accounts.get(account.username) : undefined;
        const equipes = account.role === 'manager'
          ? container.teams.listByManager(account.username ?? '')
          : container.teams.list().filter((t) => t.id === fiche?.teamId);
        perimetre = new Set(equipes.flatMap((t) => t.driverIds));
      }
      // Liste bornée : avec des milliers de chauffeurs, la console n'affiche pas 5 000 lignes
      // toutes les 6 secondes. La recherche (matricule, nom, téléphone) trouve les autres.
      const { lignes, total } = container.crew.page({ ...q, perimetre, limite: LIMITE_EQUIPAGES });
      return {
        equipages: lignes,
        total,
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

    /* ------------- Prix des courses : réglage de la direction (Mon poste du PDG) ------------- */
    // Monter ou baisser TOUS les prix des courses d'un pourcentage, et régler l'écart entre les
    // gammes (grille ORION : Or +5 %, Diamant +15 % ; hors Abidjan +10 %, +20 %). Effet immédiat
    // sur chaque nouveau devis du serveur ; les apps reçoivent la grille en direct, sans mise à jour.
    const exigerDirectionPrix = (req: FastifyRequest) => {
      const { admin } = req as FastifyRequest & { admin: AdminAccount };
      if (!admin || !['super_admin', 'ceo', 'dg'].includes(admin.role)) throw forbidden('Seule la direction règle les prix des courses.');
      return admin;
    };
    const TRAJETS_TYPES = [
      { trajet: 'Plateau → Cocody Riviera 2', origin: { lat: 5.3236, lng: -4.0217 }, destination: { lat: 5.3599, lng: -3.9697 } },
      { trajet: 'Yopougon → Riviera Golf', origin: { lat: 5.3441, lng: -4.0637 }, destination: { lat: 5.3588, lng: -3.964 } },
      { trajet: 'Marcory → Treichville', origin: { lat: 5.303, lng: -3.987 }, destination: { lat: 5.2967, lng: -4.0094 } },
    ];
    const etatPrix = async () => {
      const p = container.settings.getPricing();
      const prixPour = (ajustementPct: number) => (t: typeof TRAJETS_TYPES[number]) =>
        Object.fromEntries((['argent', 'or', 'diamant'] as const).map((g) => [g, estimatePrice({ origin: t.origin, destination: t.destination, category: g }, { settings: { ...p, ajustementPct } }).amount]));
      // Le même réglage vaut pour les livraisons : moto express et cargo, livrées dès que possible.
      const livraisonPour = async (ajustementPct: number, t: typeof TRAJETS_TYPES[number]) => {
        const module = new DeliveryServiceModule(async () => ({ settings: { ...p, ajustementPct } }));
        const prix = async (formule: 'moto' | 'cargo') => (await module.estimate({ origin: t.origin, destination: t.destination, category: formule })).amount;
        return { moto: await prix('moto'), cargo: await prix('cargo') };
      };
      const livraisons = await Promise.all(TRAJETS_TYPES.map(async (t) => ({
        trajet: t.trajet,
        prix: await livraisonPour(p.ajustementPct ?? 0, t),
        sansAjustement: await livraisonPour(0, t),
      })));
      return {
        livraisons,
        ajustementPct: p.ajustementPct ?? 0,
        bornes: { min: AJUSTEMENT_MIN, max: AJUSTEMENT_MAX },
        majorationsPct: { or: p.majorationsPct['or'] ?? 0, diamant: p.majorationsPct['diamant'] ?? 0 },
        majorationsPctHorsAbidjan: { or: p.majorationsPctHorsAbidjan?.['or'] ?? 0, diamant: p.majorationsPctHorsAbidjan?.['diamant'] ?? 0 },
        modifie: p.ajustementModifie ?? null,
        // Prix sur des trajets types (hors trafic, zone et forte demande), avec et sans l'ajustement.
        exemples: TRAJETS_TYPES.map((t) => ({
          trajet: t.trajet,
          km: Math.round(estimatePrice({ origin: t.origin, destination: t.destination, category: 'argent' }, { settings: p }).distanceMeters / 100) / 10,
          prix: prixPour(p.ajustementPct ?? 0)(t),
          sansAjustement: prixPour(0)(t),
        })),
      };
    };
    scoped.get('/admin/direction/prix', async (req) => {
      exigerDirectionPrix(req);
      return await etatPrix();
    });
    scoped.post('/admin/direction/prix', async (req) => {
      const admin = exigerDirectionPrix(req);
      const pct = z.number().min(0).max(100);
      const body = parse(z.object({
        ajustementPct: z.number().min(AJUSTEMENT_MIN).max(AJUSTEMENT_MAX),
        majorationsPct: z.object({ or: pct, diamant: pct }).optional(),
        majorationsPctHorsAbidjan: z.object({ or: pct, diamant: pct }).optional(),
      }), req.body);
      // La grille garde son ordre : le Diamant ne coûte jamais moins que l'Or.
      for (const g of [body.majorationsPct, body.majorationsPctHorsAbidjan]) {
        if (g && g.diamant < g.or) throw badRequest('Le Diamant doit rester au moins au niveau de l’Or.');
      }
      const avant = await etatPrix();
      container.settings.updatePricing({
        ajustementPct: Math.round(body.ajustementPct * 10) / 10,
        ...(body.majorationsPct ? { majorationsPct: body.majorationsPct } : {}),
        ...(body.majorationsPctHorsAbidjan ? { majorationsPctHorsAbidjan: body.majorationsPctHorsAbidjan } : {}),
        ajustementModifie: { le: new Date().toISOString(), par: admin.name || admin.username || 'Direction' },
      });
      audit(req, 'pricing.direction', undefined, {
        avant: { ajustementPct: avant.ajustementPct, majorationsPct: avant.majorationsPct, majorationsPctHorsAbidjan: avant.majorationsPctHorsAbidjan },
        apres: body,
      });
      return await etatPrix();
    });

    /* ---------------------- Accès testeurs (connexion sans SMS) ---------------------- */
    // Réservé à la direction (PDG, DG, super-administrateur) : inviter un numéro lui ouvre
    // la connexion avec un code transmis à la main, sans passer par le SMS.
    const exigerDirection = (req: FastifyRequest) => {
      require(req, 'accounts:write');
      const { admin } = req as FastifyRequest & { admin: AdminAccount };
      if (!['super_admin', 'ceo', 'dg'].includes(admin.role)) throw forbidden('Seule la direction invite des testeurs.');
      return admin;
    };
    scoped.get('/admin/testeurs', async (req) => {
      exigerDirection(req);
      return { testeurs: container.testeurs.liste(), joursParDefaut: JOURS_PAR_DEFAUT, joursMax: JOURS_MAX };
    });
    scoped.post('/admin/testeurs', async (req) => {
      const admin = exigerDirection(req);
      const body = parse(z.object({
        phone: z.string().min(8).max(25),
        nom: z.string().trim().min(2).max(80),
        jours: z.number().int().min(1).max(JOURS_MAX).optional(),
      }), req.body);
      const phone = normalizePhone(body.phone);
      if (!phone) throw badRequest('Numéro de téléphone invalide');
      const testeur = container.testeurs.inviter({ phone, nom: body.nom, jours: body.jours, par: admin.name });
      audit(req, 'testeur.invitation', `${phone.slice(0, 6)}••••${phone.slice(-2)}`, { nom: testeur.nom, expireLe: testeur.expireLe });
      return { testeur: { ...testeur, actif: true } };
    });
    scoped.delete('/admin/testeurs/:phone', async (req) => {
      exigerDirection(req);
      const phone = normalizePhone(decodeURIComponent((req.params as { phone: string }).phone));
      if (!phone || !container.testeurs.retirer(phone)) throw notFound('Invitation introuvable');
      audit(req, 'testeur.retrait', `${phone.slice(0, 6)}••••${phone.slice(-2)}`);
      return { ok: true };
    });

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

    // --- Mesures du serveur (service informatique, direction) ---
    // Débit, temps de réponse, retard de la boucle d'événements, temps réel, itinéraires,
    // et le volume en cours : ce qu'on regarde quand la plateforme est sous pression.
    scoped.get('/admin/systeme/mesures', async (req, reply) => {
      require(req, 'sessions:read');
      reply.header('cache-control', 'no-store');
      return mesuresPlateforme(container);
    });

    // --- Test de charge : flotte et clientèle de test (jamais en production) ---
    scoped.post('/admin/charge/preparer', async (req) => {
      const { admin: account } = req as FastifyRequest & { admin: AdminAccount };
      if (config.NODE_ENV === 'production' || !config.TEST_CHARGE) throw forbidden('Le test de charge est désactivé sur ce serveur.');
      if (account.role !== 'super_admin') throw forbidden('Le test de charge est réservé au super administrateur technique.');
      const body = parse(z.object({
        conducteurs: z.number().int().min(0).max(20_000),
        clients: z.number().int().min(0).max(20_000),
      }), req.body);
      const res = await preparerCharge(container, body);
      audit(req, 'charge.preparation', 'test-de-charge', { conducteurs: res.conducteurs, clients: res.clients.length });
      return res;
    });

    // --- Journal d'audit ---
    scoped.get('/admin/audit', async (req) => { require(req, 'audit:read'); return { entries: container.audit.list(200) }; });
  });
}
