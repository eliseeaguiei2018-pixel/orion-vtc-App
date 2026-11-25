import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { Container } from '../../container.js';
import { config } from '../../config/index.js';
import { parse } from '../../core/validate.js';
import { AppError } from '../../core/errors.js';
import { parseCookies, serializeCookie } from '../admin/cookies.js';
import { CodeSynchroRefuse, type Appareil } from './service.js';

/** Cookie HttpOnly qui porte la clé de l'appareil : aucun script de la page ne peut la lire. */
export const APPAREIL_COOKIE = 'orion_appareil';
/** Même clé en en-tête, pour les clients hors navigateur (applications de bureau, outils). */
export const APPAREIL_HEADER = 'x-orion-appareil';
/** 400 jours : la durée maximale qu'acceptent les navigateurs pour un cookie. */
const DUREE_COOKIE = 400 * 24 * 3600;

/** L'appareil enrôlé qui présente la requête, s'il y en a un. */
export function appareilDeLaRequete(container: Container, req: FastifyRequest): Appareil | undefined {
  const cookie = parseCookies(req.headers['cookie'] as string | undefined)[APPAREIL_COOKIE];
  const entete = req.headers[APPAREIL_HEADER] as string | undefined;
  return container.appareils.parSaCle(cookie) ?? container.appareils.parSaCle(entete);
}

/**
 * Contrôle d'appareil de la console et du tableau de bord. Sans effet tant que
 * APPAREILS_EXIGES n'est pas activé ; ensuite, une session ne s'ouvre et ne sert que
 * depuis un appareil enrôlé et non révoqué.
 */
export function exigerAppareil(container: Container, req: FastifyRequest, compte?: string): Appareil | undefined {
  const appareil = appareilDeLaRequete(container, req);
  if (appareil) container.appareils.toucher(appareil, req.ip, compte);
  if (config.APPAREILS_EXIGES && !appareil) {
    throw new AppError(403, 'APPAREIL_NON_ENROLE', 'Cet appareil n’est pas enrôlé : saisissez le code de synchronisation ORION, ou il a été révoqué.');
  }
  return appareil;
}

export async function appareilsRoutes(app: FastifyInstance, container: Container): Promise<void> {
  /** Ce que l'écran d'accueil doit afficher : enrôlement possible, exigé, et cet appareil. */
  app.get('/appareils/etat', async (req) => {
    const appareil = appareilDeLaRequete(container, req);
    return {
      configure: container.appareils.configure,
      exige: config.APPAREILS_EXIGES,
      appareil: appareil ? container.appareils.vue(appareil) : null,
    };
  });

  /**
   * ENRÔLEMENT : le code de synchronisation ORION contre une clé propre à l'appareil.
   * Cinq essais manqués par adresse sur un quart d'heure (cinquante pour tout le réseau),
   * puis attente. Chaque essai, réussi ou non, est journalisé.
   */
  app.post('/appareils/enroler', async (req, reply) => {
    const body = parse(z.object({
      code: z.string().min(1).max(200),
      nom: z.string().trim().min(2).max(60),
      plateforme: z.enum(['windows', 'macos', 'linux', 'ios', 'android', 'harmonyos', 'web']),
      application: z.enum(['console', 'tableau', 'chauffeur']),
    }), req.body);
    try {
      const { appareil, cle } = await container.appareils.enroler(body.code, body, req.ip);
      container.audit.log({ actor: `appareil:${appareil.nom}`, role: 'appareil', action: 'appareil.enrole', target: appareil.id, details: { plateforme: appareil.plateforme, application: appareil.application, ip: req.ip } });
      reply.header('set-cookie', serializeCookie(APPAREIL_COOKIE, cle, { maxAgeSeconds: DUREE_COOKIE, httpOnly: true }));
      // La clé est aussi rendue UNE fois pour les applications hors navigateur ; la console
      // web, elle, n'en a pas besoin (le cookie suffit) et ne la conserve pas.
      return { appareil, cle };
    } catch (e) {
      if (!(e instanceof CodeSynchroRefuse)) throw e;
      container.audit.log({ actor: `ip:${req.ip}`, role: 'appareil', action: `appareil.refus.${e.raison}`, details: { nom: body.nom, plateforme: body.plateforme } });
      if (e.raison === 'non_configure') {
        reply.code(503);
        return { error: { code: 'CODE_NON_CONFIGURE', message: 'Le code de synchronisation n’est pas configuré sur ce serveur.' } };
      }
      if (e.raison === 'trop_d_essais') {
        reply.code(429).header('retry-after', String(e.attenteSecondes));
        return { error: { code: 'TROP_D_ESSAIS', message: `Trop d’essais. Réessayez dans ${Math.ceil(e.attenteSecondes / 60)} min.` } };
      }
      reply.code(401);
      return { error: { code: 'CODE_INVALIDE', message: 'Code de synchronisation incorrect.' } };
    }
  });
}
